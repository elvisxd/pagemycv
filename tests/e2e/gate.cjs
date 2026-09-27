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
const PASSPHRASE = 'correct horse battery staple';

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
  'https://acme.wd5.myworkdayjobs.com',
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
  // Phase 4: every control inside a CLOSED shadow root, plus a dropdown that
  // is not a <select> and a honeypot the document's own stylesheet cannot
  // reach. Before this phase the page described as having zero fields.
  workday: {
    url: 'https://acme.wd5.myworkdayjobs.com/en-US/acme/job/Madrid/Engineer_R-1/apply/applyManually',
    file: path.join(__dirname, '../fixtures/workday.html'),
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

  // ── Phase 2: fill Lever and Greenhouse ──────────────────────────────
  //
  // The gate from docs/04-phases.md: a real application form on each board,
  // filled, reviewed, and never submitted. Zero sensitive fields written and
  // zero hidden fields written are the two that decide it.

  // Phase 2's value assertions run against the fixture CV, deliberately, even
  // when a real one was used above. Run 1 proves the import works on the real
  // thing; asserting here that a particular email reaches a particular box
  // would otherwise depend on what one person happens to have in their CV,
  // and a gate that passes or fails on that is testing the wrong machine.
  await page.getByRole('button', { name: /Re-import CV/ }).click();
  await page.getByTestId('cv-markdown').fill(FIXTURE_CV);
  await page.getByRole('button', { name: 'Import' }).click();
  await page.getByTestId('import-result').waitFor({ timeout: 60000 });
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

  const plain = await fillBoard('plainPage');
  check(
    'a page with no content script is refused with a DIFFERENT reason',
    /does not know this page/i.test(plain.failed ?? ''),
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
      !(manifest.permissions ?? []).includes('webNavigation') &&
      !(manifest.permissions ?? []).includes('tabs'),
    JSON.stringify({ permissions: manifest.permissions, hosts: manifest.host_permissions ?? null }),
  );
  check(
    'the content script is declared for the three supported boards only, in all frames',
    (manifest.content_scripts ?? []).every(
      (c) =>
        c.all_frames === true &&
        // Spelled out rather than loosened to a wildcard. The point of this
        // check is that adding a host is a visible edit here, so a pattern
        // permissive enough to absorb the next one silently would delete
        // the check while leaving it looking present. Workday's own entry
        // IS a wildcard, and only over its own apex.
        (c.matches ?? []).every((m) =>
          /^https:\/\/(jobs\.lever\.co|(job-)?boards\.greenhouse\.io|\*\.myworkdayjobs\.com)\/\*$/.test(
            m,
          ),
        ),
    ),
    JSON.stringify((manifest.content_scripts ?? []).map((c) => c.matches)),
  );

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
    process.exit(failures === 0 ? 0 : 1);
  });
