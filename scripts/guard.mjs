#!/usr/bin/env node
// Static checks over src/, for the invariants in docs/03-security.md.
//
// A grep can never prove an invariant. What it can do is make a violation loud,
// refuse to pass when it cannot understand what it is reading, and say exactly
// which invariants it does and does not cover. The previous version of this
// file printed "8 invariants hold" while three of the five documented
// invariants had no check at all, and its permission check silently passed when
// the manifest used a variable. Both were worse than having no guard.
//
// The runtime counterpart is tests/e2e/gate.cjs, which watches real requests in
// a real browser. Neither replaces the other.
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';

const ROOT = process.cwd();
const SRC = join(ROOT, 'src');
const CODE = /\.(ts|tsx|mts|cts|js|jsx|mjs|cjs)$/;

function walk(dir) {
  const out = [];
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) out.push(...walk(full));
    else if (CODE.test(name)) out.push(full);
  }
  return out;
}

/**
 * Blanks out comments while preserving line structure, so a sentence explaining
 * an invariant cannot trip that invariant's own check, and a `//` inside a
 * template literal is still scanned. Character-by-character rather than regex,
 * because regexes cannot tell a comment from a string.
 */
function stripComments(text) {
  let out = '';
  let i = 0;
  let mode = 'code'; // code | line | block | single | double | template
  while (i < text.length) {
    const c = text[i];
    const next = text[i + 1];
    if (mode === 'code') {
      if (c === '/' && next === '/') {
        mode = 'line';
        out += '  ';
        i += 2;
        continue;
      }
      if (c === '/' && next === '*') {
        mode = 'block';
        out += '  ';
        i += 2;
        continue;
      }
      if (c === "'") mode = 'single';
      else if (c === '"') mode = 'double';
      else if (c === '`') mode = 'template';
      out += c;
      i++;
      continue;
    }
    if (mode === 'line') {
      if (c === '\n') {
        mode = 'code';
        out += c;
      } else out += ' ';
      i++;
      continue;
    }
    if (mode === 'block') {
      if (c === '*' && next === '/') {
        mode = 'code';
        out += '  ';
        i += 2;
        continue;
      }
      out += c === '\n' ? '\n' : ' ';
      i++;
      continue;
    }
    // inside a string or template: copy verbatim, honour escapes
    if (c === '\\') {
      out += c + (next ?? '');
      i += 2;
      continue;
    }
    if (
      (mode === 'single' && c === "'") ||
      (mode === 'double' && c === '"') ||
      (mode === 'template' && c === '`')
    ) {
      mode = 'code';
    }
    out += c;
    i++;
  }
  return out;
}

const files = walk(SRC).map((f) => ({
  path: relative(ROOT, f).replace(/\\/g, '/'),
  text: stripComments(readFileSync(f, 'utf8')),
}));

const failures = [];
const fail = (where, message) => failures.push(`${where}  ${message}`);

function forbid(pattern, message, allow = []) {
  for (const { path, text } of files) {
    if (allow.some((a) => path.endsWith(a))) continue;
    text.split('\n').forEach((line, i) => {
      if (pattern.test(line)) fail(`${path}:${i + 1}`, `${message}\n      ${line.trim()}`);
    });
  }
}

// ── Invariant 5: nothing leaves the machine except the configured Byte call ──
// Every transport, not just fetch. An alias (`const f = globalThis.fetch`) still
// slips through; that is why tests/e2e/gate.cjs watches real requests.
//
// `chrome.identity` is on this list because it was NOT, and the hole was
// real: `chrome.identity.getAuthToken` talks to Google and is none of the
// transports below, so a call to it passed the guard in any file. Invariant
// 5 says nothing phones home, and it was being enforced as "none of these
// six APIs" — which is a narrower claim wearing the same name. `downloads`
// and `WebTransport` were missing for the same reason.
//
// A regex can never be complete, and pretending otherwise is how the next
// hole gets in. What this list can promise is that every way out we know of
// has to go through one named door.
const NETWORK_DOOR = 'src/byte/client.ts';
forbid(
  /\bfetch\b|XMLHttpRequest|\bWebSocket\b|\bWebTransport\b|\bEventSource\b|sendBeacon|navigator\s*\??\.\s*sendBeacon|\bimportScripts\b|\bRTCPeerConnection\b|chrome\s*\??\.\s*identity\b|chrome\s*\??\.\s*downloads\b/,
  'network transport outside the one door',
  [NETWORK_DOOR],
);
// An allowlisted path that does not exist is an allowlist nobody is watching.
if (!existsSync(join(ROOT, NETWORK_DOOR))) {
  const used = files.some((f) => f.path === NETWORK_DOOR);
  if (used) fail('scripts/guard.mjs', `${NETWORK_DOOR} is allowlisted and missing`);
}

// ── Invariant 1: never submit a form ────────────────────────────────────────
forbid(
  /\.submit\s*\(|\.requestSubmit\s*\(|\bsubmit\b\s*\.\s*call\s*\(/,
  'a path that could submit a form',
);
forbid(/new\s+(Event|SubmitEvent)\s*\(\s*['"`]submit/, 'a synthesized submit event');
forbid(
  /new\s+KeyboardEvent|keyCode\s*:\s*13|which\s*:\s*13/,
  'a synthesized key press, which can submit a form',
);

// ── Invariant 3: page content never becomes an instruction ──────────────────
forbid(/\beval\s*\(|new\s+Function\s*\(|\bimport\s*\(/, 'dynamic code execution');
forbid(/setTimeout\s*\(\s*['"`]|setInterval\s*\(\s*['"`]/, 'a timer given a string to execute');
forbid(/\.innerHTML\s*=|insertAdjacentHTML|\bdocument\.write\b/, 'HTML built from a string');

// ── Invariant 4: never write to a honeypot ──────────────────────────────────
// Both layers have to exist AND be reached. The previous version checked only
// that files with those names were present, which a refactor that stopped
// calling them would have passed.
const FILL_DIR = join(SRC, 'fill');
if (existsSync(FILL_DIR)) {
  const byPath = new Map(files.map((f) => [f.path, f.text]));
  const plan = byPath.get('src/fill/plan.ts');
  if (!plan) {
    fail('src/fill/', 'a fill path exists with no planner; nothing decides what is refused');
  } else {
    if (!/honeypotReason\s*\(/.test(plan))
      fail('src/fill/plan.ts', 'the planner never calls the honeypot denylist');
    if (!/visibilityProblem\s*\(/.test(plan))
      fail('src/fill/plan.ts', 'the planner never calls the visibility gate');
  }
  if (!byPath.has('src/fill/honeypot.ts'))
    fail('src/fill/', 'a fill path exists with no honeypot denylist beside it');
  if (!byPath.has('src/fill/visibility.ts'))
    fail('src/fill/', 'a fill path exists with no visibility gate beside it');

  // A plan crosses two message hops before it is executed, so the element a
  // ref points at can have been re-rendered into a different field. Writing
  // without re-checking puts the right value in the wrong box and reports a
  // success, which is the worst failure this code can have.
  const writer = byPath.get('src/fill/write.ts');
  if (!writer) {
    fail('src/fill/', 'no writer; the guard cannot verify the write-time checks');
  } else {
    if (!/fingerprintOf\s*\(/.test(writer))
      fail('src/fill/write.ts', 'writes without re-deriving the field fingerprint');
    if (!/\.isConnected/.test(writer))
      fail('src/fill/write.ts', 'writes without checking the element is still in the page');
  }

  // The only module allowed to write to a page is the one whose whole job is
  // that, so a DOM write cannot quietly appear in the classifier or the
  // planner where no honeypot check guards it.
  for (const { path, text } of files) {
    if (!path.startsWith('src/fill/') && path !== 'src/entrypoints/content.ts') continue;
    if (path === 'src/fill/write.ts') continue;
    if (/\.value\s*=[^=]|\.files\s*=[^=]|setAttribute\s*\(|\.checked\s*=[^=]/.test(text)) {
      fail(path, 'writes to the page outside src/fill/write.ts, where the guards are');
    }
  }
}

// ── Invariant 2: a sensitive value never reaches the fill path ──────────────
// Enforced by absence, not by filtering. Nothing that runs in or feeds a page
// may name the columns a sensitive value is stored in, so there is no ordering
// bug or forgotten filter that could let one through.
for (const { path, text } of files) {
  if (!path.startsWith('src/fill/') && path !== 'src/entrypoints/content.ts') continue;
  if (/sensitive_value|value_enc/.test(text)) {
    fail(path, 'the fill path names a sensitive storage column');
  }
}
// And the values object the worker hands out must be built from a literal set
// of keys rather than from a query, which is the shape a leak would need.
const workerText = files.find((f) => f.path === 'src/db/worker.ts')?.text ?? '';
if (workerText) {
  const fn = /async function readFillValues\([\s\S]*?\n}/.exec(workerText);
  if (!fn) {
    fail('src/db/worker.ts', 'readFillValues could not be located; the guard cannot verify it');
  } else if (/sensitive_value/.test(fn[0])) {
    fail('src/db/worker.ts', 'readFillValues reads the sensitive_value table');
  }
}

// ── Invariant 2 and the vault's own rules ───────────────────────────────────
forbid(/chrome\.storage\.sync|browser\.storage\.sync/, 'storage.sync would put the CV on a server');
forbid(/crypto\s*\??\.\s*subtle|\bsubtle\b\s*\./, 'crypto.subtle outside the one door', [
  'src/vault/crypto.ts',
]);
forbid(/sqlite3InitModule|OpfsSAHPoolDb/, 'SQLite outside the one door', ['src/db/worker.ts']);
// Reaching into a closed shadow root is a capability, not a utility. A second
// caller is a second place that can forget the closed case — and the closed
// case fails silently: a flat query just returns nothing, so the form reads
// as empty rather than as unreadable.
forbid(/openOrClosedShadowRoot/, 'the shadow-root door is src/fill/shadow.ts', [
  'src/fill/shadow.ts',
]);
// The key is matched by what it IS, not by what it is called.
// The vault key is on disk now: there is no passphrase, so something has to
// hold it. What this still enforces is that ONE module does. The rule used to
// be "never persisted" and the allowlist was the worker, which turned out to
// be the one context that cannot persist anything — `chrome` is undefined in a
// dedicated worker (spikes/phase-5).
forbid(
  /storage\.(local|session|managed)\.set|indexedDB\.|\bcaches\b\./,
  'persistent storage: only the key store may write the vault key',
  ['src/vault/key-store.ts'],
);
forbid(/exportKey|extractable\s*:\s*true/, 'an extractable key');
// The one call that widens where the extension's code runs. On-demand
// injection is the whole reason 'activeTab' and 'scripting' are in the
// manifest, and one caller is the whole reason it is acceptable.
forbid(/chrome\s*\??\.\s*scripting\b/, 'chrome.scripting outside the one door', [
  'src/fill/inject.ts',
]);
// pdf.js parses a file the person chose, in the side panel. One importer means
// one place that configures it to fetch nothing, and one place to read when
// the dependency is updated.
forbid(/pdfjs-dist/, 'pdf.js outside the one door', ['src/import/pdf-text.ts']);

// ── Dependencies ────────────────────────────────────────────────────────────
const pkg = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8'));
const BANNED = [
  'sentry',
  'analytics',
  'mixpanel',
  'amplitude',
  'posthog',
  'datadog',
  'bugsnag',
  'logrocket',
  'rollbar',
  'newrelic',
  'segment',
  'rudder',
  'plausible',
  'umami',
  'opentelemetry',
  'statsig',
  'launchdarkly',
  'heap',
  'fullstory',
];
const lock = existsSync(join(ROOT, 'pnpm-lock.yaml'))
  ? readFileSync(join(ROOT, 'pnpm-lock.yaml'), 'utf8')
  : '';
for (const name of [...Object.keys({ ...pkg.dependencies, ...pkg.devDependencies })]) {
  if (BANNED.some((b) => name.toLowerCase().includes(b)))
    fail('package.json', `telemetry dependency: ${name}`);
}
for (const b of BANNED) {
  // Transitive too: a dependency of a dependency ships in the same bundle.
  const hit = new RegExp(`\\n  /?['"]?@?[\\w.@/-]*${b}[\\w.@/-]*@`, 'i').exec(lock);
  if (hit) fail('pnpm-lock.yaml', `telemetry package in the dependency tree: ${hit[0].trim()}`);
}

// ── The manifest ────────────────────────────────────────────────────────────
// 'activeTab' and 'scripting' together are how a content script reaches a
// page the manifest does not name: only the tab the person last invoked the
// extension on, only until they leave it, and never persistently. Both are
// here for exactly that, and src/fill/inject.ts is the only module allowed
// to use them — the forbid() below enforces it. Still no host permissions.
const ALLOWED_PERMISSIONS = [
  'offscreen',
  'unlimitedStorage',
  'sidePanel',
  'storage',
  'activeTab',
  'scripting',
];
const configPath = 'wxt.config.ts';
const config = readFileSync(join(ROOT, configPath), 'utf8');

const permMatch = /permissions:\s*(\[[^\]]*\])/.exec(config);
if (!permMatch) {
  // Unparseable is a failure, never a pass. The previous version reported
  // success here, which meant a computed permission list disabled the check.
  fail(configPath, 'could not read `permissions:` as a literal array; the guard cannot verify it');
} else {
  for (const p of permMatch[1]
    .replace(/[[\]'"]/g, '')
    .split(',')
    .map((x) => x.trim())
    .filter(Boolean)) {
    if (!ALLOWED_PERMISSIONS.includes(p)) {
      fail(configPath, `permission "${p}" is not on the allowlist in scripts/guard.mjs`);
    }
  }
}
// Still empty in Phase 2, and not as a deferral. The content script's own
// `matches` grant it the two hosts it runs on; host_permissions would also
// give the background the URL of every tab, which it has no use for. The
// background reads a tab id and nothing else, and gets the URL from the
// content script that is already there. Phase 3 revisits this with a runtime
// request on a user gesture, which is a different thing from a static grant.
if (/host_permissions/.test(config))
  fail(configPath, 'host_permissions must stay empty; the content script matches are the grant');

// ── The content script's reach ──────────────────────────────────────────────
// Declared from src/ats/registry.ts, so a host cannot be added to the
// manifest without also being added to the registry the classifier reads.
const registryPath = 'src/ats/registry.ts';
const contentPath = 'src/entrypoints/content.ts';
const contentText = files.find((f) => f.path === contentPath)?.text;
if (contentText) {
  if (!/matches:\s*\[\.\.\.CONTENT_MATCHES\]/.test(contentText)) {
    fail(contentPath, 'the content script must take its matches from CONTENT_MATCHES');
  }
  const registryText = files.find((f) => f.path === registryPath)?.text ?? '';
  const hosts = [...registryText.matchAll(/hosts:\s*\[([^\]]*)\]/g)].flatMap((m) =>
    m[1]
      .split(',')
      .map((x) => x.trim().replace(/['"]/g, ''))
      .filter(Boolean),
  );
  if (hosts.length === 0) {
    fail(registryPath, 'no host list could be read; the guard cannot verify the reach');
  }
  const ALLOWED_HOSTS = [
    'jobs.lever.co',
    'boards.greenhouse.io',
    'job-boards.greenhouse.io',
    'jobs.ashbyhq.com',
    // Subdomains only. Every Workday tenant has its own, so the host cannot
    // be enumerated; the apex is not an application form and the registry
    // returns `unknown` for it.
    '*.myworkdayjobs.com',
    // From the URL table in docs/09-ats.md. Declared with empty field maps:
    // the host is documented, the form is not, and a map written from
    // guesswork would be a hypothesis with a confidence score.
    'apply.workable.com',
    'careers.smartrecruiters.com',
    'jobs.smartrecruiters.com',
    'jobs.jobvite.com',
  ];
  for (const h of hosts) {
    if (!ALLOWED_HOSTS.includes(h)) {
      fail(registryPath, `host "${h}" is not on the allowlist in scripts/guard.mjs`);
    }
  }
}

const cspMatch = /extension_pages:\s*(['"`])([\s\S]*?)\1/.exec(config);
if (!cspMatch) {
  fail(configPath, 'could not read the extension_pages CSP; the guard cannot verify it');
} else {
  const csp = cspMatch[2];
  if (/https?:|\bdata:|\bblob:|unsafe-inline|'unsafe-eval'/.test(csp)) {
    fail(configPath, `the CSP allows a remote or unsafe script source: ${csp}`);
  }
  if (!/'wasm-unsafe-eval'/.test(csp))
    fail(configPath, 'the CSP must keep wasm-unsafe-eval for SQLite');
}

// ── Report ──────────────────────────────────────────────────────────────────
const ENFORCED = [
  'invariant 1, never submit a form',
  'invariant 2, no sensitive column is named anywhere the fill path can reach',
  'invariant 3, page content never becomes an instruction',
  'invariant 4, both honeypot layers exist and the planner calls them',
  'invariant 5, one network door',
  'the vault key reaches persistent storage through one module and no other',
  'one door each to crypto.subtle, to SQLite and to writing the page',
  'one door into closed shadow roots',
  'the writer re-checks the element before it writes',
  'no telemetry, direct or transitive',
  'the manifest permissions and CSP, and no host_permissions',
  'the declared content script reaches only the allowlisted boards; elsewhere, one module, on the active tab',
];
const NOT_ENFORCED = [
  'invariant 2 end to end — that a real form leaves them empty is gate.cjs, not this',
  'invariant 4 end to end — that a real honeypot is refused is gate.cjs, not this',
];

if (failures.length) {
  console.error(`guard: ${failures.length} problem(s)\n`);
  for (const f of failures) console.error(`  ${f}\n`);
  process.exit(1);
}
console.log(`guard: ${files.length} files checked`);
for (const e of ENFORCED) console.log(`  enforced      ${e}`);
for (const n of NOT_ENFORCED) console.log(`  NOT enforced  ${n}`);
