// Phase 3's unknowns, answered in a real browser rather than by reading.
//
// The plan in docs/04-phases.md assumed an embedded Greenhouse form would need
// a broad host permission over the company's careers domain, requested at
// runtime. That assumption is what this spike exists to test, because it is
// the difference between an extension that asks for `*://*/*` and one that
// asks for nothing at all.
//
//   parent   https://careers.acme.test/jobs/2272778   ← NOT in the manifest
//   iframe   https://boards.greenhouse.io/embed/...   ← IS in the manifest
//
// Run: node run.cjs
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

const EXT = path.join(__dirname, 'ext');
const PROFILE = path.join(__dirname, `.spike-profile-${process.pid}`);

const PARENT_URL = 'https://careers.acme.test/jobs/2272778/?application=true';
const EMBED_URL = 'https://boards.greenhouse.io/embed/job_app?for=acme&token=2272778';
const BOARD_URL = 'https://boards.greenhouse.io/acme/jobs/2272778';

const PARENT_HTML = `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>Careers at Acme</title></head>
<body>
  <h1>Senior Engineer</h1>
  <p>Acme's own careers page. The extension has no permission over this origin.</p>
  <!-- A field on the PARENT. If the extension can read this, it has reach it
       should not have. -->
  <label for="newsletter">Parent-page newsletter signup</label>
  <input id="newsletter" name="newsletter_email" type="email">
  <div id="grnhse_app"><iframe id="grnhse_iframe" src="${EMBED_URL}" width="100%" height="600"></iframe></div>
</body></html>`;

const EMBED_HTML = `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>Apply</title></head>
<body>
  <form id="application">
    <label for="first_name">First Name</label><input id="first_name" name="first_name">
    <label for="last_name">Last Name</label><input id="last_name" name="last_name">
    <label for="email">Email</label><input id="email" name="email" type="email">
    <label for="phone">Phone</label><input id="phone" name="phone" type="tel">
  </form>
</body></html>`;

const results = {};

async function main() {
  fs.rmSync(PROFILE, { recursive: true, force: true });
  const ctx = await chromium.launchPersistentContext(PROFILE, {
    channel: 'chromium',
    ...(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {}),
    headless: true,
    args: [`--disable-extensions-except=${EXT}`, `--load-extension=${EXT}`, '--no-sandbox'],
  });

  await ctx.route('https://careers.acme.test/**', (r) =>
    r.fulfill({ status: 200, contentType: 'text/html; charset=utf-8', body: PARENT_HTML }),
  );
  await ctx.route('https://boards.greenhouse.io/**', (r) =>
    r.fulfill({ status: 200, contentType: 'text/html; charset=utf-8', body: EMBED_HTML }),
  );

  let [sw] = ctx.serviceWorkers();
  if (!sw) sw = await ctx.waitForEvent('serviceworker', { timeout: 60000 });

  results.permissions = await sw.evaluate(() => globalThis.__spike.manifestPermissions());
  results.hostPermissions = await sw.evaluate(() => globalThis.__spike.manifestHosts());
  results.webNavigationAvailable = await sw.evaluate(() => globalThis.__spike.hasWebNavigation());

  // ── The question ──────────────────────────────────────────────────────
  const page = await ctx.newPage();
  await page.goto(PARENT_URL, { waitUntil: 'load' });
  await page.waitForTimeout(2500);

  const seen = await sw.evaluate(() => globalThis.__spike.seen());
  results.framesThatAnnounced = seen;
  results.injectedIntoCrossOriginIframe = seen.some((f) => !f.isTop && f.fields > 0);
  results.injectedIntoParent = seen.some((f) => f.isTop && f.url.includes('careers.acme.test'));

  const tabId = seen[0]?.tabId ?? null;
  const embedFrame = seen.find((f) => !f.isTop);
  results.embedFrameId = embedFrame?.frameId ?? null;

  if (tabId !== null && embedFrame) {
    // Addressing that one frame by id, with no webNavigation and no host
    // permission over the parent.
    results.targetedReadWorks = await sw
      .evaluate(
        ([t, f]) => globalThis.__spike.read(t, f),
        [tabId, embedFrame.frameId],
      )
      .then((r) => ({ ok: true, ...r }))
      .catch((e) => ({ ok: false, error: String(e) }));

    // What a broadcast with no frameId actually returns when several frames
    // could answer.
    results.broadcastReturns = await sw
      .evaluate((t) => globalThis.__spike.broadcast(t), tabId)
      .then((r) => ({ ok: true, ...r }))
      .catch((e) => ({ ok: false, error: String(e) }));
  }

  // Can the background reach the parent page at all? It must not be able to.
  results.parentReachable = await sw
    .evaluate((t) => globalThis.__spike.read(t, 0), tabId)
    .then((r) => ({ reached: true, ...r }))
    .catch((e) => ({ reached: false, error: String(e) }));

  // ── A frame injected AFTER load, which the declarative flag may miss ──
  await sw.evaluate(() => {
    const s = globalThis.__spike.seen();
    s.length = 0;
  });
  await page.evaluate((url) => {
    const f = document.createElement('iframe');
    f.id = 'late';
    f.src = url;
    document.body.appendChild(f);
  }, EMBED_URL);
  await page.waitForTimeout(2500);
  const lateSeen = await sw.evaluate(() => globalThis.__spike.seen());
  results.lateFrameInjected = lateSeen.some((f) => !f.isTop);
  results.lateFrames = lateSeen;

  // ── match_about_blank, which is a security question, not a feature ───
  //
  // An about:blank or srcdoc frame inherits its PARENT's origin. The manifest
  // asks for match_about_blank, so the question is whether that hands us a
  // frame belonging to careers.acme.test — an origin we have no permission
  // over. It must not.
  await sw.evaluate(() => {
    globalThis.__spike.seen().length = 0;
  });
  await page.evaluate(() => {
    const blank = document.createElement('iframe');
    blank.id = 'blank';
    document.body.appendChild(blank);
    blank.contentDocument?.write('<input name="inherited_from_parent">');
    const srcdoc = document.createElement('iframe');
    srcdoc.id = 'srcdoc';
    srcdoc.srcdoc = '<input name="srcdoc_field">';
    document.body.appendChild(srcdoc);
  });
  await page.waitForTimeout(2000);
  const blankSeen = await sw.evaluate(() => globalThis.__spike.seen());
  results.aboutBlankFramesInjected = blankSeen;
  results.matchAboutBlankLeaksParentOrigin = blankSeen.some((f) =>
    /careers\.acme\.test|about:blank|about:srcdoc/.test(f.url),
  );

  // ── The standalone board page, for the fallback path ─────────────────
  const standalone = await ctx.newPage();
  await standalone.goto(BOARD_URL, { waitUntil: 'load' });
  await standalone.waitForTimeout(1500);
  const afterStandalone = await sw.evaluate(() => globalThis.__spike.seen());
  results.standaloneStillWorks = afterStandalone.some((f) => f.isTop && f.fields > 0);

  await ctx.close();
}

main()
  .then(() => {
    fs.writeFileSync(path.join(__dirname, 'results.json'), `${JSON.stringify(results, null, 2)}\n`);
    console.log(JSON.stringify(results, null, 2));
  })
  .catch((e) => {
    console.error('FATAL', e);
    process.exitCode = 1;
  })
  .finally(() => {
    fs.rmSync(PROFILE, { recursive: true, force: true });
  });
