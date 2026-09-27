// One unknown, answered in a real browser rather than assumed.
//
// Dropping the passphrase means the key has to live somewhere on disk. The
// obvious place is chrome.storage.local, and the obvious owner is the DB
// worker, which is already the only module allowed to touch persistence.
//
// But the worker is a DEDICATED WORKER spawned from an offscreen document,
// and the `chrome` namespace is not uniformly available in worker contexts.
// If it is missing there, the key has to be read by the offscreen document
// and handed across postMessage, which is a different design.
//
// Run: node run.cjs
const path = require('node:path');
const fs = require('node:fs');

function loadPlaywright() {
  for (const id of ['playwright', '../../node_modules/playwright']) {
    try { return require(id); } catch {}
  }
  throw new Error('playwright is not installed: run pnpm install in the repo root');
}
const { chromium } = loadPlaywright();

const EXT = path.join(__dirname, 'ext');
const PROFILE = path.join(__dirname, `.spike-profile-${process.pid}`);

async function main() {
  fs.rmSync(PROFILE, { recursive: true, force: true });
  const ctx = await chromium.launchPersistentContext(PROFILE, {
    channel: 'chromium',
    headless: true,
    args: [`--disable-extensions-except=${EXT}`, `--load-extension=${EXT}`],
  });

  const sw = ctx.serviceWorkers()[0] || (await ctx.waitForEvent('serviceworker'));
  const extensionId = sw.url().split('/')[2];

  // The page spawns the worker exactly the way the offscreen document does.
  // Playwright cannot attach to an offscreen document, so the same HTML is
  // opened as an ordinary extension page: same origin, same extension context
  // type, same worker. What it establishes is about the WORKER, which is the
  // context in question.
  const page = await ctx.newPage();
  await page.goto(`chrome-extension://${extensionId}/offscreen.html`);

  let answer = null;
  for (let i = 0; i < 40 && !answer; i++) {
    answer = await sw.evaluate(
      async () => (await chrome.storage.local.get('spikeAnswer')).spikeAnswer ?? null,
    );
    if (!answer) await new Promise((r) => setTimeout(r, 250));
  }
  // Read back from the service worker, a context known to have storage, so a
  // null here means the worker did not write rather than that we cannot see it.
  const writtenByWorker = await sw.evaluate(
    async () => (await chrome.storage.local.get('spikeKey')).spikeKey ?? null,
  );

  const out = {
    question: 'does a dedicated worker spawned from an offscreen document have chrome.storage.local?',
    answer,
    'read back from the service worker: what the dedicated worker wrote': writtenByWorker,
    consequence:
      writtenByWorker === null
        ? 'the worker cannot persist the key itself; whatever owns key material at rest has to be a document'
        : 'the worker could own key material at rest',
  };
  console.log(JSON.stringify(out, null, 2));
  fs.writeFileSync(path.join(__dirname, 'results.json'), `${JSON.stringify(out, null, 2)}\n`);
  await ctx.close();
  fs.rmSync(PROFILE, { recursive: true, force: true });
}

main().catch((e) => { console.error(e); process.exit(1); });
