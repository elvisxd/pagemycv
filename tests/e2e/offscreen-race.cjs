// The offscreen-readiness race, reproduced on demand.
//
// `chrome.offscreen.createDocument` resolves when the document has been
// created, which is EARLIER than when its scripts have run and registered
// their message listeners. Anything sent in that window comes back "Could not
// establish connection. Receiving end does not exist." The fix is in
// src/entrypoints/background.ts: wait for a `db:ping` answer, not for
// createDocument.
//
// This exists because the browser gate does NOT reliably catch the
// regression. Measured by removing the fix and running the gate three times:
// it failed once and passed twice. This script failed 3 of 3, with 2 to 3 of
// its 4 panels erroring each time. A guard that fires one run in three is not
// a guard, so this runs in CI as its own step.
//
// It started as spikes/phase-5/race.cjs and moved here once it was the only
// thing standing behind a fix: a spike is evidence you re-run on purpose, and
// nobody re-runs it on purpose.
//
// Run against a build in .output/chrome-mv3:
//   pnpm build && node tests/e2e/offscreen-race.cjs
//
// Expected with the fix in place: "4 of 4 panels opened".
const fs = require('node:fs');
const path = require('node:path');

function loadPlaywright() {
  for (const id of ['playwright', '../../node_modules/playwright']) {
    try {
      return require(id);
    } catch {}
  }
  throw new Error('playwright is not installed: run pnpm install in the repo root');
}
const { chromium } = loadPlaywright();

const EXT = path.join(__dirname, '../../.output/chrome-mv3');
const PROFILE = path.join(__dirname, `.race-profile-${process.pid}`);
const PANELS = 4;

async function main() {
  if (!fs.existsSync(EXT)) throw new Error(`no build at ${EXT}: run pnpm build first`);
  fs.rmSync(PROFILE, { recursive: true, force: true });
  const ctx = await chromium.launchPersistentContext(PROFILE, {
    channel: 'chromium',
    headless: true,
    args: [`--disable-extensions-except=${EXT}`, `--load-extension=${EXT}`, '--no-sandbox'],
  });
  const sw = ctx.serviceWorkers()[0] || (await ctx.waitForEvent('serviceworker'));
  const id = sw.url().split('/')[2];

  // Straight from a cold service worker into four panels at once, with
  // nothing in between. Keep it that way: this is the version that fails
  // every time without the fix, and a wait here is the most likely way to
  // turn it into one that fails some of the time.
  const pages = await Promise.all(Array.from({ length: PANELS }, () => ctx.newPage()));
  await Promise.all(pages.map((p) => p.goto(`chrome-extension://${id}/sidepanel.html`)));

  const bodies = await Promise.all(
    pages.map((p) =>
      p
        .getByRole('button', { name: /Import your CV|Re-import CV/ })
        .waitFor({ timeout: 15000 })
        .then(() => 'opened')
        .catch(async () => (await p.locator('body').innerText()).replace(/\s+/g, ' ').slice(0, 70)),
    ),
  );

  const opened = bodies.filter((b) => b === 'opened').length;
  console.log(`${opened} of ${PANELS} panels opened`);
  for (const [i, b] of bodies.entries()) if (b !== 'opened') console.log(`  panel ${i}: ${b}`);

  await ctx.close();
  fs.rmSync(PROFILE, { recursive: true, force: true });
  process.exit(opened === PANELS ? 0 : 1);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
