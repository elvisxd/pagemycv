/// <reference lib="webworker" />
// The ONLY module that touches SQLite, and the only place the vault key exists.
//
// It runs in a dedicated worker because that is the single context where
// FileSystemFileHandle.createSyncAccessHandle is exposed. The service worker
// cannot host this: it has neither that API nor the Worker constructor needed
// to delegate. Both were confirmed in a real browser, see spikes/phase-0.
import sqlite3InitModule from '@sqlite.org/sqlite-wasm';
import { parseCvMarkdown } from '../import/cv-markdown';
import { SENSITIVE_FIELDS, sensitiveByKey } from '../sensitive/registry';
import {
  checkVerifier,
  decryptValue,
  deriveKey,
  encryptValue,
  KDF,
  KDF_ID,
  makeVerifier,
  randomSalt,
} from '../vault/crypto';
import INITIAL_SQL from './migrations/001_initial.sql?raw';
import type { ProfileView, VaultState } from './schema';

const DB_PATH = '/pagemycv.sqlite3';
const POOL_NAME = 'pagemycv';
const AUTO_LOCK_MS = 15 * 60 * 1000;

// biome-ignore lint/suspicious/noExplicitAny: the sqlite-wasm oo1 handle is untyped.
type Db = any;

let db: Db | null = null;
/** Never written anywhere. Lost when this worker dies, which is intended. */
let key: CryptoKey | null = null;
let locksAt = 0;

const uid = () => crypto.randomUUID();
const now = () => Date.now();

async function openDatabase(): Promise<Db> {
  if (db) return db;
  const sqlite3 = await sqlite3InitModule();
  if (typeof sqlite3.installOpfsSAHPoolVfs !== 'function') {
    throw new Error('opfs-sahpool is unavailable in this context');
  }
  const pool = await sqlite3.installOpfsSAHPoolVfs({ name: POOL_NAME });
  db = new pool.OpfsSAHPoolDb(DB_PATH);
  migrate();
  return db;
}

function migrate(): void {
  const version = db.selectValue('PRAGMA user_version') as number;
  if (version < 1) {
    db.exec('BEGIN');
    try {
      db.exec(INITIAL_SQL);
      db.exec('PRAGMA user_version = 1');
      db.exec('COMMIT');
    } catch (err) {
      db.exec('ROLLBACK');
      throw err;
    }
  }
}

function rows<T = Record<string, unknown>>(sql: string, bind: unknown[] = []): T[] {
  const out: T[] = [];
  db.exec({ sql, bind, rowMode: 'object', callback: (r: T) => out.push(r) });
  return out;
}

function log(kind: string, detail?: string): void {
  db.exec({
    sql: 'INSERT INTO event_log (at, kind, detail) VALUES (?, ?, ?)',
    bind: [now(), kind, detail ?? null],
  });
}

function autoLockIfDue(): void {
  if (key && locksAt && now() > locksAt) lockVault('auto');
}

function lockVault(why: string): void {
  if (!key) return;
  key = null;
  locksAt = 0;
  if (db) log('lock', why);
}

function state(): VaultState {
  autoLockIfDue();
  if (!db) return { status: 'absent' };
  const hasVault = (db.selectValue('SELECT count(*) FROM vault') as number) > 0;
  if (!hasVault) return { status: 'absent' };
  return key ? { status: 'unlocked', locksAt } : { status: 'locked' };
}

function extendLock(): void {
  if (key) locksAt = now() + AUTO_LOCK_MS;
}

function requireKey(): CryptoKey {
  autoLockIfDue();
  if (!key) throw new Error('vault is locked');
  extendLock();
  return key;
}

async function createVault(passphrase: string): Promise<VaultState> {
  await openDatabase();
  if ((db.selectValue('SELECT count(*) FROM vault') as number) > 0) {
    throw new Error('a vault already exists');
  }
  const salt = randomSalt();
  const derived = await deriveKey(passphrase, salt);
  const verifier = await makeVerifier(derived);
  const t = now();
  db.exec({
    sql: `INSERT INTO vault (id, kdf, kdf_params, salt, verifier_enc, created_at, updated_at)
          VALUES (1, ?, ?, ?, ?, ?, ?)`,
    bind: [
      KDF_ID,
      JSON.stringify({ m: KDF.memorySize, t: KDF.iterations, p: KDF.parallelism }),
      salt,
      verifier,
      t,
      t,
    ],
  });
  for (const f of SENSITIVE_FIELDS) {
    db.exec({
      sql: `INSERT INTO sensitive_value (id, category, key, label, value_enc, reason, created_at, updated_at)
            VALUES (?, ?, ?, ?, NULL, ?, ?, ?)`,
      bind: [uid(), f.category, f.key, f.label, f.reason, t, t],
    });
  }
  key = derived;
  extendLock();
  log('create');
  return state();
}

async function unlockVault(passphrase: string): Promise<VaultState> {
  await openDatabase();
  const row = rows<{ salt: Uint8Array; verifier_enc: Uint8Array }>(
    'SELECT salt, verifier_enc FROM vault WHERE id = 1',
  )[0];
  if (!row) throw new Error('no vault to unlock');
  const derived = await deriveKey(passphrase, new Uint8Array(row.salt));
  if (!(await checkVerifier(derived, new Uint8Array(row.verifier_enc)))) {
    log('unlock_failed');
    throw new Error('wrong passphrase');
  }
  key = derived;
  extendLock();
  log('unlock');
  return state();
}

async function readContact(k: CryptoKey): Promise<ProfileView['contact']> {
  const row = rows<Record<string, Uint8Array | string | null>>(
    'SELECT email_enc, phone_enc, city_enc, region, country FROM contact WHERE id = 1',
  )[0];
  if (!row) return null;
  const open = async (column: string): Promise<string | null> => {
    const blob = row[column];
    if (!blob || typeof blob === 'string') return null;
    return decryptValue(k, new Uint8Array(blob), 'contact:1', column);
  };
  return {
    email: await open('email_enc'),
    phone: await open('phone_enc'),
    city: await open('city_enc'),
    region: (row.region as string) ?? null,
    country: (row.country as string) ?? 'US',
  };
}

async function profileView(): Promise<ProfileView> {
  const k = requireKey();
  const profileRow = rows<Record<string, string | null>>(
    'SELECT legal_first, legal_last, preferred_name, headline, summary FROM profile WHERE id = 1',
  )[0];
  return {
    profile: profileRow
      ? {
          legalFirst: profileRow.legal_first ?? '',
          legalLast: profileRow.legal_last ?? '',
          preferredName: profileRow.preferred_name ?? null,
          headline: profileRow.headline ?? null,
          summary: profileRow.summary ?? null,
        }
      : null,
    contact: await readContact(k),
    work: rows<Record<string, string | number | null>>(
      'SELECT id, employer, title, location, is_remote, started_on, ended_on, description, sort_order FROM work_history ORDER BY sort_order',
    ).map((r) => ({
      id: String(r.id),
      employer: String(r.employer),
      title: String(r.title),
      location: (r.location as string) ?? null,
      isRemote: Number(r.is_remote) === 1,
      startedOn: String(r.started_on ?? ''),
      endedOn: (r.ended_on as string) ?? null,
      description: (r.description as string) ?? null,
      sortOrder: Number(r.sort_order),
    })),
    education: rows<Record<string, string | number | null>>(
      'SELECT id, institution, degree, field, started_on, ended_on, sort_order FROM education ORDER BY sort_order',
    ).map((r) => ({
      id: String(r.id),
      institution: String(r.institution),
      degree: (r.degree as string) ?? null,
      field: (r.field as string) ?? null,
      startedOn: (r.started_on as string) ?? null,
      endedOn: (r.ended_on as string) ?? null,
      sortOrder: Number(r.sort_order),
    })),
    links: rows<Record<string, string | number>>(
      'SELECT id, kind, url, sort_order FROM link ORDER BY sort_order',
    ).map((r) => ({
      id: String(r.id),
      kind: String(r.kind),
      url: String(r.url),
      sortOrder: Number(r.sort_order),
    })),
    // Metadata only. A value never leaves this worker without a confirmation,
    // which is Phase 2's flow, not this one's.
    sensitive: rows<Record<string, string | Uint8Array | null>>(
      'SELECT key, category, label, reason, value_enc FROM sensitive_value ORDER BY category, key',
    ).map((r) => ({
      key: String(r.key),
      category: r.category as ProfileView['sensitive'][number]['category'],
      label: String(r.label),
      reason: String(r.reason),
      hasValue: r.value_enc != null,
    })),
  };
}

async function importCv(
  markdown: string,
): Promise<{ imported: true; counts: Record<string, number> }> {
  const k = requireKey();
  const cv = parseCvMarkdown(markdown);
  const t = now();
  db.exec('BEGIN');
  try {
    db.exec('DELETE FROM work_history');
    db.exec('DELETE FROM education');
    db.exec('DELETE FROM link');
    db.exec({
      sql: `INSERT INTO profile (id, legal_first, legal_last, headline, summary, created_at, updated_at)
            VALUES (1, ?, ?, ?, ?, ?, ?)
            ON CONFLICT(id) DO UPDATE SET
              legal_first = excluded.legal_first, legal_last = excluded.legal_last,
              headline = excluded.headline, summary = excluded.summary, updated_at = excluded.updated_at`,
      bind: [cv.legalFirst, cv.legalLast, cv.headline, cv.summary, t, t],
    });
    const cityEnc = cv.city ? await encryptValue(k, cv.city, 'contact:1', 'city_enc') : null;
    db.exec({
      sql: `INSERT INTO contact (id, city_enc, region, country, created_at, updated_at)
            VALUES (1, ?, ?, 'US', ?, ?)
            ON CONFLICT(id) DO UPDATE SET
              city_enc = excluded.city_enc, region = excluded.region, updated_at = excluded.updated_at`,
      bind: [cityEnc, cv.region, t, t],
    });
    cv.work.forEach((w, i) => {
      db.exec({
        sql: `INSERT INTO work_history (id, employer, title, location, is_remote, started_on, ended_on, description, sort_order, created_at, updated_at)
              VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        bind: [
          uid(),
          w.employer,
          w.title,
          w.location,
          w.isRemote ? 1 : 0,
          w.startedOn,
          w.endedOn,
          w.description,
          i,
          t,
          t,
        ],
      });
    });
    cv.education.forEach((e, i) => {
      db.exec({
        sql: `INSERT INTO education (id, institution, degree, field, started_on, ended_on, sort_order, created_at, updated_at)
              VALUES (?, ?, ?, NULL, ?, ?, ?, ?, ?)`,
        bind: [uid(), e.institution, e.degree, e.startedOn, e.endedOn, i, t, t],
      });
    });
    cv.links.forEach((l, i) => {
      db.exec({
        sql: 'INSERT INTO link (id, kind, url, sort_order) VALUES (?, ?, ?, ?)',
        bind: [uid(), l.kind, l.url, i],
      });
    });
    db.exec('COMMIT');
  } catch (err) {
    db.exec('ROLLBACK');
    throw err;
  }
  log('import_cv', `${cv.work.length} roles, ${cv.education.length} degrees`);
  return {
    imported: true,
    counts: { work: cv.work.length, education: cv.education.length, links: cv.links.length },
  };
}

/** Stores a sensitive value. Reading one back always goes through a confirmation. */
export async function setSensitive(
  dbKey: CryptoKey,
  fieldKey: string,
  value: string,
): Promise<void> {
  const def = sensitiveByKey(fieldKey);
  if (!def) throw new Error(`not a sensitive field: ${fieldKey}`);
  const row = rows<{ id: string }>('SELECT id FROM sensitive_value WHERE key = ?', [fieldKey])[0];
  if (!row) throw new Error(`sensitive field missing from registry: ${fieldKey}`);
  const blob = await encryptValue(dbKey, value, `sensitive:${row.id}`, 'value_enc', {
    padded: def.padded,
  });
  db.exec({
    sql: 'UPDATE sensitive_value SET value_enc = ?, updated_at = ? WHERE id = ?',
    bind: [blob, now(), row.id],
  });
}

const handlers: Record<string, (payload: Record<string, string>) => Promise<unknown>> = {
  async state() {
    await openDatabase();
    return state();
  },
  async create({ passphrase }) {
    return createVault(passphrase ?? '');
  },
  async unlock({ passphrase }) {
    return unlockVault(passphrase ?? '');
  },
  async lock() {
    lockVault('manual');
    return state();
  },
  async profile() {
    await openDatabase();
    return profileView();
  },
  async importCv({ markdown }) {
    await openDatabase();
    return importCv(markdown ?? '');
  },
  async touch() {
    await openDatabase();
    autoLockIfDue();
    extendLock();
    return state();
  },
};

self.onmessage = async (event: MessageEvent) => {
  const { id, cmd, payload } = event.data ?? {};
  try {
    const handler = handlers[cmd];
    if (!handler) throw new Error(`unknown command: ${cmd}`);
    self.postMessage({ id, ok: true, value: await handler(payload ?? {}) });
  } catch (err) {
    self.postMessage({ id, ok: false, error: err instanceof Error ? err.message : String(err) });
  }
};
