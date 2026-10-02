// Second question: if the PERSON grants a site (one click on Chrome's own
// prompt, remembered per origin), can the gate stand in for that click?
//
// Chrome keeps an extension's granted optional permissions in the profile's
// Preferences file. If writing the origin there before launch makes
// permissions.contains() true and executeScript() work, the gate can drive
// the whole path with the grant standing in for the prompt — which is what
// the grant IS, so the test would be honest about what it skips.
//
// Also measured: whether allFrames reaches a cross-origin iframe with only
// the parent origin granted, and with both.
const fs = require('node:fs');
const path = require('node:path');
const { chromium } = require('../../node_modules/playwright');

const EXT = path.join(__dirname, 'ext');
const PROFILE = path.join(__dirname, `.spike2-profile-${process.pid}`);
const TOP = 'https://careers.unknown-company.test';
const INNER = 'https://embedded.other-origin.test';

const launch = () =>
  chromium.launchPersistentContext(PROFILE, {
    channel: 'chromium',
    headless: true,
    args: [`--disable-extensions-except=${EXT}`, `--load-extension=${EXT}`, '--no-sandbox'],
  });

async function wire(ctx) {
  await ctx.route(`${INNER}/**`, (r) =>
    r.fulfill({ contentType: 'text/html', body: '<input name="inner"><input name="inner2">' }),
  );
  await ctx.route(`${TOP}/**`, (r) =>
    r.fulfill({ contentType: 'text/html', body: `<input name="outer"><iframe src="${INNER}/form"></iframe>` }),
  );
}

function grantInPreferences(extId, origins) {
  const prefPath = path.join(PROFILE, 'Default', 'Preferences');
  const prefs = JSON.parse(fs.readFileSync(prefPath, 'utf8'));
  const s = prefs.extensions.settings[extId];
  s.granted_permissions = s.granted_permissions || {};
  s.granted_permissions.explicit_host = origins;
  s.granted_permissions.scriptable_host = origins;
  fs.writeFileSync(prefPath, JSON.stringify(prefs));
  return Object.keys(prefs.extensions.settings);
}

async function main() {
  fs.rmSync(PROFILE, { recursive: true, force: true });
  let ctx = await launch();
  let sw = ctx.serviceWorkers()[0] || (await ctx.waitForEvent('serviceworker'));
  const extId = sw.url().split('/')[2];
  await ctx.close();

  const results = { extId };
  // Round 1: grant the TOP origin only.
  results.settingsKeys = grantInPreferences(extId, [`${TOP}/*`]);
  ctx = await launch();
  await wire(ctx);
  sw = ctx.serviceWorkers()[0] || (await ctx.waitForEvent('serviceworker'));
  results.containsAfterPrefsGrant = await sw.evaluate((o) => chrome.permissions.contains({ origins: [o] }), `${TOP}/*`);
  results.getAll = await sw.evaluate(() => chrome.permissions.getAll());
  let page = await ctx.newPage();
  await page.goto(`${TOP}/apply`);
  await page.waitForLoadState('load');
  let tabId = await sw.evaluate(async () => (await chrome.tabs.query({ active: true }))[0].id);
  results.injectTopOnly_allFrames = await sw.evaluate((id) => globalThis.tryInject(id, true), tabId);
  results.injectTopOnly_topFrame = await sw.evaluate((id) => globalThis.tryInject(id, false), tabId);
  await ctx.close();

  // Round 2: grant both origins.
  grantInPreferences(extId, [`${TOP}/*`, `${INNER}/*`]);
  ctx = await launch();
  await wire(ctx);
  sw = ctx.serviceWorkers()[0] || (await ctx.waitForEvent('serviceworker'));
  page = await ctx.newPage();
  await page.goto(`${TOP}/apply`);
  await page.waitForLoadState('load');
  tabId = await sw.evaluate(async () => (await chrome.tabs.query({ active: true }))[0].id);
  results.injectBoth_allFrames = await sw.evaluate((id) => globalThis.tryInject(id, true), tabId);
  // And: can the extension REMOVE the grant itself (so "forget this site" is possible)?
  results.removeOwnGrant = await sw.evaluate(async (o) => {
    try { return { ok: true, removed: await chrome.permissions.remove({ origins: [o] }) }; }
    catch (e) { return { ok: false, error: String(e.message) }; }
  }, `${INNER}/*`);
  results.containsAfterRemove = await sw.evaluate((o) => chrome.permissions.contains({ origins: [o] }), `${INNER}/*`);
  await ctx.close();

  const out = { question: 'can a Preferences-file grant stand in for the person clicking Allow?', results };
  console.log(JSON.stringify(out, null, 2));
  fs.writeFileSync(path.join(__dirname, 'results-2.json'), `${JSON.stringify(out, null, 2)}\n`);
  fs.rmSync(PROFILE, { recursive: true, force: true });
}
main().catch((e) => { console.error(e); process.exit(1); });
