// The Phase 1 gate, from docs/04-phases.md, run against a real browser.
//
// Playwright cannot drive the real side panel surface, so the panel document is
// opened as an ordinary page. Same document, same component tree, same
// messaging. See docs/06-environment.md.
const { chromium } = require('/opt/node22/lib/node_modules/playwright');
const path = require('node:path');
const fs = require('node:fs');

const EXT = path.join(__dirname, '../../.output/chrome-mv3');
const PROFILE = path.join(__dirname, '../../.e2e-profile');
const PASSPHRASE = 'correct horse battery staple';
const CV = fs.existsSync('/home/user/byte/perfil/cv.md')
  ? fs.readFileSync('/home/user/byte/perfil/cv.md', 'utf8')
  : fs.readFileSync(path.join(__dirname, 'fixture-cv.md'), 'utf8');

const results = {};
const offOrigin = [];
let failures = 0;

function check(name, pass, detail) {
  results[name] = { pass, ...(detail ? { detail } : {}) };
  if (!pass) failures++;
}

async function launch() {
  const ctx = await chromium.launchPersistentContext(PROFILE, {
    executablePath: '/opt/pw-browsers/chromium',
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
  let [sw] = ctx.serviceWorkers();
  if (!sw) sw = await ctx.waitForEvent('serviceworker', { timeout: 30000 });
  const id = sw.url().split('/')[2];
  const page = await ctx.newPage();
  await page.goto(`chrome-extension://${id}/sidepanel.html`);
  return { ctx, sw, page, id };
}

(async () => {
  fs.rmSync(PROFILE, { recursive: true, force: true });

  // ── Run 1: create, import, read back ────────────────────────────────
  let { ctx, page } = await launch();

  await page.getByLabel('Passphrase').fill(PASSPHRASE);
  await page.getByRole('button', { name: 'Create the vault' }).click();
  await page
    .getByRole('button', { name: /Import your CV|Re-import CV/ })
    .waitFor({ timeout: 60000 });
  check('vault created', true);

  await page.getByRole('button', { name: /Import your CV|Re-import CV/ }).click();
  await page.getByTestId('cv-markdown').fill(CV);
  await page.getByRole('button', { name: 'Import' }).click();
  await page.getByTestId('import-result').waitFor({ timeout: 60000 });
  const importSummary = await page.getByTestId('import-result').innerText();
  const roleCount = Number((importSummary.match(/(\d+) roles/) || [])[1] || 0);
  check('cv imported', roleCount >= 5, importSummary);

  const bodyRun1 = await page.locator('body').innerText();
  check('experience is visible after import', /experience ·/i.test(bodyRun1));
  check('sensitive fields are listed and empty', /never filled automatically/i.test(bodyRun1));

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
      containsEmployer: all.includes('Nesty'),
    };
  });
  check('database file exists on disk', scan.files.length > 0, JSON.stringify(scan.files));
  // city_enc is encrypted; employer is not, because it is already on a public CV.
  check('encrypted column does not appear in plaintext', scan.containsCity === false);
  check(
    'unencrypted column does appear, so the scan really reads the file',
    scan.containsEmployer === true,
  );

  await ctx.close();

  // ── Run 2: same profile directory, after a full browser restart ─────
  ({ ctx, page } = await launch());
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

  console.log(JSON.stringify(results, null, 2));
  console.log(failures === 0 ? '\nGATE PASSED' : `\nGATE FAILED: ${failures} check(s)`);
  process.exit(failures === 0 ? 0 : 1);
})().catch((e) => {
  console.error('FATAL', e);
  process.exit(1);
});
