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
import { buildPlan } from '../fill/plan';
import type { FillReport } from '../fill/types';
import type { DbProtocol } from '../messaging/db';
import { sendDb } from '../messaging/db';
import { sendFill } from '../messaging/fill';
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

const UNSUPPORTED = 'PageMyCV does not know this page. It works on Lever and Greenhouse job pages.';

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

  // No content script on the page means the page is not one of the two hosts
  // the manifest lists, because that list is the only way this script is ever
  // injected. The connection error is the evidence, so it is reported as the
  // real answer rather than as a failure.
  const survey = await sendFill('fill:describe', undefined, tabId).catch(() => {
    throw new Error(UNSUPPORTED);
  });
  const ats = atsForUrl(survey.url);
  if (ats.id === 'unknown') throw new Error(UNSUPPORTED);
  if (survey.fields.length === 0) throw new Error('no form fields were found on this page');

  // The values are fetched only once a form is known to exist, so opening the
  // panel on a job description never decrypts anything.
  const { values, resume } = await sendDb('db:fillValues', undefined);
  const classifications = classify(survey.fields, ats);
  const plan = buildPlan(survey.fields, classifications, values, ats, resume?.filename ?? null);

  return sendFill('fill:apply', { plan, resume }, tabId);
}

/**
 * Every panel message, mapped to the offscreen message that answers it, or to
 * 'local' when the background handles it itself.
 *
 * A `Record` over the protocol for the same reason the offscreen bridge uses
 * one: a list of `onVault` calls let a message be added everywhere except the
 * one place that routes it, and the only symptom was "the message port closed
 * before a response was received" with no clue which message or which layer.
 * Leaving a key out of this Record is a type error.
 */
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
onVault('vault:clearFill', async () => sendFill('fill:clear', undefined, await activeTabId()));

export default defineBackground(() => {
  chrome.sidePanel?.setPanelBehavior?.({ openPanelOnActionClick: true }).catch(() => {});
});
