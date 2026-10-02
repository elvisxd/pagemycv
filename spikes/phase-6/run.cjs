// Can the gate exercise on-demand injection at all?
//
// Filling a form on a site the manifest does not name needs the content
// script injected at the moment the person asks, with no host permission
// over the web. Chrome offers a few ways in: `activeTab` (granted by a click
// on the action or a keyboard command), `optional_host_permissions`
// (granted by a prompt), and nothing else. The design question is which of
// them the browser gate — Playwright, headless, no human — can actually
// drive. A mechanism the gate cannot drive is one the gate cannot protect.
//
// Run: pnpm build is NOT needed. node spikes/phase-6/run.cjs
const fs = require('node:fs');
const path = require('node:path');
const { chromium } = require('../../node_modules/playwright');

const EXT = path.join(__dirname, 'ext');
const PROFILE = path.join(__dirname, `.spike-profile-${process.pid}`);
const PAGE = 'https://careers.unknown-company.test/apply';
const FRAME = 'https://embedded.other-origin.test/form';

async function main() {
  fs.rmSync(PROFILE, { recursive: true, force: true });
  const ctx = await chromium.launchPersistentContext(PROFILE, {
    channel: 'chromium',
    headless: true,
    args: [`--disable-extensions-except=${EXT}`, `--load-extension=${EXT}`, '--no-sandbox'],
  });
  // A page on an origin the manifest does not name, embedding a cross-origin
  // frame: the shape of a company careers page.
  await ctx.route(`${FRAME}**`, (r) =>
    r.fulfill({ contentType: 'text/html', body: '<input name="inner"><input name="inner2">' }),
  );
  await ctx.route(`${PAGE}**`, (r) =>
    r.fulfill({
      contentType: 'text/html',
      body: `<input name="outer"><iframe src="${FRAME}"></iframe>`,
    }),
  );
  const sw = ctx.serviceWorkers()[0] || (await ctx.waitForEvent('serviceworker'));
  const page = await ctx.newPage();
  await page.goto(PAGE);
  await page.waitForLoadState('load');

  const results = {};
  const tabId = await sw.evaluate(async () => (await chrome.tabs.query({ active: true }))[0].id);

  // 1. No gesture at all. Expected to fail; recorded so the later ones mean something.
  results.coldInject = await sw.evaluate((id) => globalThis.tryInject(id, true), tabId);

  // 2. permissions.request from the worker with no gesture.
  results.requestNoGesture = await sw.evaluate(() => globalThis.tryRequest('https://careers.unknown-company.test/*'));

  // 3. A keyboard command. Playwright keys go to the page; whether the
  //    browser-level command handler sees them is the question.
  await page.bringToFront();
  await page.keyboard.press('Alt+Shift+8');
  await new Promise((r) => setTimeout(r, 800));
  results.afterKeyboardCommand = await sw.evaluate(() => ({
    command: globalThis.spike.command ?? null,
    inject: globalThis.spike.afterCommand ?? null,
  }));

  // 4. _execute_action via keyboard: the action click path, if a key can reach it.
  await page.keyboard.press('Alt+Shift+9');
  await new Promise((r) => setTimeout(r, 800));
  results.afterExecuteAction = await sw.evaluate(() => ({
    clicked: globalThis.spike.actionClicked ?? null,
    inject: globalThis.spike.afterActionClick ?? null,
  }));

  // 5. Playwright's own escape hatch: grant the origin through the browser
  //    context. If this works, it is a HARNESS grant, not something the
  //    extension can do — recorded as such.
  let contextGrant = null;
  try {
    await ctx.grantPermissions([], { origin: 'https://careers.unknown-company.test' });
    contextGrant = await sw.evaluate((id) => globalThis.tryInject(id, true), tabId);
  } catch (e) {
    contextGrant = { ok: false, error: String(e.message) };
  }
  results.afterContextGrant = contextGrant;

  // 6. chrome.permissions.contains — what the browser thinks is granted now.
  results.granted = await sw.evaluate(() => chrome.permissions.getAll());

  const out = {
    question: 'which on-demand injection route can a headless Playwright gate drive?',
    results,
  };
  console.log(JSON.stringify(out, null, 2));
  fs.writeFileSync(path.join(__dirname, 'results.json'), `${JSON.stringify(out, null, 2)}\n`);
  await ctx.close();
  fs.rmSync(PROFILE, { recursive: true, force: true });
}
main().catch((e) => { console.error(e); process.exit(1); });
