// The service worker owns no state. It is terminated after 30 seconds of idle
// and every global goes with it, so it does exactly three things: make sure
// the offscreen document exists, OPEN the vault, and pass messages through.
//
// It cannot host the database. Inside this context the Worker constructor and
// FileSystemFileHandle.createSyncAccessHandle are both absent, verified in a
// real browser, see spikes/phase-0.
//
// Opening the vault landed here by elimination, and the elimination is the
// interesting part. The key has to be read from chrome.storage, and of the
// three contexts only this one can: `chrome` is undefined inside a dedicated
// worker, and an offscreen document is given chrome.runtime and nothing else.
// Both measured in a real browser rather than assumed — the second by the
// gate, after the first design put the key store in the offscreen document
// and every open failed with "Cannot read properties of undefined".
import { defineBackground } from 'wxt/utils/define-background';
import { atsForUrl } from '../ats/registry';
import type { VaultState } from '../db/schema';
import { classify } from '../fill/detect';
import type { FrameChoice, FrameReport } from '../fill/frames';
import { chooseFrame, describeFrame } from '../fill/frames';
import { buildPlan, planNeedsResume } from '../fill/plan';
import { isNoListener, rollCall } from '../fill/roll-call';
import type { FillReport } from '../fill/types';
import type { DbProtocol } from '../messaging/db';
import { sendDb } from '../messaging/db';
import { onFill, sendFill } from '../messaging/fill';
import type { VaultProtocol } from '../messaging/vault';
import { onVault } from '../messaging/vault';
import { fromBase64, toBase64 } from '../util/base64';
import { convertVault } from '../vault/convert';
import { deriveKeyMaterial, newKeyMaterial } from '../vault/crypto';
import { loadKeyMaterial, saveKeyMaterial } from '../vault/key-store';

const OFFSCREEN_PATH = 'offscreen.html';

/**
 * How long to keep pinging a freshly created offscreen document.
 *
 * It is a local document with one script; this is generous. What it is NOT is
 * a retry budget for a broken document — only "no listener yet" is retried,
 * and any other failure comes straight back.
 */
const OFFSCREEN_READY_MS = 5000;
const OFFSCREEN_POLL_MS = 25;

let creating: Promise<void> | null = null;

/**
 * Wait until the offscreen document ANSWERS, not until it exists.
 *
 * chrome.offscreen.createDocument resolves when the document has been
 * created, which is earlier than when its scripts have run and registered
 * their listeners. Anything sent in that window comes back "Could not
 * establish connection. Receiving end does not exist." — a race reported as
 * a failure, and the panel renders it as "The vault could not be opened",
 * which sounds like the CV is gone.
 *
 * The hazard predates this: hasDocument() has the same gap, and the comment
 * below has described it all along. It only became visible when opening the
 * vault moved here, because that turned one relayed message into a sequence
 * where losing the first one aborts the rest.
 */
async function waitForOffscreen(): Promise<void> {
  const deadline = Date.now() + OFFSCREEN_READY_MS;
  for (;;) {
    try {
      await sendDb('db:ping', undefined);
      return;
    } catch (err) {
      if (!isNoListener(err) || Date.now() >= deadline) throw err;
      await new Promise((resolve) => setTimeout(resolve, OFFSCREEN_POLL_MS));
    }
  }
}

async function ensureOffscreen(): Promise<void> {
  // `creating` is consulted FIRST. hasDocument() returns true for a document
  // that exists but whose scripts have not run yet, so checking it first let a
  // second message skip the wait and send into a document with no listeners,
  // which rejects with "Could not establish connection".
  if (creating) return creating;
  // hasDocument() is true for a document whose scripts have not run, so a
  // service worker that was restarted next to a live document still has to
  // wait for an answer rather than assume one.
  if (await chrome.offscreen.hasDocument()) return waitForOffscreen();
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
    .then(waitForOffscreen)
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

/** The page is not a job board at all: no frame is running our content script. */
const NOT_A_BOARD =
  'PageMyCV does not know this page. It works on Lever and Greenhouse application forms, including ones embedded in a company careers page.';

/**
 * It IS a board, and there is no form on it.
 *
 * Worth its own wording because it is the common way a fill "does not work":
 * being on the job description rather than on the application form. The two
 * used to share one message, which sent people looking for a bug in the
 * extension instead of clicking Apply.
 */
const NO_FORM_HERE =
  'This looks like a job board page but has no application form on it yet. If you are on the job description, open the application form first.';

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
 * How long to keep asking while nothing at all has answered.
 *
 * Short, because this is the ordinary "not a job board" page and the answer
 * should be immediate — but not zero, because a careers page has no content
 * script anywhere in it until its embed finishes mounting, and stopping at
 * the first silence called every one of them unsupported.
 */
const ROLL_CALL_SILENCE_MS = 900;

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
 * instead and this waits for them to land. The decision — how long to wait,
 * when to stop, and what "no content script at all" means — lives in
 * src/fill/roll-call.ts, where it can be tested.
 */
function callFrames(tabId: number, accept: (frames: FrameReport[]) => boolean) {
  return rollCall(
    {
      // True when some frame listened. The messaging layer replaces Chrome's
      // "Receiving end does not exist" with its own "No response", so the
      // classification lives here, next to the library that does it.
      broadcast: () =>
        sendFill('fill:rollCall', undefined, tabId)
          .then(() => true)
          .catch((err: unknown) => !isNoListener(err)),
      collected: () => [...(roster.get(tabId)?.values() ?? [])],
      reset: () => roster.delete(tabId),
      wait: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
      now: () => Date.now(),
    },
    { perPass: ROLL_CALL_MS, budget: ROLL_CALL_BUDGET_MS, silenceBudget: ROLL_CALL_SILENCE_MS },
    accept,
  );
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
  //
  // Keep asking until a frame with a form answers: an embed mounted by script
  // may still be loading when the button is clicked. But stop at once when
  // NOTHING is listening, because a page with no content script will not grow
  // one, and spending the retry budget there made an ordinary page take two
  // seconds to say it is not a job board.
  const { frames, reachable } = await callFrames(tabId, (f) => chooseFrame(f) !== null);
  const choice: FrameChoice | null = chooseFrame(frames);
  if (!choice) throw new Error(reachable ? NO_FORM_HERE : NOT_A_BOARD);
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
  if (ats.id === 'unknown') throw new Error(NOT_A_BOARD);
  if (survey.fields.length === 0) throw new Error(NO_FORM_HERE);

  // The values are fetched only once a form is known to exist, so opening the
  // panel on a job description never decrypts anything.
  const { values, resume } = await sendDb('db:fillValues', undefined);
  // Fetched beside the values, and kept apart from them all the way into the
  // planner. A screening question can only ever be answered from here, so
  // there is no path by which the CV parser could start answering one by
  // inference — which is the guarantee the old outright refusal gave, kept.
  const answers = await sendDb('db:screeningAnswers', undefined);
  const classifications = classify(survey.fields, ats);
  const plan = buildPlan(
    survey.fields,
    classifications,
    values,
    ats,
    resume?.filename ?? null,
    answers,
  );

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

/**
 * The open, in flight or done.
 *
 * Memoized because it WRITES. Two panels opening at once would otherwise both
 * see an absent vault and both create one, and the second would win with a
 * key the first one's rows are not encrypted under. The gate opens four at
 * once for exactly this reason.
 *
 * Not cached across a service worker restart, which is correct rather than
 * merely tolerable: a new service worker cannot know whether the offscreen
 * document it is talking to still holds the key, so it asks again. Opening an
 * already-open vault is a state() call and nothing else.
 */
let opening: Promise<void> | null = null;

async function openVault(): Promise<void> {
  const state = await sendDb('db:state', undefined);
  if (state.status === 'unavailable' || state.status === 'unlocked') return;

  if (state.status === 'absent') {
    // Generated here, where it can be stored, and STORED BEFORE the vault is
    // created. A key the worker encrypted a vault under and we then failed to
    // persist would leave that vault unopenable forever; a stored key with no
    // vault behind it is just an unused value the next create overwrites.
    const material = newKeyMaterial();
    await saveKeyMaterial(material);
    await sendDb('db:create', { material: toBase64(material) });
    return;
  }

  // Made with a passphrase and not yet converted. The panel asks once; there
  // is nothing this can do without it.
  if (state.status === 'needs_passphrase') return;

  const material = await loadKeyMaterial();
  if (!material) {
    // The vault says it needs no passphrase and its key is not here. Saying
    // so is the only honest answer: creating a new one would write over a CV
    // that is still on disk, and reporting "locked" would ask for a
    // passphrase that was never set.
    throw new Error(
      'the vault exists but its key is not in this browser profile, so it cannot be opened',
    );
  }
  await sendDb('db:open', { material: toBase64(material) });
}

function ensureVaultOpen(): Promise<void> {
  if (!opening) {
    opening = openVault().catch((err) => {
      // Never cache the failure. A worker that timed out mid-open would
      // otherwise stay broken until this service worker is torn down, and the
      // panel's "Try again" would be a button that cannot work.
      opening = null;
      throw err;
    });
  }
  return opening;
}

/** The one-time move off a passphrase. The order is in src/vault/convert.ts. */
function convert(passphrase: string): Promise<VaultState> {
  return convertVault<VaultState>(passphrase, {
    readSalt: async () => fromBase64(await sendDb('db:salt', undefined)),
    derive: deriveKeyMaterial,
    open: (material) => sendDb('db:open', { material: toBase64(material) }),
    save: saveKeyMaterial,
    markConverted: () => sendDb('db:markConverted', undefined),
  });
}

const ROUTES: Record<keyof VaultProtocol, keyof DbProtocol | 'local'> = {
  'vault:state': 'db:state',
  'vault:convert': 'local',
  'vault:profile': 'db:profile',
  'vault:importCv': 'db:importCv',
  'vault:resumeMeta': 'db:resumeMeta',
  'vault:setResume': 'db:setResume',
  'vault:screeningAnswers': 'db:screeningAnswers',
  'vault:setScreeningAnswer': 'db:setScreeningAnswer',
  'vault:fill': 'local',
  'vault:clearFill': 'local',
};

for (const [key, target] of Object.entries(ROUTES) as [
  keyof VaultProtocol,
  keyof DbProtocol | 'local',
][]) {
  if (target === 'local') continue;
  onVault(key, ({ data }) =>
    withVault(async () => {
      // Before the command, not beside it. Every route below needs the key,
      // and 'db:state' needs the open to have been ATTEMPTED or it reports a
      // vault nobody has opened yet as if that were the final answer.
      await ensureVaultOpen();
      return sendDb(target, data as never) as Promise<never>;
    }),
  );
}

// Not routed: it is several worker calls plus a write to the key store, and
// it must NOT wait on ensureVaultOpen — it is what makes the open possible.
onVault('vault:convert', ({ data }) => withVault(() => convert(data.passphrase ?? '')));

onVault('vault:fill', () =>
  withVault(async () => {
    // Routed messages get this from the loop above; these two are handled
    // here, so they need it explicitly. Filling reads the vault.
    await ensureVaultOpen();
    return fillActiveTab();
  }),
);
onVault('vault:clearFill', async () => {
  // Every frame that answered, not just the one that was filled: the service
  // worker may have been terminated since, and a highlight nobody can clear
  // is a mark left on somebody's page.
  const tabId = await activeTabId();
  // One pass, no retry: clearing a highlight nobody drew is not worth waiting
  // for, and every frame that could hold one has already answered a roll call
  // to have been filled in the first place.
  const { frames } = await callFrames(tabId, () => true);
  await Promise.all(
    frames.map((f) => sendFill('fill:clear', undefined, { tabId, frameId: f.frameId })),
  );
  return { cleared: true } as const;
});

export default defineBackground(() => {
  chrome.sidePanel?.setPanelBehavior?.({ openPanelOnActionClick: true }).catch(() => {});
});
