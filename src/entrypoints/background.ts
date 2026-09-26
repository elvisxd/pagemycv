// The service worker owns no state. It is terminated after 30 seconds of idle
// and every global goes with it, so it does exactly two things: make sure the
// offscreen document exists, and pass messages through to it.
//
// It cannot host the database. Inside this context the Worker constructor and
// FileSystemFileHandle.createSyncAccessHandle are both absent, verified in a
// real browser, see spikes/phase-0.
import { defineBackground } from 'wxt/utils/define-background';
import { sendDb } from '../messaging/db';
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

onVault('vault:state', () => withVault(() => sendDb('db:state', undefined)));
onVault('vault:create', ({ data }) => withVault(() => sendDb('db:create', data)));
onVault('vault:unlock', ({ data }) => withVault(() => sendDb('db:unlock', data)));
onVault('vault:lock', () => withVault(() => sendDb('db:lock', undefined)));
onVault('vault:profile', () => withVault(() => sendDb('db:profile', undefined)));
onVault('vault:importCv', ({ data }) => withVault(() => sendDb('db:importCv', data)));
onVault('vault:touch', () => withVault(() => sendDb('db:touch', undefined)));

export default defineBackground(() => {
  chrome.sidePanel?.setPanelBehavior?.({ openPanelOnActionClick: true }).catch(() => {});
});
