#!/usr/bin/env node
// Grep-level checks for the invariants in docs/03-security.md.
//
// Deliberately crude. An invariant enforced by something clever is an invariant
// nobody can audit at a glance. If a check fails, fix the code, never the check.
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';

const ROOT = process.cwd();
const SRC = join(ROOT, 'src');

function walk(dir) {
  const out = [];
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) out.push(...walk(full));
    else if (/\.(ts|tsx|js|mjs)$/.test(name)) out.push(full);
  }
  return out;
}

const files = walk(SRC).map((f) => ({ path: relative(ROOT, f), text: readFileSync(f, 'utf8') }));
const failures = [];

function forbid(pattern, message, allow = []) {
  for (const { path, text } of files) {
    if (allow.some((a) => path.replace(/\\/g, '/').endsWith(a))) continue;
    const lines = text.split('\n');
    lines.forEach((line, i) => {
      if (line.trimStart().startsWith('//') || line.trimStart().startsWith('*')) return;
      if (pattern.test(line)) failures.push(`${path}:${i + 1}  ${message}\n    ${line.trim()}`);
    });
  }
}

// 1. One door to the network. Phase 1 has no network code at all.
forbid(
  /\bfetch\s*\(|XMLHttpRequest|navigator\.sendBeacon/,
  'network call outside src/byte/client.ts',
  ['src/byte/client.ts'],
);

// 2. Never submit a form.
forbid(
  /\.submit\s*\(|requestSubmit\s*\(|type=["']submit["']\s*\][\s\S]*click|key\s*[:=]\s*["']Enter["']/,
  'a path that could submit a form',
  [],
);

// 3. Nothing syncs to Google.
forbid(/chrome\.storage\.sync|browser\.storage\.sync/, 'chrome.storage.sync is never used');

// 4. One door to the crypto primitives.
forbid(/crypto\.subtle/, 'crypto.subtle outside src/vault/crypto.ts', ['src/vault/crypto.ts']);

// 5. One door to SQLite.
forbid(/sqlite3InitModule|OpfsSAHPoolDb/, 'SQLite outside src/db/worker.ts', ['src/db/worker.ts']);

// 6. The key is never persisted, by any route.
forbid(
  /storage\.(local|session)\.set\s*\([^)]*\b(key|vaultKey|derivedKey)\b|indexedDB[\s\S]*\bkey\b/,
  'the vault key must never be persisted',
);

// 7. No telemetry dependency, ever.
const pkg = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8'));
const deps = Object.keys({ ...pkg.dependencies, ...pkg.devDependencies });
const banned = ['sentry', 'analytics', 'mixpanel', 'amplitude', 'posthog', 'datadog', 'bugsnag'];
for (const d of deps) {
  if (banned.some((b) => d.toLowerCase().includes(b))) {
    failures.push(`package.json  telemetry dependency is not allowed: ${d}`);
  }
}

// 8. Required permissions do not grow without a decision.
const ALLOWED_PERMISSIONS = ['offscreen', 'storage', 'unlimitedStorage', 'sidePanel'];
const config = readFileSync(join(ROOT, 'wxt.config.ts'), 'utf8');
const declared = [...config.matchAll(/permissions:\s*\[([^\]]*)\]/g)]
  .flatMap((m) => (m[1] ?? '').split(','))
  .map((p) => p.trim().replace(/['"]/g, ''))
  .filter(Boolean);
for (const p of declared) {
  if (!ALLOWED_PERMISSIONS.includes(p)) {
    failures.push(`wxt.config.ts  permission "${p}" is not on the allowlist in scripts/guard.mjs`);
  }
}
if (/host_permissions/.test(config)) {
  failures.push('wxt.config.ts  host_permissions must stay empty until Phase 2');
}

if (failures.length) {
  console.error(`guard: ${failures.length} problem(s)\n`);
  for (const f of failures) console.error(`  ${f}\n`);
  process.exit(1);
}
console.log(`guard: ${files.length} files checked, 8 invariants hold`);
