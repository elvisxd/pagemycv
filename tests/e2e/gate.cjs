// The Phase 1 and Phase 2 gates, from docs/04-phases.md, run against a real
// browser.
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
/**
 * Per-process, because the whole point of this profile is that run 2 opens
 * the same directory run 1 wrote. A fixed path makes two concurrent gates
 * share one vault, and the second one deletes it out from under the first:
 * the failure looks exactly like a race in the extension, which is the last
 * thing you want to chase while testing a race in the extension. One was
 * seen, from a stray manual run alongside a stability loop.
 */
const PROFILE = path.join(__dirname, `../../.e2e-profile-${process.pid}`);
// A second, empty profile: the extension removed and installed again, which
// is the case a backup exists for. Restoring into the profile that made the
// backup would prove much less, because everything is still there.
const FRESH_PROFILE = path.join(__dirname, `../../.e2e-profile-fresh-${process.pid}`);
const BACKUP_FILE = path.join(__dirname, `../../.e2e-backup-${process.pid}.json`);

// The real CV when this checkout sits next to Byte, otherwise a fixture with
// the same shape. The gate must not depend on one person's filesystem.
const REAL_CV = process.env.PAGEMYCV_CV ?? '/home/user/byte/perfil/cv.md';
const FIXTURE_CV = fs.readFileSync(path.join(__dirname, 'fixture-cv.md'), 'utf8');
const CV = fs.existsSync(REAL_CV) ? fs.readFileSync(REAL_CV, 'utf8') : FIXTURE_CV;

/** What the fixture CV says, and therefore what a filled form must contain. */
const EXPECT = {
  first: 'Ada',
  last: 'M. Lovelace',
  full: 'Ada M. Lovelace',
  email: 'ada@lovelace.test',
  phone: '+1 407 555 0142',
  employer: 'Nesty C.A.',
  linkedin: 'https://linkedin.com/in/ada-lovelace',
  github: 'https://github.com/adalovelace',
  website: 'https://adalovelace.dev/work',
};

// The two fixture boards. Served from disk by the harness through
// context.route, so the URL a content script matches on is genuinely
// https://jobs.lever.co/... while nothing is fetched from the network. The
// extension is not modified for the test in any way.
// careers.acme.test is the company's own domain. It is deliberately NOT in
// the extension's match list: the gate serves it so the embedded case can be
// tested, and the extension must never be injected into it.
const FIXTURE_ORIGINS = [
  'https://jobs.lever.co',
  'https://boards.greenhouse.io',
  'https://careers.acme.test',
  'https://jobs.ashbyhq.com',
  'https://acme.wd5.myworkdayjobs.com',
  // The generic fixture: a declared host with an empty map. See BOARDS.generic.
  'https://apply.workable.com',
];

const BOARDS = {
  lever: {
    url: 'https://jobs.lever.co/acme/8f2a1b6c-0000-4c1a-9f10-2b5e7d4a1c33/apply',
    file: path.join(__dirname, '../fixtures/lever.html'),
  },
  greenhouse: {
    url: 'https://boards.greenhouse.io/acme/jobs/4102938',
    file: path.join(__dirname, '../fixtures/greenhouse.html'),
  },
  // A form with no file input at all. Most application pages have none, and
  // the CV bytes must not cross into a page that has nowhere to put them.
  nofile: {
    url: 'https://jobs.lever.co/acme/no-file-here/apply',
    file: path.join(__dirname, '../fixtures/lever-nofile.html'),
  },
  // A board page with no application form. The content script runs here, so
  // the refusal must name the right reason.
  listing: {
    url: 'https://jobs.lever.co/acme/',
    file: path.join(__dirname, '../fixtures/board-listing.html'),
  },
  // A careers page with no embed at all. No content script anywhere, so the
  // refusal must be immediate rather than spending the retry budget.
  plainPage: {
    url: 'https://careers.acme.test/about-us',
    file: path.join(__dirname, '../fixtures/careers-no-embed.html'),
  },
  // Phase 3: the case that is actually most applications. A company careers
  // page embedding the board's form in a cross-origin iframe.
  careers: {
    url: 'https://careers.acme.test/jobs/4102938/?application=true',
    file: path.join(__dirname, '../fixtures/careers-embed.html'),
  },
  embed: {
    url: 'https://boards.greenhouse.io/embed/job_app?for=acme&token=4102938',
    file: path.join(__dirname, '../fixtures/greenhouse.html'),
  },
  // Every label copied from a real Ashby application. The screening
  // questions on it are the reason this fixture exists: they are what a CV
  // cannot answer, and two of them exposed bugs in shipped code.
  ashby: {
    url: 'https://jobs.ashbyhq.com/npx/a367c10e-7fa8-4276-bf76-19252af8787c/application',
    file: path.join(__dirname, '../fixtures/ashby.html'),
  },
  // Phase 4: every control inside a CLOSED shadow root, plus a dropdown that
  // is not a <select> and a honeypot the document's own stylesheet cannot
  // reach. Before this phase the page described as having zero fields.
  workday: {
    url: 'https://acme.wd5.myworkdayjobs.com/en-US/acme/job/Madrid/Engineer_R-1/apply/applyManually',
    file: path.join(__dirname, '../fixtures/workday.html'),
  },
  // A form with no field name any map knows, on a declared host whose map is
  // empty. What it measures is the standards-based passes carrying a form on
  // their own — which is all PageMyCV has on a site nobody has named. The
  // declared host is what gets the content script there; on an unknown host
  // that part needs a click the gate cannot make (spikes/phase-6).
  generic: {
    url: 'https://apply.workable.com/acme/j/A1B2C3D4E5/apply/',
    file: path.join(__dirname, '../fixtures/generic.html'),
  },
};

// A real PDF header, so the stored file is a plausible resume rather than a
// text blob with a .pdf name. Nothing parses it; the point is the bytes make
// the round trip through encryption and back into a FileList unchanged.
const RESUME_BYTES = Buffer.concat([
  Buffer.from('%PDF-1.4\n1 0 obj<</Type/Catalog>>endobj\ntrailer<</Root 1 0 R>>\n%%EOF\n'),
  Buffer.from(Array.from({ length: 512 }, (_, i) => i % 251)),
]);
const RESUME_NAME = 'elvis-rey-cv.pdf';

// The CV as the files people actually have. The one-column HTML says the same
// things as fixture-cv.md, so the file path is asserted against the same
// values; the two-column one is in Spanish, with a labelled phone in a side
// column, which is the layout that interleaves if columns are not untangled.
// PDFs are printed by Chromium at run time (see makePdf); the .docx is built
// entry by entry (tests/e2e/make-docx.cjs). No binary is committed.
const CV_ONE_COL_HTML = path.join(__dirname, '../fixtures/cv-one-col.html');
const CV_TWO_COL_HTML = path.join(__dirname, '../fixtures/cv-two-col.html');
const { makeCvDocx } = require('./make-docx.cjs');
const DOCX_MIME = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';

/** A cover letter the person wrote. Stored as text AND as a file. */
const LETTER = 'Dear hiring team,\n\nI would like to apply. My work on automation is below.\n\nAda';
const LETTER_BYTES = Buffer.concat([
  Buffer.from('%PDF-1.4\n1 0 obj<</Type/Catalog>>endobj\ntrailer<</Root 1 0 R>>\n%%EOF\n'),
  Buffer.from(Array.from({ length: 256 }, (_, i) => (i * 7) % 251)),
]);
const LETTER_NAME = 'ada-cover-letter.pdf';

/**
 * Print an HTML fixture to PDF with a browser of its own. Not the extension's
 * context: a file:// navigation there would count as a request leaving the
 * extension origin, and the gate asserts none does.
 */
async function makePdf(htmlPath) {
  const browser = await chromium.launch({
    channel: 'chromium',
    headless: true,
    args: ['--no-sandbox'],
  });
  try {
    const page = await browser.newPage();
    await page.goto(`file://${htmlPath}`);
    return await page.pdf({ format: 'A4', printBackground: true });
  } finally {
    await browser.close();
  }
}

/** Import pasted text through the panel: open, paste, read, save. */
async function importPasted(page, text) {
  await page.getByRole('button', { name: /Import your CV|Re-import CV/ }).click();
  await page.getByRole('button', { name: 'Paste text instead' }).click();
  await page.getByTestId('cv-markdown').fill(text);
  await page.getByRole('button', { name: 'Read it' }).click();
  await page.getByTestId('cv-review').waitFor({ timeout: 30000 });
  await page.getByRole('button', { name: 'Save to the vault' }).click();
  await page.getByTestId('import-result').waitFor({ timeout: 60000 });
}

const results = {};
const offOrigin = [];
/** Fixture requests the harness itself fulfils from disk. Never networked. */
const servedLocally = [];
let failures = 0;
/** Every context opened, so a crash cannot leave one holding the profile. */
const opened = [];

function check(name, pass, detail) {
  results[name] = { pass, ...(detail ? { detail } : {}) };
  if (!pass) failures++;
}

async function launch(profile = PROFILE) {
  const ctx = await chromium.launchPersistentContext(profile, {
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
    if (u.startsWith('chrome-extension://') || u.startsWith('data:') || u.startsWith('blob:')) {
      return;
    }
    // A fixture page the harness navigated to itself, answered from disk by
    // the route below. Counted separately rather than excused: the gate
    // asserts at the end that the only such requests are the ones it caused.
    if (FIXTURE_ORIGINS.some((origin) => u.startsWith(origin))) {
      servedLocally.push(u);
      return;
    }
    offOrigin.push(u);
  });
  // Fulfilled from disk. The request never reaches the network, and the page
  // still commits at the real board URL, which is what the content script's
  // `matches` are tested against.
  //
  // One route per origin, picking the fixture by exact URL. Two overlapping
  // globs would work only because Playwright matches routes in reverse
  // registration order, which is a rule nobody should have to remember while
  // reading a test.
  for (const origin of FIXTURE_ORIGINS) {
    await ctx.route(`${origin}/**`, (route) => {
      const url = route.request().url();
      const board = Object.values(BOARDS).find((b) => b.url === url);
      if (!board) return route.abort();
      return route.fulfill({
        status: 200,
        contentType: 'text/html; charset=utf-8',
        body: fs.readFileSync(board.file, 'utf8'),
      });
    });
  }
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
  // Four at once, because creating the vault is now something the extension
  // does to itself on first open rather than something a person asks for.
  // Two concurrent opens both seeing an absent vault would both create one,
  // and the winner would own a key the loser's rows are not encrypted under.
  const raced = await Promise.all(
    pages.map((p) =>
      p
        .getByRole('button', { name: /Import your CV|Re-import CV/ })
        .waitFor({ timeout: 60000 })
        .then(() => 'open')
        .catch(async () => (await p.locator('body').innerText()).slice(0, 60)),
    ),
  );
  check(
    'four concurrent cold opens all land on a working vault, with nothing asked',
    raced.every((r) => r === 'open'),
    raced.join(' | '),
  );
  let page = pages[0];
  await Promise.all(pages.slice(1).map((p) => p.close()));

  // The point of the whole change, asserted rather than assumed: a first open
  // puts NOTHING in the way. Not a passphrase box, not a create button.
  //
  // The "reached a working vault" half is load-bearing. Without it this read
  // as a pass against the error screen, which also has no passphrase box —
  // which is exactly how it passed while every open was failing.
  const firstOpen = await page.locator('body').innerText();
  check(
    'a first open asks for nothing at all, and reaches a working vault',
    !/passphrase/i.test(firstOpen) &&
      (await page.getByLabel('Passphrase').count()) === 0 &&
      /Import your CV/.test(firstOpen),
    firstOpen.slice(0, 80),
  );
  check(
    'and there is no lock to press, because there is nothing to lock it with',
    (await page.getByRole('button', { name: 'Lock' }).count()) === 0,
  );

  await importPasted(page, CV);
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
  await page.getByRole('button', { name: 'Paste text instead' }).click();
  await page
    .getByTestId('cv-markdown')
    .fill('Dear Hiring Manager,\n\nI am interested.\n\nRegards\n');
  await page.getByRole('button', { name: 'Read it' }).click();
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
  await page.getByRole('button', { name: /Re-import CV/ }).waitFor({ timeout: 60000 });
  const bodyRun2 = await page.locator('body').innerText();
  // The restart is the case that mattered: a key held only in memory dies
  // with the browser, which is exactly what used to put the passphrase box
  // back on screen every morning.
  check(
    'the vault opens itself after a full browser restart, with nothing asked',
    !/passphrase/i.test(bodyRun2) && (await page.getByLabel('Passphrase').count()) === 0,
    bodyRun2.slice(0, 80),
  );
  check('the profile survived the restart', /experience ·/i.test(bodyRun2));
  check('the same roles are there', bodyRun2.includes('Nesty'), bodyRun2.slice(0, 120));

  const savedKey = await page.evaluate(
    async () => (await chrome.storage.local.get('vault.key.v1'))['vault.key.v1'],
  );
  check(
    'the key is on disk as 32 bytes, which is what makes the open possible',
    Array.isArray(savedKey) && savedKey.length === 32,
    Array.isArray(savedKey) ? `${savedKey.length} bytes` : String(savedKey),
  );

  // ── The key gone missing from a vault that has no passphrase ────────
  //
  // Not hypothetical: it is what a cleared "browsing data" sweep or a copied
  // profile looks like. The only wrong answer is a SECOND vault written over
  // a CV that is still sitting on disk.
  //
  // It needs a full restart, not just a reload. Deleting the stored key does
  // not close a vault the worker already has open, and it should not — the
  // first version of this check reloaded the page, saw everything still
  // working, and was asserting nothing.
  await page.evaluate(async () => {
    await chrome.storage.local.remove('vault.key.v1');
  });
  await ctx.close();

  ({ ctx, id } = await launch());
  page = await ctx.newPage();
  await page.goto(`chrome-extension://${id}/sidepanel.html`);
  await page.getByRole('alert').waitFor({ timeout: 60000 });
  const stranded = await page.locator('body').innerText();
  check(
    'a vault whose key has gone says so instead of creating a second one',
    /key is not in this browser profile/i.test(stranded) && !/Import your CV/.test(stranded),
    stranded.slice(0, 140),
  );

  // Put it back, so the rest of the run has the vault it imported into.
  await page.evaluate(async (material) => {
    await chrome.storage.local.set({ 'vault.key.v1': material });
  }, savedKey);
  await ctx.close();

  ({ ctx, id } = await launch());
  page = await ctx.newPage();
  await page.goto(`chrome-extension://${id}/sidepanel.html`);
  await page.getByRole('button', { name: /Re-import CV/ }).waitFor({ timeout: 60000 });
  check(
    'and opens again once the key is back, with the same CV behind it',
    (await page.locator('body').innerText()).includes('Nesty'),
  );

  // ── Phase 2: fill Lever and Greenhouse ──────────────────────────────
  //
  // The gate from docs/04-phases.md: a real application form on each board,
  // filled, reviewed, and never submitted. Zero sensitive fields written and
  // zero hidden fields written are the two that decide it.

  // ── The CV as a file: PDF and Word, read here, reviewed, then saved ──
  //
  // This is where pdf.js is measured inside the extension page — the spike
  // ran it in Node — and where the review step is proven to be the thing
  // that gets stored: one field is changed by hand before Save and the
  // change is what the vault ends up holding.
  const onePdf = await makePdf(CV_ONE_COL_HTML);
  await page.getByRole('button', { name: /Re-import CV/ }).click();
  await page.setInputFiles('[data-testid="cv-file"]', {
    name: 'ada-cv.pdf',
    mimeType: 'application/pdf',
    buffer: onePdf,
  });
  await page.getByTestId('cv-review').waitFor({ timeout: 60000 });
  const read = async (id) => page.getByTestId(id).inputValue();
  check(
    'cv file: a one-column PDF is read into name, contact and roles for review',
    (await read('cv-legalFirst')) === EXPECT.first &&
      (await read('cv-legalLast')) === EXPECT.last &&
      (await read('cv-email')) === EXPECT.email &&
      (await read('cv-phone')) === EXPECT.phone &&
      (await read('cv-city')) === 'Orlando' &&
      (await read('cv-work-0-title')) === 'Founder & Full-Stack Developer' &&
      (await read('cv-work-0-employer')) === EXPECT.employer &&
      (await page.locator('[data-testid^="cv-work-"][data-testid$="-title"]').count()) === 3 &&
      (await read('cv-education-0-degree')) === 'B.Sc. Systems Engineering',
    JSON.stringify({
      first: await read('cv-legalFirst'),
      email: await read('cv-email'),
      phone: await read('cv-phone'),
      city: await read('cv-city'),
      title: await read('cv-work-0-title'),
      employer: await read('cv-work-0-employer'),
    }),
  );
  check(
    'cv file: the reader had nothing to warn about on it',
    (await page.getByTestId('cv-warnings').count()) === 0,
    await page
      .getByTestId('cv-warnings')
      .innerText()
      .catch(() => ''),
  );
  // Nothing is stored yet: the profile on screen is still the one from the
  // Markdown import, and the review form is a proposal.
  check(
    'cv file: picking the file stored nothing — the headline is still the old one',
    (await page.locator('body').innerText()).includes('Senior Full-Stack Engineer') &&
      !(await page.locator('body').innerText()).includes('Edited in review'),
  );
  await page.getByTestId('cv-headline').fill('Edited in review');
  await page.getByRole('button', { name: 'Save to the vault' }).click();
  await page.getByTestId('import-result').waitFor({ timeout: 60000 });
  const afterPdf = await page.locator('body').innerText();
  check(
    'cv file: Save stores what the review says, including the hand-edited field',
    afterPdf.includes('Edited in review') &&
      /EXPERIENCE · 3/i.test(afterPdf) &&
      /3 roles, 2 degrees, 3 links/.test(await page.getByTestId('import-result').innerText()),
    (await page.getByTestId('import-result').innerText()).slice(0, 80),
  );
  check(
    'cv file: the PDF itself became the résumé file, since none was stored',
    /Résumé file · ada-cv\.pdf/.test(afterPdf),
    (afterPdf.match(/Résumé file[^\n]*/) ?? [''])[0],
  );

  // A two-column Spanish CV: the phone is labelled, in a side column, and
  // the dates say "Marzo 2023 – Actualidad". Reviewed and then cancelled, so
  // the board checks below run against Ada's profile.
  const twoPdf = await makePdf(CV_TWO_COL_HTML);
  await page.getByRole('button', { name: /Re-import CV/ }).click();
  await page.setInputFiles('[data-testid="cv-file"]', {
    name: 'elvis-cv.pdf',
    mimeType: 'application/pdf',
    buffer: twoPdf,
  });
  await page.getByTestId('cv-review').waitFor({ timeout: 60000 });
  check(
    'cv file: a two-column Spanish PDF reads column by column, in Spanish',
    (await read('cv-legalFirst')) === 'Elvis' &&
      (await read('cv-phone')) === '+58 412 555 0199' &&
      (await read('cv-city')) === 'Caracas' &&
      (await read('cv-work-0-title')) === 'Desarrollador Senior' &&
      (await read('cv-work-0-employer')) === 'Nesty C.A.' &&
      (await read('cv-work-0-startedOn')) === '2023-03' &&
      (await read('cv-work-0-endedOn')) === '' &&
      (await read('cv-education-0-institution')) === 'Universidad de Margarita',
    JSON.stringify({
      first: await read('cv-legalFirst'),
      phone: await read('cv-phone'),
      city: await read('cv-city'),
      title: await read('cv-work-0-title'),
      employer: await read('cv-work-0-employer'),
      from: await read('cv-work-0-startedOn'),
      to: await read('cv-work-0-endedOn'),
      school: await read('cv-education-0-institution'),
    }),
  );
  // Cancel on the review goes back to the file picker, so another file can
  // be tried; the picker's own Cancel closes the import.
  await page.getByRole('button', { name: 'Cancel' }).first().click();
  await page.getByTestId('cv-file').waitFor({ timeout: 30000 });
  await page.getByRole('button', { name: 'Cancel' }).click();
  check(
    'cv file: Cancel keeps the vault as it was',
    (await page.locator('body').innerText()).includes('Lovelace') &&
      !(await page.locator('body').innerText()).includes('Elvis Rey'),
  );

  // The same CV as a Word file, with no dependency behind the reading.
  await page.getByRole('button', { name: /Re-import CV/ }).click();
  await page.setInputFiles('[data-testid="cv-file"]', {
    name: 'ada-cv.docx',
    mimeType: DOCX_MIME,
    buffer: makeCvDocx(),
  });
  await page.getByTestId('cv-review').waitFor({ timeout: 60000 });
  check(
    'cv file: a Word document reads to the same fields as the PDF',
    (await read('cv-legalFirst')) === EXPECT.first &&
      (await read('cv-email')) === EXPECT.email &&
      (await read('cv-work-0-title')) === 'Founder & Full-Stack Developer' &&
      (await read('cv-work-0-employer')) === EXPECT.employer &&
      (await read('cv-work-2-startedOn')) === '2019-05' &&
      (await read('cv-education-1-institution')) === 'María Auxiliadora II' &&
      (await page.getByTestId('cv-warnings').count()) === 0,
    JSON.stringify({
      first: await read('cv-legalFirst'),
      title: await read('cv-work-0-title'),
      employer: await read('cv-work-0-employer'),
      from: await read('cv-work-2-startedOn'),
      school: await read('cv-education-1-institution'),
    }),
  );
  await page.getByRole('button', { name: 'Cancel' }).first().click();
  await page.getByTestId('cv-file').waitFor({ timeout: 30000 });
  await page.getByRole('button', { name: 'Cancel' }).click();

  // Old Word: refused with the way out, and nothing read.
  await page.getByRole('button', { name: /Re-import CV/ }).click();
  await page.setInputFiles('[data-testid="cv-file"]', {
    name: 'old-cv.doc',
    mimeType: 'application/msword',
    buffer: Buffer.from('\xd0\xcf\x11\xe0 not really', 'latin1'),
  });
  const docRefusal = await page
    .getByRole('alert')
    .innerText({ timeout: 30000 })
    .catch(() => '(no message)');
  check(
    'cv file: a .doc is refused and told to save as .docx or PDF',
    /old Word format/.test(docRefusal) &&
      /Save As/.test(docRefusal) &&
      (await page.getByTestId('cv-review').count()) === 0,
    docRefusal,
  );
  await page.getByRole('button', { name: 'Cancel' }).click();

  // Phase 2's value assertions run against the fixture CV, deliberately, even
  // when a real one was used above. Run 1 proves the import works on the real
  // thing; asserting here that a particular email reaches a particular box
  // would otherwise depend on what one person happens to have in their CV,
  // and a gate that passes or fails on that is testing the wrong machine.
  await importPasted(page, FIXTURE_CV);
  await page.waitForFunction(() => document.body.innerText.includes('Lovelace'), null, {
    timeout: 30000,
  });
  check('the fixture CV is loaded for the fill checks', true);

  // Store a resume first. The file input is a real one on a real panel, so
  // the bytes travel the whole way: File -> base64 -> AES-GCM -> SQLite ->
  // back out -> DataTransfer -> the board's file input.
  await page.setInputFiles('#resume-file', {
    name: RESUME_NAME,
    mimeType: 'application/pdf',
    buffer: RESUME_BYTES,
  });
  await page.waitForFunction((name) => document.body.innerText.includes(name), RESUME_NAME, {
    timeout: 30000,
  });
  check('a resume file is stored in the vault', true);

  async function fillBoard(key) {
    const board = BOARDS[key];
    const job = await ctx.newPage();
    await job.goto(board.url, { waitUntil: 'domcontentloaded' });
    // The content script only exists on the two allowlisted hosts, so its
    // presence here is itself part of what is being tested.
    await job.bringToFront();

    const clickedAt = Date.now();
    await page.getByRole('button', { name: 'Fill this form' }).click();
    // Whichever lands first. Waiting only for the report turns "the panel
    // refused and said why" into a sixty-second timeout and a crash, which
    // hides the reason behind a stack trace: reverting `all_frames` used to
    // fail exactly that way.
    const outcome = await Promise.race([
      page
        .getByTestId('fill-report')
        .waitFor({ timeout: 60000 })
        .then(() => ({ filled: true, error: null })),
      page
        .getByRole('alert')
        .waitFor({ timeout: 60000 })
        .then(async () => ({ filled: false, error: await page.getByRole('alert').innerText() })),
    ]).catch((e) => ({ filled: false, error: `nothing happened within 60s: ${e.message}` }));
    if (!outcome.filled) {
      return {
        job,
        failed: outcome.error,
        refusedAfterMs: Date.now() - clickedAt,
        state: { values: {}, submits: 0, fileSize: 0 },
        report: '',
        review: '',
        parentState: {},
        parentSubmits: 0,
        frameNote: null,
      };
    }

    // Read the frame that actually holds the application form. On a careers
    // page that is the embedded one; the parent is read separately, because
    // proving it was NOT touched is half of what this phase is for.
    const readForm = (frame) =>
      frame.evaluate(() => {
        const out = {};
        for (const el of document.querySelectorAll('input, select, textarea')) {
          const key = el.getAttribute('name') || el.id;
          if (!key) continue;
          out[key] = el.type === 'file' ? (el.files?.[0]?.name ?? '') : el.value;
        }
        return {
          values: out,
          submits: window.__submits ?? 0,
          fileSize: document.querySelector('input[type=file]')?.files?.[0]?.size ?? 0,
        };
      });

    const embedded = job.frames().find((f) => f !== job.mainFrame());
    const state = await readForm(embedded ?? job.mainFrame());
    const parentRead = embedded ? await readForm(job.mainFrame()) : { values: {}, submits: 0 };
    const parentState = parentRead.values;
    const parentSubmits = parentRead.submits;
    const frameNote = await page
      .getByTestId('frame-note')
      .innerText()
      .catch(() => null);
    const report = await page.getByTestId('fill-report').innerText();
    // The whole review list, so a check can assert WHY a field was refused
    // rather than only that it ended up empty. A trap that nothing happened
    // to recognise is empty for the wrong reason: rename it `email` and it
    // would be filled.
    const review = await page.locator('body').innerText();
    return { job, state, report, review, parentState, parentSubmits, frameNote };
  }

  // ── Lever ───────────────────────────────────────────────────────────
  const lever = await fillBoard('lever');
  const lv = lever.state.values;

  check('lever: it never submitted', lever.state.submits === 0, `${lever.state.submits} submit(s)`);
  check(
    'lever: every field it recognised holds the value the CV actually says',
    lv.name === EXPECT.full &&
      lv.email === EXPECT.email &&
      lv.phone === EXPECT.phone &&
      lv['urls[LinkedIn]'] === EXPECT.linkedin &&
      lv['urls[GitHub]'] === EXPECT.github,
    JSON.stringify({
      name: lv.name,
      email: lv.email,
      phone: lv.phone,
      li: lv['urls[LinkedIn]'],
      gh: lv['urls[GitHub]'],
    }),
  );
  check('lever: the current employer is filled', lv.org === EXPECT.employer, lv.org);
  check(
    'lever: a visible, labelled `website` IS filled, so the denylist is not blanket',
    lv.website === EXPECT.website,
    `"${lv.website}"`,
  );

  // The two checks the phase gate turns on.
  const SENSITIVE_ON_PAGE = [
    'gender',
    'race',
    'veteran',
    'disability',
    'dateOfBirth',
    'salary_expected',
    'citizenship',
    'sponsorship',
    'criminal',
  ];
  const sensitiveWritten = SENSITIVE_ON_PAGE.filter((k) => (lv[k] ?? '') !== '');
  check(
    'lever: ZERO sensitive fields were filled',
    sensitiveWritten.length === 0,
    sensitiveWritten.join(', ') || `${SENSITIVE_ON_PAGE.length} checked, all empty`,
  );

  const TRAPS = [
    'beecatcher',
    'website2',
    'trap_display',
    'trap_visibility',
    'trap_opacity',
    'trap_offscreen',
    'trap_tiny',
    'trap_clipped',
    'trap_hidden_input',
  ];
  const trapsWritten = TRAPS.filter((k) => (lv[k] ?? '') !== '');
  check(
    'lever: ZERO hidden fields were written, across nine techniques',
    trapsWritten.length === 0,
    trapsWritten.join(', ') || `${TRAPS.length} traps, all empty`,
  );
  // Empty is not enough. Each trap has to be refused BY A GUARD — the
  // visibility gate or the denylist — and not merely left alone because no
  // pass happened to recognise it. The first screenshot of this review list
  // is what caught it: `opacity:0` and a clip-path on an ANCESTOR both read
  // as "not recognised", because opacity does not inherit and the field's own
  // rect is full size inside the clip. Rename either one `email` and it would
  // have been filled.
  //
  // The two named honeypots are counted through the review's own tally rather
  // than by row, because the review lists a field by its label and both of
  // theirs are borrowed from real fields.
  const NAMED_TRAPS = ['beecatcher', 'website2'];
  const HIDDEN_TRAPS = TRAPS.filter((t) => !NAMED_TRAPS.includes(t));
  const reviewLines = lever.review.split('\n').map((l) => l.trim());
  const refusedAsHidden = HIDDEN_TRAPS.filter((name) => {
    const at = reviewLines.indexOf(name);
    if (at === -1) return false;
    return /hidden/i.test(reviewLines.slice(at, at + 6).join(' '));
  });
  check(
    'lever: every unnamed trap was refused BY THE VISIBILITY GATE, not left unrecognised',
    refusedAsHidden.length === HIDDEN_TRAPS.length,
    `${refusedAsHidden.length} of ${HIDDEN_TRAPS.length}: missing ` +
      `${HIDDEN_TRAPS.filter((t) => !refusedAsHidden.includes(t)).join(', ') || 'none'}`,
  );
  check(
    'lever: both named honeypots were refused BY THE DENYLIST',
    /\b2 honeypots refused\b/.test(lever.report) &&
      /denylist on "beecatcher"/.test(lever.review) &&
      /denylist on "website"/.test(lever.review),
    lever.report.replace(/\n/g, ' '),
  );
  check(
    'lever: the fixture really contains those traps',
    TRAPS.every((k) => k in lv) && SENSITIVE_ON_PAGE.every((k) => k in lv),
    `${Object.keys(lv).length} controls seen`,
  );

  check(
    'lever: the resume file is attached, with its bytes intact',
    lv.resume === RESUME_NAME && lever.state.fileSize === RESUME_BYTES.length,
    `${lv.resume} ${lever.state.fileSize} of ${RESUME_BYTES.length} bytes`,
  );
  check('lever: no cover letter was written', (lv.comments ?? '') === '');
  check(
    'lever: the review counts the sensitive fields as left to the user',
    /\b9 left to you\b/.test(lever.report),
    lever.report.replace(/\n/g, ' '),
  );
  check(
    'lever: the review list itself names them, one row each',
    (await page.locator('body').innerText()).match(/yours to answer/g)?.length === 9,
    `${((await page.locator('body').innerText()).match(/yours to answer/g) || []).length} rows`,
  );
  check(
    'lever: the refused honeypots are visible in the review, not silent',
    /\b2 honeypots refused\b/.test(lever.report),
    lever.report.replace(/\n/g, ' '),
  );
  await lever.job.close();

  // ── Greenhouse ──────────────────────────────────────────────────────
  const gh = await fillBoard('greenhouse');
  const gv = gh.state.values;

  check('greenhouse: it never submitted', gh.state.submits === 0, `${gh.state.submits} submit(s)`);
  check(
    'greenhouse: the stable ids are filled',
    gv.first_name === EXPECT.first &&
      gv.last_name === EXPECT.last &&
      gv.email === EXPECT.email &&
      gv.phone === EXPECT.phone,
    JSON.stringify({ first: gv.first_name, last: gv.last_name, email: gv.email, tel: gv.phone }),
  );
  check(
    'greenhouse: a label that is only a sibling still resolves',
    gv.question_7001 === EXPECT.employer,
    `current company -> "${gv.question_7001}"`,
  );
  check(
    'greenhouse: a label that is only a span in the field group still resolves',
    gv.question_7002 === EXPECT.linkedin,
    `linkedin -> "${gv.question_7002}"`,
  );
  const ghSensitive = [
    'job_application[gender]',
    'job_application[hispanic]',
    'job_application[veteran]',
    'job_application[disability]',
    'question_auth',
  ];
  check(
    'greenhouse: ZERO sensitive fields were filled',
    ghSensitive.every((k) => (gv[k] ?? '') === ''),
    ghSensitive.filter((k) => (gv[k] ?? '') !== '').join(', ') || 'all empty',
  );
  check('greenhouse: the honeypot is empty', (gv.beecatcher ?? '') === '');
  check('greenhouse: a disabled field is left alone', (gv.locked_email ?? '') === '');
  check(
    'greenhouse: a prefilled field is not overwritten',
    gv.prefilled_phone === '+34 600 000 000',
    gv.prefilled_phone,
  );
  check('greenhouse: no cover letter was written', (gv.cover_letter ?? '') === '');
  // The label-borrowing bug, end to end. A flat container with one label and
  // two controls: the second must not inherit the first's question, because
  // that is how an email address ends up in a salary box.
  check(
    'greenhouse: the field beside a labelled one does NOT inherit its label',
    (gv.unlabelled_neighbour ?? '') === '',
    `unlabelled_neighbour -> "${gv.unlabelled_neighbour}"`,
  );
  check(
    'greenhouse: the labelled one of that pair is still filled, so the fix is not a blanket refusal',
    gv.shared_email === EXPECT.email,
    `shared_email -> "${gv.shared_email}"`,
  );
  await gh.job.close();

  // ── A form with no file input ───────────────────────────────────────────
  const nofile = await fillBoard('nofile');
  const nv = nofile.state.values;
  check('no-file form: it never submitted', nofile.state.submits === 0);
  check(
    'no-file form: it still fills what it recognises',
    nv.name === EXPECT.full && nv.email === EXPECT.email,
    JSON.stringify({ name: nv.name, email: nv.email }),
  );
  // Nothing was attached, because there was nothing to attach to. That the
  // bytes were therefore never SENT is planNeedsResume's job and is asserted
  // in tests/unit/fill.test.ts; this is the observable half.
  check(
    'no-file form: nothing was attached, because there is nowhere to attach it',
    !/attached/i.test(nofile.review),
    nofile.report.replace(/\n/g, ' '),
  );
  await nofile.job.close();

  // ── Phase 3: a board form embedded on a company careers page ────────
  //
  // The gate from docs/04-phases.md: fill a Greenhouse form embedded on a
  // third-party careers domain WITHOUT granting a permanent broad permission.
  // The manifest is asserted below to still request none at all.
  const careers = await fillBoard('careers');
  const cv = careers.state.values;
  const parent = careers.parentState;

  check(
    'careers page: the panel reached the embedded form at all',
    !careers.failed,
    careers.failed ?? 'reached',
  );
  check(
    'careers page: the embedded board form is filled',
    cv.first_name === EXPECT.first && cv.email === EXPECT.email,
    JSON.stringify({ first: cv.first_name, email: cv.email }),
  );
  check(
    'careers page: it says WHERE it filled, because the click was on another page',
    /embedded on this page/i.test(careers.frameNote ?? ''),
    careers.frameNote ?? '(no note)',
  );
  // The boundary. The parent origin is not on the match list, so the
  // extension is never injected into it and the background cannot reach it.
  check(
    "careers page: the PARENT page's own fields were never touched",
    (parent.newsletter_email ?? '') === '' && (parent.name ?? '') === '',
    JSON.stringify(parent),
  );
  check(
    'careers page: the parent form really has fields, so the check above counts something',
    'newsletter_email' in parent && 'name' in parent,
    Object.keys(parent).join(', '),
  );
  check(
    'careers page: ZERO sensitive fields were filled in the embedded form',
    ghSensitive.every((k) => (cv[k] ?? '') === ''),
    ghSensitive.filter((k) => (cv[k] ?? '') !== '').join(', ') || 'all empty',
  );
  check(
    'careers page: neither the embed nor the parent submitted',
    careers.state.submits === 0 && careers.parentSubmits === 0,
    `embed ${careers.state.submits}, parent ${careers.parentSubmits}`,
  );
  await careers.job.close();

  // ── Ashby, and the questions a CV cannot answer ─────────────────────
  //
  // Every label on this fixture is copied from a real application. Two of
  // them found bugs in code that was already shipped, so the checks below
  // are written against the labels rather than against ids.

  // First: store the answers, through the panel, encrypted. A fill that read
  // them from anywhere else would pass the checks below for the wrong reason.
  await page.getByTestId('answer-preferred_name').fill('Ada');
  await page.getByTestId('answer-preferred_name').blur();
  await page.getByTestId('answer-notice_period').fill('1 month');
  await page.getByTestId('answer-notice_period').blur();
  await page.getByTestId('answer-travel_ok').fill('Yes, up to 25%');
  await page.getByTestId('answer-travel_ok').blur();
  await page.getByTestId('answer-security_clearance').fill('None of the above');
  await page.getByTestId('answer-security_clearance').blur();
  await page.waitForTimeout(600);

  const ashby = await fillBoard('ashby');
  const ab = ashby.state.values;

  check('ashby: it never submitted', ashby.state.submits === 0, `${ashby.state.submits} submit(s)`);
  check(
    'ashby: the identity fields are filled',
    ab._systemfield_name === EXPECT.full && ab._systemfield_email === EXPECT.email,
    JSON.stringify({ name: ab._systemfield_name, email: ab._systemfield_email }),
  );
  // The bug Elvis's form exposed: "Preferred Full Name" got the legal name,
  // because Chromium has no preferred-name type and its FULL_NAME pattern
  // matches `full.?name`.
  check(
    'ashby: the PREFERRED name box gets YOUR preferred name, not the legal one',
    ab._systemfield_preferred_name === EXPECT.first &&
      ab._systemfield_preferred_name !== EXPECT.full,
    `preferred = ${JSON.stringify(ab._systemfield_preferred_name)}`,
  );
  // The worse one. The label contains "current employer", so the box asking
  // when you can start was filled with the name of the company you work for.
  check(
    'ashby: the NOTICE box gets your notice period, NOT your employer name',
    ab.q_notice === '1 month',
    `notice = ${JSON.stringify(ab.q_notice)}, employer = ${JSON.stringify(ab.q_employer)}`,
  );
  check(
    'ashby: and a real current-employer question is still filled, so the fix is not a blanket refusal',
    ab.q_employer === EXPECT.employer,
    `employer = ${JSON.stringify(ab.q_employer)}`,
  );
  check(
    'ashby: a stored answer travelled encrypted from the vault into the form',
    ab.q_travel === 'Yes, up to 25%' && ab.q_clearance === 'None of the above',
    JSON.stringify({ travel: ab.q_travel, clearance: ab.q_clearance }),
  );
  // Invariant 2, on the questions a real form actually asks.
  check(
    'ashby: the work-authorization and sponsorship questions are LEFT EMPTY',
    (ab.q_eligible ?? '') === '' && (ab.q_sponsorship ?? '') === '',
    JSON.stringify({ eligible: ab.q_eligible, sponsorship: ab.q_sponsorship }),
  );
  check(
    'ashby: the salary question is left empty AND named as yours to answer',
    (ab.q_salary ?? '') === '' && /first number spoken/i.test(ashby.review ?? ''),
    (ashby.review ?? '').split('\n').find((l) => /first number spoken/i.test(l)) ??
      `(no reason shown; salary = ${JSON.stringify(ab.q_salary)})`,
  );
  check(
    'ashby: pronouns are treated as the sensitive class',
    (ab.pronouns ?? '') === '',
    `pronouns = ${JSON.stringify(ab.pronouns)}`,
  );
  await ashby.job.close();

  // ── Phase 4: a form that hides inside a closed shadow root ──────────
  //
  // This is where the browser API itself is tested. The unit tests drive a
  // stub, because jsdom has no chrome.dom; a stub that lied would pass them
  // and fail here.
  const workday = await fillBoard('workday');
  const wdPage = workday.job;

  // Before anything about filling: is this page actually hostile? A check
  // against a page whose roots turned out to be OPEN would prove nothing,
  // and would look identical in the output.
  const closed = await wdPage.evaluate(() => window.__closed ?? []);
  check(
    'workday: the three shadow roots really are CLOSED, so the rest means something',
    closed.length === 3 && closed.every(Boolean),
    JSON.stringify(closed),
  );
  const flat = await wdPage.evaluate(() => window.__flatCount?.() ?? -1);
  check(
    'workday: a flat query finds NOTHING, so reaching the form required the pierce',
    flat === 0,
    `${flat} control(s) visible to document.querySelectorAll`,
  );

  const wd = await wdPage.evaluate(() => window.__values?.() ?? {});
  check(
    'workday: it never submitted',
    (await wdPage.evaluate(() => window.__submits ?? 0)) === 0,
    JSON.stringify(wd).slice(0, 80),
  );
  check(
    'workday: the fields inside the closed root hold the values the CV says',
    wd.firstName === EXPECT.first && wd.lastName === EXPECT.last && wd.email === EXPECT.email,
    JSON.stringify({ first: wd.firstName, last: wd.lastName, email: wd.email }),
  );
  // Two roots deep, asserted on a VALUE rather than on the key existing.
  // The first version checked `typeof wd.source === 'string'` against a
  // field the vault has nothing for — and the read-back walks these roots
  // itself, so the key is there whether the extension reached it or not.
  // That check was true no matter what happened, which is worse than no
  // check because it reads like one.
  check(
    'workday: a field two roots deep was filled, not merely seen',
    wd.phoneNumber === EXPECT.phone,
    `phone at depth 2 = ${JSON.stringify(wd.phoneNumber)}`,
  );
  // Invariant 2, on a page where reaching further is the whole point of the
  // phase. Reading deeper must not mean filling more.
  const wdSensitive = ['dateOfBirth', 'gender', 'ethnicity', 'disabilityStatus'];
  check(
    'workday: ZERO sensitive fields were filled, inside the closed root',
    wdSensitive.every((k) => (wd[k] ?? '') === ''),
    wdSensitive.filter((k) => (wd[k] ?? '') !== '').join(', ') || 'all empty',
  );
  // Invariant 3, likewise. The honeypot is hidden by a rule that lives
  // inside the root, so a document stylesheet could not have hidden it.
  check(
    'workday: the beecatcher honeypot inside the closed root was NOT written',
    (wd.beecatcher ?? '') === '',
    `beecatcher = ${JSON.stringify(wd.beecatcher)}`,
  );
  check(
    'workday: and it was refused BY THE DENYLIST, not merely left unrecognised',
    /honeypot/i.test(workday.review ?? ''),
    (workday.report ?? '').slice(0, 90),
  );
  // The custom dropdown: opened, read and answered inside one task. The CV
  // says Orlando, so this is a value that travelled the whole way from the
  // markdown rather than one planted in the fixture to make it pass.
  check(
    'workday: the custom listbox was opened and answered in a single pass',
    wd.__city === 'Orlando',
    `city reads ${JSON.stringify(wd.__city)}`,
  );
  // And the other half, which matters more. The vault stores the country as
  // the two-letter code `US`; the menu lists "United States of America".
  // chooseOption refuses a two-character prefix on purpose, so the right
  // outcome is an untouched field and a line in the review saying why — not
  // the closest-looking option. A gate that only tested the answerable case
  // would call guessing a pass.
  check(
    'workday: a dropdown it cannot answer is LEFT ALONE, not guessed at',
    (wd.__country ?? '') === '',
    `country reads ${JSON.stringify(wd.__country)}`,
  );
  check(
    'workday: and the review says it was opened and not answered',
    /not among the options/i.test(workday.review ?? ''),
    (workday.review ?? '').split('\n').find((l) => /not among the options/i.test(l)) ??
      '(no such line)',
  );
  // And calls it what it is. The first version of this counted a correct
  // refusal under "failed", which reads as a bug in the extension and sends
  // somebody looking for one — the same mistake as the single refusal
  // message Phase 3's review had to split in two.
  check(
    'workday: a declined dropdown is NOT reported as a failure',
    !/1 failed/.test(workday.report ?? ''),
    (workday.report ?? '').replace(/\n/g, ' '),
  );
  // The answered one has to show up somewhere too, or the listbox code's
  // only success is invisible in the tally.
  check(
    'workday: the answered dropdown is counted among the filled',
    /5\s*filled/.test(workday.report ?? ''),
    (workday.report ?? '').replace(/\n/g, ' '),
  );
  await wdPage.close();
  // ── A form no map knows ─────────────────────────────────────────────
  //
  // The fixture CV is loaded and the screening answers from the Ashby block
  // are still stored, so every kind of source is in play: CV columns,
  // encrypted contact columns, the résumé, an answer the person typed.
  const generic = await fillBoard('generic');
  const un = generic.state.values;
  check(
    'generic: it never submitted',
    generic.state.submits === 0,
    `${generic.state.submits} submit(s)`,
  );
  check(
    'generic: name, email and phone fill from labels alone, no map',
    un['candidate[firstname]'] === EXPECT.first &&
      un['candidate[lastname]'] === EXPECT.last &&
      un['candidate[mail]'] === EXPECT.email &&
      un['candidate[tel]'] === EXPECT.phone,
    JSON.stringify({
      first: un['candidate[firstname]'],
      last: un['candidate[lastname]'],
      mail: un['candidate[mail]'],
      tel: un['candidate[tel]'],
    }),
  );
  check(
    'generic: employer, title and links fill from the label rules',
    un['candidate[employer_now]'] === EXPECT.employer &&
      un['candidate[social_1]'] === EXPECT.linkedin &&
      un['candidate[social_2]'] === EXPECT.github,
    JSON.stringify({
      employer: un['candidate[employer_now]'],
      li: un['candidate[social_1]'],
      gh: un['candidate[social_2]'],
    }),
  );
  check(
    'generic: the résumé is attached, bytes intact',
    un['candidate[attachment]'] === RESUME_NAME && generic.state.fileSize === RESUME_BYTES.length,
    `${un['candidate[attachment]']} ${generic.state.fileSize} of ${RESUME_BYTES.length} bytes`,
  );
  // The three refusals that must survive the absence of a map: a question
  // nobody answered, the sensitive class, and the trap.
  check(
    'generic: a screening question with no stored answer is left for you',
    (un['candidate[q_source]'] ?? '') === '',
    `"${un['candidate[q_source]']}"`,
  );
  check(
    'generic: the work-authorisation question is refused as sensitive, not filled as a country',
    (un['candidate[q_auth]'] ?? '') === '',
    `"${un['candidate[q_auth]']}"`,
  );
  check('generic: the cover letter is never written', (un['candidate[letter]'] ?? '') === '');
  check(
    'generic: the off-screen unlabelled `website` is refused',
    (un.website ?? '') === '',
    `"${un.website}"`,
  );
  check(
    'generic: the panel names the board, not "this page"',
    /Workable/.test(generic.review ?? generic.report ?? ''),
    (generic.review ?? generic.report ?? '').slice(0, 120),
  );
  check(
    'generic: a cover letter FILE input is left alone while no file is stored',
    (un['candidate[letter_file]'] ?? '') === '',
    `"${un['candidate[letter_file]']}"`,
  );
  await generic.job.close();

  // ── The cover letter: yours, stored once, or nothing ────────────────
  //
  // Every check above ran with no letter stored and asserted the box stayed
  // empty. Now one is stored, as text and as a file, and the same form is
  // filled again: the box gets the text, the file input gets the file, and
  // the résumé input still gets the résumé.
  await page.getByTestId('answer-cover_letter').fill(LETTER);
  await page.getByTestId('answer-cover_letter').blur();
  await page.setInputFiles('#cover-letter-file', {
    name: LETTER_NAME,
    mimeType: 'application/pdf',
    buffer: LETTER_BYTES,
  });
  await page.waitForFunction((name) => document.body.innerText.includes(name), LETTER_NAME, {
    timeout: 30000,
  });
  await page.waitForTimeout(600);
  const lettered = await fillBoard('generic');
  const lv2 = lettered.state.values;
  check(
    'cover letter: the box is filled with the letter YOU wrote, once one is stored',
    lv2['candidate[letter]'] === LETTER,
    JSON.stringify(lv2['candidate[letter]'] ?? '').slice(0, 80),
  );
  check(
    'cover letter: the file input gets the cover letter file, and the résumé input the résumé',
    lv2['candidate[letter_file]'] === LETTER_NAME && lv2['candidate[attachment]'] === RESUME_NAME,
    JSON.stringify({ letter: lv2['candidate[letter_file]'], resume: lv2['candidate[attachment]'] }),
  );
  check(
    'cover letter: the review lists both attachments by name',
    (lettered.review ?? '').includes(LETTER_NAME) && (lettered.review ?? '').includes(RESUME_NAME),
  );
  await lettered.job.close();

  // ── The two refusals, which used to be one ──────────────────────────
  //
  // A board page with no form, and a page with no content script at all, are
  // different problems with different answers. They shared one message, and
  // the second one spent the roll call's whole retry budget before giving it.
  const listing = await fillBoard('listing');
  check(
    'a board page with no form is refused, and says so',
    /no application form on it/i.test(listing.failed ?? ''),
    listing.failed ?? '(it filled something)',
  );
  await listing.job.close();

  // A page with no content script is no longer "not a job board". It is a
  // page the person has not yet pointed the extension at: the background
  // tries to inject, Chrome refuses because the gate cannot click the icon,
  // and THAT refusal — real, from Chrome — is what becomes the message. This
  // is as far along the on-demand path as CI can get.
  const plain = await fillBoard('plainPage');
  check(
    'a page with no content script says how to grant it, naming the boards that need no grant',
    /click the PageMyCV icon in the toolbar/i.test(plain.failed ?? '') &&
      /Lever/.test(plain.failed ?? '') &&
      /Workable/.test(plain.failed ?? '') &&
      !/does not know this page/i.test(plain.failed ?? ''),
    plain.failed ?? '(it filled something)',
  );
  // The regression this measures: spending the LONG retry budget on a page
  // that has no content script made an ordinary page take over two seconds to
  // answer. It now spends the short silence budget instead.
  //
  // The threshold is the long budget rather than a tighter round number. What
  // matters is the distance from the failure mode — the bug measured 2356ms,
  // the fix measures around 1300 — and a tighter bound would fail on a slow
  // runner for margin rather than for a regression, which is the kind of
  // check that gets deleted instead of read.
  check(
    'and refused without spending the LONG retry budget',
    (plain.refusedAfterMs ?? 99999) < 2000,
    `${plain.refusedAfterMs}ms, against a 2000ms budget`,
  );
  await plain.job.close();

  // The gate's own wording: without a permanent broad permission. It asks for
  // none, which is stronger than asking for one at runtime.
  const manifest = JSON.parse(fs.readFileSync(path.join(EXT, 'manifest.json'), 'utf8'));
  check(
    'the manifest still requests NO host permissions, embedded case included',
    manifest.host_permissions === undefined &&
      manifest.optional_host_permissions === undefined &&
      !(manifest.permissions ?? []).includes('webNavigation') &&
      !(manifest.permissions ?? []).includes('tabs'),
    JSON.stringify({ permissions: manifest.permissions, hosts: manifest.host_permissions ?? null }),
  );
  // activeTab is the whole of what unknown sites get: one tab, after a
  // click, until navigation. It is asserted present so that removing it by
  // accident fails here rather than on the first unknown site somebody tries.
  check(
    'the manifest asks for activeTab and scripting, which is what unknown sites run on',
    (manifest.permissions ?? []).includes('activeTab') &&
      (manifest.permissions ?? []).includes('scripting'),
    JSON.stringify(manifest.permissions),
  );
  check(
    'the content script is declared for the four supported boards only, in all frames',
    (manifest.content_scripts ?? []).every(
      (c) =>
        c.all_frames === true &&
        // Spelled out rather than loosened to a wildcard. The point of this
        // check is that adding a host is a visible edit here, so a pattern
        // permissive enough to absorb the next one silently would delete
        // the check while leaving it looking present. Workday's own entry
        // IS a wildcard, and only over its own apex.
        (c.matches ?? []).every((m) =>
          /^https:\/\/(jobs\.lever\.co|(job-)?boards\.greenhouse\.io|jobs\.ashbyhq\.com|apply\.workable\.com|(careers|jobs)\.smartrecruiters\.com|jobs\.jobvite\.com|\*\.myworkdayjobs\.com)\/\*$/.test(
            m,
          ),
        ),
    ),
    JSON.stringify((manifest.content_scripts ?? []).map((c) => c.matches)),
  );

  // ── Backup: export here, restore into a brand-new profile ───────────
  //
  // Everything above left this vault holding the fixture CV, a résumé file
  // and four screening answers, so the backup has something of each kind.
  await page.bringToFront();
  const [download] = await Promise.all([
    page.waitForEvent('download', { timeout: 30000 }),
    page.getByRole('button', { name: 'Export backup' }).click(),
  ]);
  await download.saveAs(BACKUP_FILE);
  const backupText = fs.readFileSync(BACKUP_FILE, 'utf8');
  const backup = JSON.parse(backupText);
  check(
    'backup: it downloads as a file named for its date',
    /^pagemycv-backup-\d{4}-\d{2}-\d{2}\.json$/.test(download.suggestedFilename()),
    download.suggestedFilename(),
  );
  check(
    'backup: it holds the CV, the résumé and the answers',
    backup.profile?.legalLast === EXPECT.last &&
      backup.contact?.email === EXPECT.email &&
      backup.resume?.filename === RESUME_NAME &&
      backup.screeningAnswers?.notice_period === '1 month',
    JSON.stringify({
      last: backup.profile?.legalLast,
      email: backup.contact?.email,
      resume: backup.resume?.filename,
      notice: backup.screeningAnswers?.notice_period,
    }),
  );
  check(
    'backup: the résumé inside is byte for byte the one uploaded',
    Buffer.from(backup.resume?.base64 ?? '', 'base64').equals(RESUME_BYTES),
  );
  check(
    'backup: it carries the cover letter, as text and as the file',
    backup.screeningAnswers?.cover_letter === LETTER &&
      backup.coverLetter?.filename === LETTER_NAME &&
      Buffer.from(backup.coverLetter?.base64 ?? '', 'base64').equals(LETTER_BYTES),
    JSON.stringify({
      file: backup.coverLetter?.filename,
      text: (backup.screeningAnswers?.cover_letter ?? '').slice(0, 20),
    }),
  );
  // Nothing sensitive can be stored yet, and this file is not encrypted.
  // tests/unit/backup-coverage.test.ts holds that line in the code; this
  // holds it in the file that actually came out.
  check(
    'backup: it carries no sensitive-value section at all',
    !('sensitive' in backup) && !/sensitive_value|value_enc/.test(backupText),
  );

  // A damaged file is refused before anything changes. Built from the REAL
  // backup with one field broken: a hand-written stub was missing half its
  // fields and got refused for one of those instead, which proved refusal
  // but not the reason the check is named for.
  await page.setInputFiles('[data-testid="backup-file"]', {
    name: 'damaged.json',
    mimeType: 'application/json',
    buffer: Buffer.from(JSON.stringify({ ...backup, work: 'not a list' })),
  });
  const damaged = await page
    .getByRole('alert')
    .innerText({ timeout: 30000 })
    .catch(() => '(no message)');
  check(
    'backup: a damaged file is refused, saying nothing changed',
    /^work should be a list/.test(damaged) &&
      /nothing was changed/i.test(damaged) &&
      (await page.getByTestId('backup-confirm').count()) === 0,
    damaged,
  );
  check(
    'backup: and the vault is exactly as it was',
    (await page.locator('body').innerText()).includes(EXPECT.employer),
  );

  await ctx.close();

  // The extension is gone and installed again: a new profile, a new vault,
  // a NEW random key. Every encrypted column in the file has to be sealed
  // again under a key that did not exist when it was exported.
  fs.rmSync(FRESH_PROFILE, { recursive: true, force: true });
  ({ ctx, id } = await launch(FRESH_PROFILE));
  page = await ctx.newPage();
  await page.goto(`chrome-extension://${id}/sidepanel.html`);
  await page.getByRole('button', { name: /Import your CV/ }).waitFor({ timeout: 60000 });
  check(
    'restore: the fresh profile really starts empty',
    !(await page.locator('body').innerText()).includes(EXPECT.employer),
  );

  await page.setInputFiles('[data-testid="backup-file"]', BACKUP_FILE);
  await page.getByTestId('backup-confirm').waitFor({ timeout: 30000 });
  const confirmText = await page.getByTestId('backup-confirm').innerText();
  check(
    'restore: choosing the file asks first, naming whose backup it is',
    confirmText.includes(EXPECT.last) &&
      !(await page.locator('body').innerText()).includes(EXPECT.employer),
    confirmText.slice(0, 120),
  );

  await page.getByRole('button', { name: 'Replace and restore' }).click();
  await page.getByTestId('backup-result').waitFor({ timeout: 60000 });
  const restoredBody = await page.locator('body').innerText();
  check(
    'restore: the CV, the résumé and the answers are back',
    restoredBody.includes(EXPECT.employer) &&
      restoredBody.includes(RESUME_NAME) &&
      (await page.getByTestId('answer-notice_period').inputValue()) === '1 month' &&
      (await page.getByTestId('answer-preferred_name').inputValue()) === 'Ada',
    (await page.getByTestId('backup-result').innerText()).slice(0, 120),
  );
  check(
    'restore: and so is the cover letter, text and file',
    restoredBody.includes(LETTER_NAME) &&
      (await page.getByTestId('answer-cover_letter').inputValue()) === LETTER,
    (await page.getByTestId('backup-result').innerText()).slice(0, 120),
  );

  // Shown on screen is not the same as usable. A real form, filled from the
  // restored vault: email and phone come out of encrypted columns, and the
  // résumé has to reach the file input byte for byte.
  const again = await fillBoard('lever');
  const av = again.state.values;
  check(
    'restore: the restored vault fills a real form, résumé attached',
    av.email === EXPECT.email &&
      av.phone === EXPECT.phone &&
      av.org === EXPECT.employer &&
      again.state.fileSize === RESUME_BYTES.length,
    JSON.stringify({ email: av.email, phone: av.phone, org: av.org, bytes: again.state.fileSize }),
  );
  await again.job.close();

  await ctx.close();

  check(
    'no request left the extension origin',
    offOrigin.length === 0,
    offOrigin.slice(0, 5).join(', '),
  );
  // The fixture pages are the only non-extension URLs, and every one of them
  // was answered from disk rather than fetched.
  check(
    'the only off-extension requests are the fixtures the harness served itself',
    servedLocally.length > 0 && servedLocally.every((u) => u.startsWith('https://')),
    `${servedLocally.length} fixture request(s)`,
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
    fs.rmSync(FRESH_PROFILE, { recursive: true, force: true });
    fs.rmSync(BACKUP_FILE, { force: true });
    process.exit(failures === 0 ? 0 : 1);
  });
