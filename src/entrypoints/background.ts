// The service worker owns no state. It is terminated after 30 seconds of idle
// and every global goes with it, so it does exactly two things: make sure the
// offscreen document exists, and pass messages through to it.
//
// It cannot host the database. Inside this context the Worker constructor and
// FileSystemFileHandle.createSyncAccessHandle are both absent, verified in a
// real browser, see spikes/phase-0.
import { defineBackground } from 'wxt/utils/define-background';
import { atsForUrl } from '../ats/registry';
import { classify } from '../fill/detect';
import type { FrameChoice, FrameReport } from '../fill/frames';
import { chooseFrame, describeFrame } from '../fill/frames';
import { buildPlan, planNeedsResume } from '../fill/plan';
import type { FillReport } from '../fill/types';
import type { DbProtocol } from '../messaging/db';
import { sendDb } from '../messaging/db';
import { onFill, sendFill } from '../messaging/fill';
import type { VaultProtocol } from '../messaging/vault';
import { onVault } from '../messaging/vault';

const OFFSCREEN_PATH = 'offscreen.html';

let creating: Promise<void> | null = null;

async function ensureOffscreen(): Promise<void> {
  // `creating` is consulted FIRST. hasDocument() returns true for a document
  // that exists but whose scripts have not run yet, so checking it first let a
  // second message skip the wait and send into a document with no listeners,
  // which rejects with "Could not establish connection".
  if (creating) return creating;
  if (await chrome.offscreen.hasDocument()) return;
  creating = chrome.offscreen
    .createDocument({
      url: OFFSCREEN_PATH,
      reasons: [chrome.offscreen.Reason.WORKERS],
      justification: 'Spawns the dedicated worker that owns the encrypted vault.',
    })
    .catch(async (err: Error) => {
      // Chrome rejects with "Only a single offscreen document may be created"
      // when one is already being created, which is a race rather than a
      // failure. Anything else is real.
      if (await chrome.offscreen.hasDocument()) return;
      throw err;
    })
    .finally(() => {
      creating = null;
    });
  return creating;
}

/** Every handler starts here, because the service worker is revived constantly. */
async function withVault<T>(run: () => Promise<T>): Promise<T> {
  await ensureOffscreen();
  return run();
}

const UNSUPPORTED =
  'PageMyCV found no Lever or Greenhouse application form on this page, either directly or embedded in it.';

/**
 * How long to wait for frames to answer a roll call.
 *
 * Each answer is a separate message from a content script that is already
 * running, so this is one process hop rather than a page load. Generous, and
 * the cost is paid once per fill.
 */
const ROLL_CALL_MS = 250;

/**
 * How long to keep asking before deciding there is no form.
 *
 * One pass is not enough. A careers page mounts its embed with script, so the
 * iframe can still be loading when somebody clicks Fill — and a single roll
 * call then reports an empty page and the panel says it found no form. That
 * is not a test artefact: it is what a person sees when they click as soon as
 * the page looks ready. Found by the gate doing exactly that.
 *
 * The budget is spent only on pages where nothing answered, so the ordinary
 * case still costs one pass.
 */
const ROLL_CALL_BUDGET_MS = 2000;

/**
 * Frames that answered, keyed by tab then frame.
 *
 * In memory on purpose. The service worker is terminated after 30 seconds of
 * idle and this goes with it, which is correct: a frame list older than the
 * page it describes is worse than no list, and the roll call that rebuilds it
 * costs a quarter of a second.
 */
const roster = new Map<number, Map<number, FrameReport>>();

onFill('fill:here', ({ data, sender }) => {
  const tabId = sender.tab?.id;
  // `sender.frameId` is the whole reason this message exists. It is the only
  // way to learn a frame's id without the `webNavigation` permission, which
  // would hand us the URL of every frame of every tab. See spikes/phase-3.
  if (typeof tabId === 'number' && typeof sender.frameId === 'number') {
    const frames = roster.get(tabId) ?? new Map<number, FrameReport>();
    frames.set(sender.frameId, { frameId: sender.frameId, ...data });
    roster.set(tabId, frames);
  }
  return { ack: true } as const;
});

/** Forget a tab's frames the moment the page they described is gone. */
chrome.tabs.onRemoved.addListener((tabId) => roster.delete(tabId));
chrome.tabs.onUpdated.addListener((tabId, change) => {
  if (change.status === 'loading') roster.delete(tabId);
});

/**
 * Every frame of this tab that is running our content script.
 *
 * A broadcast with no frameId reaches them all but resolves with whichever
 * answers first, so the answers come back as separate `fill:here` messages
 * instead and this waits for them to land.
 */
async function rollCallOnce(tabId: number): Promise<FrameReport[]> {
  roster.delete(tabId);
  // The broadcast itself rejects when NO frame has a listener, which is the
  // ordinary "this page is not a job board" case rather than a failure.
  await sendFill('fill:rollCall', undefined, tabId).catch(() => {});
  await new Promise((resolve) => setTimeout(resolve, ROLL_CALL_MS));
  return [...(roster.get(tabId)?.values() ?? [])];
}

/**
 * Roll call, repeated until something usable answers or the budget runs out.
 *
 * `accept` decides what usable means, so the retry is spent on the question
 * being asked rather than on any frame at all.
 */
async function rollCall(
  tabId: number,
  accept: (frames: FrameReport[]) => boolean = (f) => f.length > 0,
): Promise<FrameReport[]> {
  const deadline = Date.now() + ROLL_CALL_BUDGET_MS;
  let frames = await rollCallOnce(tabId);
  while (!accept(frames) && Date.now() < deadline) {
    frames = await rollCallOnce(tabId);
  }
  return frames;
}

/**
 * The id of the tab the panel is looking at.
 *
 * Only the id, deliberately. Reading `tab.url` would need either the `tabs`
 * permission or host permissions, and neither is necessary: the content
 * script already knows what page it is on and says so in its survey. The
 * extension therefore cannot see the URL of any tab it is not injected into,
 * which is a stronger property than a comment promising it will not look.
 *
 * `lastFocusedWindow` rather than `currentWindow`: a side panel belongs to its
 * window, but the service worker answering this message has no window of its
 * own, so `currentWindow` is not reliably the one the user is looking at.
 */
async function activeTabId(): Promise<number> {
  const [tab] = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
  if (!tab?.id) throw new Error('no active tab to fill');
  return tab.id;
}

/**
 * Describe, decide, execute. The three steps stay inside one message so the
 * plan cannot outlive the page it was built from: a plan applied after a
 * navigation would write the right values into whatever form loaded next.
 */
async function fillActiveTab(): Promise<FillReport> {
  const tabId = await activeTabId();

  // Which frame holds the form. On a board's own page that is the top frame;
  // on a company careers page it is the board's iframe, and the page around
  // it is never touched, read, or even reachable — see spikes/phase-3.
  // Keep asking until a frame with a form answers: an embed mounted by script
  // may still be loading when the button is clicked.
  const frames = await rollCall(tabId, (f) => chooseFrame(f) !== null);
  const choice: FrameChoice | null = chooseFrame(frames);
  if (!choice) throw new Error(UNSUPPORTED);
  const target = { tabId, frameId: choice.frame.frameId };

  // A connection error here means the frame went away between the roll call
  // and now. Anything else is a real failure inside the content script and is
  // reported as itself: reporting a bug of ours as "this site is not
  // supported" is the kind of lie that costs an afternoon.
  const survey = await sendFill('fill:describe', undefined, target).catch((err: unknown) => {
    const message = err instanceof Error ? err.message : String(err);
    if (/could not establish connection|receiving end does not exist/i.test(message)) {
      throw new Error('the form disappeared while it was being read. Try again.');
    }
    throw err;
  });
  const ats = atsForUrl(survey.url);
  if (ats.id === 'unknown') throw new Error(UNSUPPORTED);
  if (survey.fields.length === 0) throw new Error('no form fields were found on this page');

  // The values are fetched only once a form is known to exist, so opening the
  // panel on a job description never decrypts anything.
  const { values, resume } = await sendDb('db:fillValues', undefined);
  const classifications = classify(survey.fields, ats);
  const plan = buildPlan(survey.fields, classifications, values, ats, resume?.filename ?? null);

  const report = await sendFill(
    'fill:apply',
    // The bytes cross into the page's process only when the plan has
    // somewhere to put them. See planNeedsResume.
    { plan, resume: planNeedsResume(plan) ? resume : null, generation: survey.generation },
    target,
  );
  // Where it filled, when that was not the page itself. Silence would be
  // wrong: the click happened on a company careers page and the values went
  // into a form served by somebody else.
  return { ...report, frameNote: describeFrame(choice) };
}

const ROUTES: Record<keyof VaultProtocol, keyof DbProtocol | 'local'> = {
  'vault:state': 'db:state',
  'vault:create': 'db:create',
  'vault:unlock': 'db:unlock',
  'vault:lock': 'db:lock',
  'vault:profile': 'db:profile',
  'vault:importCv': 'db:importCv',
  'vault:touch': 'db:touch',
  'vault:resumeMeta': 'db:resumeMeta',
  'vault:setResume': 'db:setResume',
  'vault:fill': 'local',
  'vault:clearFill': 'local',
};

for (const [key, target] of Object.entries(ROUTES) as [
  keyof VaultProtocol,
  keyof DbProtocol | 'local',
][]) {
  if (target === 'local') continue;
  onVault(key, ({ data }) => withVault(() => sendDb(target, data as never) as Promise<never>));
}

onVault('vault:fill', () => withVault(fillActiveTab));
onVault('vault:clearFill', async () => {
  // Every frame that answered, not just the one that was filled: the service
  // worker may have been terminated since, and a highlight nobody can clear
  // is a mark left on somebody's page.
  const tabId = await activeTabId();
  const frames = await rollCall(tabId);
  await Promise.all(
    frames.map((f) => sendFill('fill:clear', undefined, { tabId, frameId: f.frameId })),
  );
  return { cleared: true } as const;
});

export default defineBackground(() => {
  chrome.sidePanel?.setPanelBehavior?.({ openPanelOnActionClick: true }).catch(() => {});
});
