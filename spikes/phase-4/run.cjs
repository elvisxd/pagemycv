// Phase 4's unknowns, answered in a real browser.
//
// docs/04-phases.md has carried one open question since Phase 0: are
// Workday's shadow roots open or closed? It was never runnable, because it
// was written as a question about Workday and answering it needs a real
// application page behind a real account.
//
// Asked the other way round it IS runnable, and the answer is worth more.
// `chrome.dom.openOrClosedShadowRoot` is claimed to handle either kind. If
// that claim holds, open-vs-closed stops mattering and the question is
// retired rather than answered. If it does not hold, Phase 4 changes shape.
// A closed root is a closed root whoever attached it, so the fixture here
// attaches its own and the answer is about the browser, not about Acme.
//
// What this spike does NOT establish: that Workday behaves like the fixture.
// The overlay and the listbox below are MODELLED on the documented
// behaviour, so they test our handling of it, not that it is real. Results
// are labelled accordingly.
//
// Run: node run.cjs
const fs = require('node:fs');
const path = require('node:path');
const FIXTURE = require('./fixture.cjs');

function loadPlaywright() {
  for (const id of ['playwright', '../../node_modules/playwright']) {
    try {
      return require(id);
    } catch {}
  }
  throw new Error('playwright is not installed: run pnpm install in the repo root');
}
const { chromium } = loadPlaywright();

const EXT = path.join(__dirname, 'ext');
const PROFILE = path.join(__dirname, `.spike-profile-${process.pid}`);
const APPLY_URL =
  'https://acme.wd5.myworkdayjobs.com/en-US/acme/job/Madrid/Engineer_R-1/apply/applyManually';

const verified = {};
const modelled = {};

async function main() {
  fs.rmSync(PROFILE, { recursive: true, force: true });
  const ctx = await chromium.launchPersistentContext(PROFILE, {
    channel: 'chromium',
    ...(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {}),
    headless: true,
    args: [`--disable-extensions-except=${EXT}`, `--load-extension=${EXT}`, '--no-sandbox'],
  });

  await ctx.route('https://acme.wd5.myworkdayjobs.com/**', (r) =>
    r.fulfill({
      status: 200,
      contentType: 'text/html; charset=utf-8',
      body: r.request().url().endsWith('/embedded-step')
        ? '<!doctype html><title>step</title><input name="insideFramedShadow">'
        : FIXTURE,
    }),
  );

  let [sw] = ctx.serviceWorkers();
  if (!sw) sw = await ctx.waitForEvent('serviceworker', { timeout: 60000 });

  const page = await ctx.newPage();
  await page.goto(APPLY_URL, { waitUntil: 'load' });
  await page.waitForTimeout(2000);

  const seen = await sw.evaluate(() => globalThis.__spike.seen());
  const top = seen.find((f) => f.isTop);
  if (!top) throw new Error('the content script never ran in the top frame');

  const ask = (question) =>
    sw
      .evaluate(
        ([t, f, q]) => globalThis.__spike.ask(t, f, q),
        [top.tabId, top.frameId, question],
      )
      .then((r) => (r?.ok ? r.value : { error: r?.error ?? 'no answer' }))
      .catch((e) => ({ error: String(e) }));

  verified.apiPresent = await ask('apiPresent');
  verified.rootsReallyClosed = await ask('rootsReallyClosed');
  verified.reach = await ask('reach');
  verified.write = await ask('write');
  verified.writeComposed = await ask('writeComposed');
  verified.visibility = await ask('visibility');
  verified.labels = await ask('labels');
  verified.frameInShadow = await ask('frameInShadow');

  // Is a frame nested inside a closed shadow root injected into at all? The
  // roster answers that, not the DOM probe.
  verified.frameInShadowInjected = seen.some((f) => /embedded-step/.test(f.url));
  verified.framesSeen = seen.map((f) => ({ frameId: f.frameId, url: f.url, isTop: f.isTop }));

  modelled.overlay = await ask('overlay');
  modelled.listboxSync = await ask('listboxSync');
  modelled.listboxAsync = await ask('listboxAsync');

  // A real click, for the comparison the overlay probe exists to make.
  modelled.realClickTimesOut = await page
    .click('[data-automation-id="pageFooterNextButton"]', { timeout: 2500 })
    .then(() => false)
    .catch(() => true);

  await ctx.close();
}

main()
  .then(() => {
    const out = {
      verifiedAboutTheBrowser: verified,
      modelledOnDocumentedBehaviour: modelled,
    };
    fs.writeFileSync(path.join(__dirname, 'results.json'), `${JSON.stringify(out, null, 2)}\n`);
    console.log(JSON.stringify(out, null, 2));
  })
  .catch((e) => {
    console.error('FATAL', e);
    process.exitCode = 1;
  })
  .finally(() => {
    fs.rmSync(PROFILE, { recursive: true, force: true });
  });
