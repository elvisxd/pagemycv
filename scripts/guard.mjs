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
const NETWORK_DOOR = 'src/byte/client.ts';
forbid(
  /\bfetch\b|XMLHttpRequest|\bWebSocket\b|\bEventSource\b|sendBeacon|navigator\s*\??\.\s*sendBeacon|\bimportScripts\b|\bRTCPeerConnection\b/,
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
// Phase 1 writes to no page at all, so this is a tripwire rather than a proof:
// the module is required to exist before any DOM write does.
const FILL_DIR = join(SRC, 'fill');
if (existsSync(FILL_DIR)) {
  const fill = files.filter((f) => f.path.startsWith('src/fill/'));
  const names = fill.map((f) => f.path).join(' ');
  if (!/honeypot/.test(names))
    fail('src/fill/', 'a fill path exists with no honeypot denylist beside it');
  if (!/visibility/.test(names))
    fail('src/fill/', 'a fill path exists with no visibility gate beside it');
}

// ── Invariant 2 and the vault's own rules ───────────────────────────────────
forbid(/chrome\.storage\.sync|browser\.storage\.sync/, 'storage.sync would put the CV on a server');
forbid(/crypto\s*\??\.\s*subtle|\bsubtle\b\s*\./, 'crypto.subtle outside the one door', [
  'src/vault/crypto.ts',
]);
forbid(/sqlite3InitModule|OpfsSAHPoolDb/, 'SQLite outside the one door', ['src/db/worker.ts']);
// The key is matched by what it IS, not by what it is called.
forbid(
  /storage\.(local|session|managed)\.set|indexedDB\.|\bcaches\b\./,
  'persistent storage: the vault key must never reach it',
  ['src/db/worker.ts'],
);
forbid(/exportKey|extractable\s*:\s*true/, 'an extractable key');

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
const ALLOWED_PERMISSIONS = ['offscreen', 'unlimitedStorage', 'sidePanel'];
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
if (/host_permissions/.test(config))
  fail(configPath, 'host_permissions must stay empty until Phase 2');

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
  'invariant 3, page content never becomes an instruction',
  'invariant 5, one network door',
  'the vault key never reaches persistent storage',
  'one door each to crypto.subtle and to SQLite',
  'no telemetry, direct or transitive',
  'the manifest permissions and CSP',
];
const NOT_ENFORCED = [
  'invariant 2, sensitive fields never auto-fill — needs the Phase 2 fill path',
  'invariant 4, honeypots — a tripwire only until src/fill exists',
];

if (failures.length) {
  console.error(`guard: ${failures.length} problem(s)\n`);
  for (const f of failures) console.error(`  ${f}\n`);
  process.exit(1);
}
console.log(`guard: ${files.length} files checked`);
for (const e of ENFORCED) console.log(`  enforced      ${e}`);
for (const n of NOT_ENFORCED) console.log(`  NOT enforced  ${n}`);
