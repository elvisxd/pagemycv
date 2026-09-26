// The Phase 1 gate, from docs/04-phases.md, run against a real browser.
//
// Playwright cannot drive the real side panel surface, so the panel document is
// opened as an ordinary page. Same document, same component tree, same
// messaging. See docs/06-environment.md.
const path = require('node:path');
const fs = require('node:fs');

// Resolve Playwright from this project first, then from a global install, so
// the gate runs the same way on a contributor's machine and in CI.
function loadPlaywright() {
  for (const id of ['playwright', '/opt/node22/lib/node_modules/playwright']) {
    try {
      return require(id);
    } catch {}
  }
  throw new Error('playwright is not installed: run pnpm install');
}
const { chromium } = loadPlaywright();

const EXT = path.join(__dirname, '../../.output/chrome-mv3');
const PROFILE = path.join(__dirname, '../../.e2e-profile');
const PASSPHRASE = 'correct horse battery staple';

// The real CV when this checkout sits next to Byte, otherwise a fixture with
// the same shape. The gate must not depend on one person's filesystem.
const REAL_CV = process.env.PAGEMYCV_CV ?? '/home/user/byte/perfil/cv.md';
const CV = fs.existsSync(REAL_CV)
  ? fs.readFileSync(REAL_CV, 'utf8')
  : fs.readFileSync(path.join(__dirname, 'fixture-cv.md'), 'utf8');

const results = {};
const offOrigin = [];
let failures = 0;
/** Every context opened, so a crash cannot leave one holding the profile. */
const opened = [];

function check(name, pass, detail) {
  results[name] = { pass, ...(detail ? { detail } : {}) };
  if (!pass) failures++;
}

async function launch() {
  const ctx = await chromium.launchPersistentContext(PROFILE, {
    // 'chromium' selects the full browser. The default headless shell cannot
    // load extensions at all, so without this the service worker never starts
    // and every check below times out waiting for it.
    channel: 'chromium',
    // Only pinned when a machine needs a specific binary; CI uses Playwright's.
    ...(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {}),
    headless: true,
    args: [`--disable-extensions-except=${EXT}`, `--load-extension=${EXT}`, '--no-sandbox'],
  });
  // Invariant 5: nothing leaves the machine. Watch every request in the context.
  ctx.on('request', (r) => {
    const u = r.url();
    if (!u.startsWith('chrome-extension://') && !u.startsWith('data:') && !u.startsWith('blob:')) {
      offOrigin.push(u);
    }
  });
  opened.push(ctx);
  let [sw] = ctx.serviceWorkers();
  if (!sw) {
    sw = await ctx.waitForEvent('serviceworker', { timeout: 60000 }).catch(() => {
      throw new Error(
        'the extension service worker never started. A headless shell cannot load ' +
          'extensions: launch with channel "chromium".',
      );
    });
  }
  const id = sw.url().split('/')[2];
  return { ctx, sw, id };
}

async function main() {
  fs.rmSync(PROFILE, { recursive: true, force: true });

  // ── Run 1: create, import, read back ────────────────────────────────
  let { ctx, id } = await launch();

  // Concurrency, against a cold profile. Four panels are navigated together so
  // none has settled the database open before the others start: that is what
  // makes them contend for installOpfsSAHPoolVfs, which holds exclusive file
  // handles. An earlier version navigated one page first, so the rest took the
  // already-open fast path and the check passed even without the guard.
  const pages = await Promise.all([ctx.newPage(), ctx.newPage(), ctx.newPage(), ctx.newPage()]);
  await Promise.all(pages.map((p) => p.goto(`chrome-extension://${id}/sidepanel.html`)));
  const raced = await Promise.all(
    pages.map((p) =>
      p
        .getByRole('button', { name: 'Create the vault' })
        .waitFor({ timeout: 60000 })
        .then(() => 'create')
        .catch(async () => (await p.locator('body').innerText()).slice(0, 60)),
    ),
  );
  check(
    'four concurrent cold opens all reach the create screen',
    raced.every((r) => r === 'create'),
    raced.join(' | '),
  );
  let page = pages[0];
  await Promise.all(pages.slice(1).map((p) => p.close()));

  // The passphrase minimum is the worker's rule, not the panel's. Enter
  // bypasses the disabled button, which is how this reaches the worker at all.
  await page.getByLabel('Passphrase').fill('short');
  await page.keyboard.press('Enter');
  const shortMsg = await page
    .getByRole('alert')
    .innerText({ timeout: 30000 })
    .catch(() => '(no message appeared)');
  check('a short passphrase is refused by the worker', /at least 12/.test(shortMsg), shortMsg);

  await page.getByLabel('Passphrase').fill(PASSPHRASE);
  await page.getByRole('button', { name: 'Create the vault' }).click();
  await page
    .getByRole('button', { name: /Import your CV|Re-import CV/ })
    .waitFor({ timeout: 60000 });
  // Was a hardcoded `true`, which could never fail and was still reported as
  // evidence. Assert something the screen actually shows.
  check('vault created', /Lock/.test(await page.locator('body').innerText()));

  await page.getByRole('button', { name: /Import your CV|Re-import CV/ }).click();
  await page.getByTestId('cv-markdown').fill(CV);
  await page.getByRole('button', { name: 'Import' }).click();
  await page.getByTestId('import-result').waitFor({ timeout: 60000 });
  const importSummary = await page.getByTestId('import-result').innerText();
  const roleCount = Number((importSummary.match(/(\d+) roles/) || [])[1] || 0);
  check('cv imported', roleCount >= 5, importSummary);

  const bodyRun1 = await page.locator('body').innerText();
  // The rendered count must equal what was imported, not merely be non-zero.
  const shown = Number((bodyRun1.match(/EXPERIENCE · (\d+)/i) || [])[1] || 0);
  check(
    'every imported role is stored and rendered',
    shown === roleCount,
    `${shown} of ${roleCount}`,
  );
  check('education is stored', /education · \d/i.test(bodyRun1));
  check('links are stored', /\blinks\b/i.test(bodyRun1));

  // "empty" must mean empty. An earlier version matched only the section title,
  // so it would have passed with every sensitive field populated.
  const sensitiveBlock = bodyRun1.slice(bodyRun1.search(/SENSITIVE ·/i));
  const empties = (sensitiveBlock.match(/\bempty\b/g) || []).length;
  const stored = (sensitiveBlock.match(/\bstored\b/g) || []).length;
  check(
    'every sensitive field is listed and empty',
    empties >= 14 && stored === 0,
    `${empties} empty, ${stored} stored`,
  );

  // A CV that does not parse must change nothing. This is the data-loss path:
  // importCv deletes before it inserts.
  await page.getByRole('button', { name: /Re-import CV/ }).click();
  await page
    .getByTestId('cv-markdown')
    .fill('Dear Hiring Manager,\n\nI am interested.\n\nRegards\n');
  await page.getByRole('button', { name: 'Import' }).click();
  const refusal = await page
    .getByRole('alert')
    .innerText()
    .catch(() => '');
  check('a document that is not a CV is refused', /does not look like a CV/.test(refusal), refusal);
  await page.getByRole('button', { name: 'Cancel' }).click();
  const afterRefusal = await page.locator('body').innerText();
  check(
    'the profile survived the refused import',
    Number((afterRefusal.match(/EXPERIENCE · (\d+)/i) || [])[1] || 0) === roleCount,
  );

  // The plaintext scan, run inside the offscreen document, which is a Window
  // with access to the extension's own origin private file system.
  const offscreen = ctx.pages().find((p) => p.url().endsWith('offscreen.html'));
  const scan = await (offscreen || page).evaluate(async () => {
    const seen = [];
    async function walk(dir, prefix) {
      for await (const [name, handle] of dir.entries()) {
        if (handle.kind === 'directory') await walk(handle, `${prefix}/${name}`);
        else {
          const file = await handle.getFile();
          seen.push({ path: `${prefix}/${name}`, size: file.size, text: await file.text() });
        }
      }
    }
    await walk(await navigator.storage.getDirectory(), '');
    const all = seen.map((s) => s.text).join('\n');
    return {
      files: seen.map((s) => ({ path: s.path, size: s.size })),
      containsCity: all.includes('Orlando'),
      containsRegion: all.includes('Florida'),
      containsEmployer: all.includes('Nesty'),
    };
  });
  check('database file exists on disk', scan.files.length > 0, JSON.stringify(scan.files));
  // Without this, "Orlando is not in the file" would also pass if the city had
  // never been stored at all.
  check(
    'the plaintext region IS on disk, so the city was stored too',
    scan.containsRegion === true,
  );
  // city_enc is encrypted; employer is not, because it is already on a public CV.
  check('encrypted column does not appear in plaintext', scan.containsCity === false);
  check(
    'unencrypted column does appear, so the scan really reads the file',
    scan.containsEmployer === true,
  );

  await ctx.close();

  // ── Run 2: same profile directory, after a full browser restart ─────
  ({ ctx, id } = await launch());
  page = await ctx.newPage();
  await page.goto(`chrome-extension://${id}/sidepanel.html`);
  await page.getByLabel('Passphrase').waitFor({ timeout: 60000 });
  const lockedBody = await page.locator('body').innerText();
  check('vault is locked after restart', /locked/i.test(lockedBody), lockedBody.slice(0, 80));

  await page.getByLabel('Passphrase').fill('the wrong passphrase');
  await page.getByRole('button', { name: 'Unlock' }).click();
  await page.getByRole('alert').waitFor({ timeout: 60000 });
  check(
    'a wrong passphrase is refused',
    /wrong passphrase/i.test(await page.getByRole('alert').innerText()),
  );

  await page.getByLabel('Passphrase').fill(PASSPHRASE);
  await page.getByRole('button', { name: 'Unlock' }).click();
  await page.getByRole('button', { name: 'Lock' }).waitFor({ timeout: 60000 });
  const bodyRun2 = await page.locator('body').innerText();
  check('the profile survived the restart', /experience ·/i.test(bodyRun2));
  check('the same roles are there', bodyRun2.includes('Nesty'), bodyRun2.slice(0, 120));

  await ctx.close();

  check(
    'no request left the extension origin',
    offOrigin.length === 0,
    offOrigin.slice(0, 5).join(', '),
  );
}

// Cleanup is unconditional. Without it a thrown assertion leaves a live
// persistent context holding .e2e-profile, and the next run fails for a reason
// that has nothing to do with the code under test.
main()
  .then(() => {
    console.log(JSON.stringify(results, null, 2));
    console.log(failures === 0 ? '\nGATE PASSED' : `\nGATE FAILED: ${failures} check(s)`);
  })
  .catch((e) => {
    failures++;
    console.log(JSON.stringify(results, null, 2));
    console.error(`\nFATAL ${e.message}`);
    console.log('\nGATE FAILED: crashed before finishing');
  })
  .finally(async () => {
    for (const ctx of opened) await ctx.close().catch(() => {});
    fs.rmSync(PROFILE, { recursive: true, force: true });
    process.exit(failures === 0 ? 0 : 1);
  });
