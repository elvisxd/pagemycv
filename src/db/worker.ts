/// <reference lib="webworker" />
// The ONLY module that touches SQLite, and the only place the vault key exists.
//
// It runs in a dedicated worker because that is the single context where
// FileSystemFileHandle.createSyncAccessHandle is exposed. The service worker
// cannot host this: it has neither that API nor the Worker constructor needed
// to delegate. Both were confirmed in a real browser, see spikes/phase-0.
import sqlite3InitModule from '@sqlite.org/sqlite-wasm';
import type { FillValues, ResumeFile } from '../fill/types';
import { parseCvMarkdown } from '../import/cv-markdown';
import { SENSITIVE_FIELDS } from '../sensitive/registry';
import {
  checkVerifier,
  decryptValue,
  deriveKey,
  encryptValue,
  KDF,
  KDF_ID,
  makeVerifier,
  passphraseProblem,
  randomSalt,
} from '../vault/crypto';
import INITIAL_SQL from './migrations/001_initial.sql?raw';
import type { ProfileView, ResumeMeta, VaultState } from './schema';

const DB_PATH = '/pagemycv.sqlite3';
const POOL_NAME = 'pagemycv';
const AUTO_LOCK_MS = 15 * 60 * 1000;

// biome-ignore lint/suspicious/noExplicitAny: the sqlite-wasm oo1 handle is untyped.
type Db = any;

let db: Db | null = null;
/**
 * The in-flight open, cached. Without this, two messages arriving close
 * together both pass the `if (db)` guard, because there are two awaits before
 * the assignment, and both call installOpfsSAHPoolVfs. That VFS holds
 * exclusive file handles, so the second install fails and the failure looks
 * random rather than like a race.
 */
let opening: Promise<Db> | null = null;
/** Never written anywhere. Lost when this worker dies, which is intended. */
let key: CryptoKey | null = null;
let locksAt = 0;
/**
 * Bumped every time the vault locks. An operation that captured the key before
 * a lock holds a local reference that nulling `key` cannot reach, so it would
 * happily finish decrypting and hand plaintext back after the vault reported
 * itself locked. Every await that sits between capturing the key and using its
 * output re-checks this.
 */
let keyGeneration = 0;

interface KeyLease {
  readonly key: CryptoKey;
  readonly generation: number;
}

const uid = () => crypto.randomUUID();
const now = () => Date.now();

function openDatabase(): Promise<Db> {
  if (db) return Promise.resolve(db);
  if (opening) return opening;
  opening = (async () => {
    const sqlite3 = await sqlite3InitModule();
    if (typeof sqlite3.installOpfsSAHPoolVfs !== 'function') {
      throw new Error('opfs-sahpool is unavailable in this context');
    }
    const pool = await sqlite3.installOpfsSAHPoolVfs({ name: POOL_NAME });
    // Migrate against a local handle and publish it only on success. Assigning
    // `db` first would leave an un-migrated handle in place that the `if (db)`
    // fast path hands back forever, so one failed migration would brick the
    // extension for the life of the offscreen document.
    const handle = new pool.OpfsSAHPoolDb(DB_PATH);
    // Durability over speed. The default (NORMAL) lets a commit return before
    // the bytes are flushed to the synchronous access handle, so a browser that
    // closes right after a write can lose it. This is a vault: a commit that
    // reports success and then disappears is the worst possible failure.
    handle.exec('PRAGMA synchronous = FULL');
    migrate(handle);
    db = handle;
    return db;
  })().catch((err) => {
    // A failed open must not poison every later attempt.
    db = null;
    opening = null;
    throw err;
  });
  return opening;
}

function migrate(handle: Db): void {
  const version = handle.selectValue('PRAGMA user_version') as number;
  if (version > 1) {
    throw new Error(`this vault was written by a newer version (schema ${version})`);
  }
  if (version < 1) {
    handle.exec('BEGIN');
    try {
      handle.exec(INITIAL_SQL);
      handle.exec('PRAGMA user_version = 1');
      handle.exec('COMMIT');
    } catch (err) {
      // A rollback that itself throws must not replace the real error.
      try {
        handle.exec('ROLLBACK');
      } catch {}
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
  keyGeneration++;
  if (db) log('lock', why);
}

function state(): VaultState {
  autoLockIfDue();
  // Never report a database we could not open as an absent vault. That screen
  // offers to create one, and creating over an existing vault is data loss.
  if (!db) return { status: 'unavailable', problem: 'the database could not be opened' };
  const hasVault = (db.selectValue('SELECT count(*) FROM vault') as number) > 0;
  if (!hasVault) return { status: 'absent' };
  return key ? { status: 'unlocked', locksAt } : { status: 'locked' };
}

function extendLock(): void {
  if (key) locksAt = now() + AUTO_LOCK_MS;
}

function requireKey(): KeyLease {
  autoLockIfDue();
  if (!key) throw new Error('vault is locked');
  extendLock();
  return { key, generation: keyGeneration };
}

/**
 * Call after every await before using the leased key or emitting anything
 * derived from it. Throws if the vault locked in the meantime.
 */
function stillLeased(lease: KeyLease): CryptoKey {
  if (!key || lease.generation !== keyGeneration) {
    throw new Error('the vault locked while this was running, so nothing was returned');
  }
  return lease.key;
}

async function createVault(passphrase: string): Promise<VaultState> {
  // Enforced here rather than only in the panel, because the panel is not the
  // authority and a vault created weak can never be strengthened afterwards
  // without re-encrypting everything.
  const problem = passphraseProblem(passphrase);
  if (problem) throw new Error(problem);
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

async function readContact(lease: KeyLease): Promise<ProfileView['contact']> {
  const row = rows<Record<string, Uint8Array | string | null>>(
    'SELECT email_enc, phone_enc, city_enc, region, country FROM contact WHERE id = 1',
  )[0];
  if (!row) return null;
  const open = async (column: string): Promise<string | null> => {
    const blob = row[column];
    if (!blob || typeof blob === 'string') return null;
    // stillLeased before each decrypt, so a lock landing mid-read stops the
    // next one rather than finishing the set and posting plaintext out.
    return decryptValue(stillLeased(lease), new Uint8Array(blob), 'contact:1', column);
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
  const lease = requireKey();
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
    contact: await readContact(lease),
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
  const lease = requireKey();
  const cv = parseCvMarkdown(markdown);

  // This operation deletes every role, degree and link before inserting. If the
  // text did not parse into anything, that is a wipe with nothing to show for
  // it, so refuse before touching the database. The panel also blocks an empty
  // box, but the panel is not the authority: the same reasoning that puts the
  // passphrase minimum down here applies to the destructive operation.
  if (cv.work.length === 0 && cv.education.length === 0) {
    throw new Error(
      'that does not look like a CV: no experience or education was found, so nothing was changed',
    );
  }

  const t = now();
  // Encrypt BEFORE opening the transaction. An await between BEGIN and COMMIT
  // publishes an open transaction to anything else that runs in the meantime,
  // and the transaction belongs to the connection rather than to this call.
  const seal = async (value: string | null, column: string) =>
    value ? await encryptValue(stillLeased(lease), value, 'contact:1', column) : null;
  const cityEnc = await seal(cv.city, 'city_enc');
  const emailEnc = await seal(cv.email, 'email_enc');
  const phoneEnc = await seal(cv.phone, 'phone_enc');
  stillLeased(lease);

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
              -- COALESCE, not excluded.*: a re-import of a reformatted CV that
              -- happens not to expose a headline must not erase the stored one.
              headline = COALESCE(excluded.headline, profile.headline),
              summary = COALESCE(excluded.summary, profile.summary),
              updated_at = excluded.updated_at`,
      bind: [cv.legalFirst, cv.legalLast, cv.headline, cv.summary, t, t],
    });
    db.exec({
      sql: `INSERT INTO contact (id, city_enc, email_enc, phone_enc, region, country, created_at, updated_at)
            VALUES (1, ?, ?, ?, ?, 'US', ?, ?)
            ON CONFLICT(id) DO UPDATE SET
              city_enc = COALESCE(excluded.city_enc, contact.city_enc),
              email_enc = COALESCE(excluded.email_enc, contact.email_enc),
              phone_enc = COALESCE(excluded.phone_enc, contact.phone_enc),
              region = COALESCE(excluded.region, contact.region),
              updated_at = excluded.updated_at`,
      bind: [cityEnc, emailEnc, phoneEnc, cv.region, t, t],
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
    try {
      db.exec('ROLLBACK');
    } catch {}
    throw err;
  }
  log('import_cv', `${cv.work.length} roles, ${cv.education.length} degrees`);
  return {
    imported: true,
    counts: { work: cv.work.length, education: cv.education.length, links: cv.links.length },
  };
}

/** The single row id the default resume lives under. */
const RESUME_ID = 'resume-default';
/** A resume larger than this is a mistake, not a resume. */
const MAX_RESUME_BYTES = 8 * 1024 * 1024;

const RESUME_TYPES: Readonly<Record<string, string>> = {
  'application/pdf': 'pdf',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document': 'docx',
  'application/msword': 'doc',
  'text/markdown': 'md',
  'text/plain': 'txt',
};

async function setResume(
  filename: string,
  mimeType: string,
  base64: string,
): Promise<{ stored: true; meta: ResumeMeta }> {
  const lease = requireKey();
  if (!RESUME_TYPES[mimeType]) {
    throw new Error(
      `${mimeType || 'that file type'} is not accepted. Use a PDF, a Word document, or plain text.`,
    );
  }
  // Measured on the decoded length, not the base64 length, so the limit means
  // what it says.
  const bytes = Math.floor((base64.length * 3) / 4);
  if (bytes === 0) throw new Error('that file is empty');
  if (bytes > MAX_RESUME_BYTES) {
    throw new Error(`that file is ${Math.round(bytes / 1024 / 1024)} MB; the limit is 8 MB`);
  }
  // The bytes are encrypted as their base64 text rather than as a BLOB. That
  // keeps crypto.ts's surface to the one string-in, string-out door the
  // security doc pins, and the 33% it costs on disk is not worth widening it.
  const enc = await encryptValue(stillLeased(lease), base64, `document:${RESUME_ID}`, 'bytes_enc');
  stillLeased(lease);
  const t = now();
  db.exec({
    sql: `INSERT INTO document (id, kind, filename, mime_type, bytes_enc, is_default, created_at)
          VALUES (?, 'resume', ?, ?, ?, 1, ?)
          ON CONFLICT(id) DO UPDATE SET
            filename = excluded.filename, mime_type = excluded.mime_type,
            bytes_enc = excluded.bytes_enc, created_at = excluded.created_at`,
    bind: [RESUME_ID, filename, mimeType, enc, t],
  });
  log('set_resume', `${filename}, ${bytes} bytes`);
  return { stored: true, meta: { filename, mimeType } };
}

function resumeRow(): { filename: string; mime_type: string; bytes_enc: Uint8Array } | undefined {
  return rows<{ filename: string; mime_type: string; bytes_enc: Uint8Array }>(
    'SELECT filename, mime_type, bytes_enc FROM document WHERE id = ? AND kind = ?',
    [RESUME_ID, 'resume'],
  )[0];
}

async function readResume(lease: KeyLease): Promise<ResumeFile | null> {
  const row = resumeRow();
  if (!row) return null;
  const base64 = await decryptValue(
    stillLeased(lease),
    new Uint8Array(row.bytes_enc),
    `document:${RESUME_ID}`,
    'bytes_enc',
  );
  stillLeased(lease);
  return { filename: row.filename, mimeType: row.mime_type, base64 };
}

/**
 * Everything the fill path is allowed to know, and nothing else.
 *
 * Invariant 2 is enforced here rather than downstream: a sensitive value is
 * not filtered out of this object, it is never put into it. The
 * sensitive_value table is not read by this function at all, so there is no
 * ordering, no flag and no later filter that could go wrong and leak one.
 */
async function readFillValues(): Promise<{ values: FillValues; resume: ResumeFile | null }> {
  const lease = requireKey();
  const values: FillValues = {};
  const put = (kind: keyof FillValues, value: string | null | undefined) => {
    const trimmed = value?.trim();
    if (trimmed) values[kind] = trimmed;
  };

  const p = rows<Record<string, string | null>>(
    'SELECT legal_first, legal_last, preferred_name FROM profile WHERE id = 1',
  )[0];
  if (p) {
    put('given_name', p.legal_first);
    put('family_name', p.legal_last);
    put('preferred_name', p.preferred_name);
    const full = [p.legal_first, p.legal_last].filter(Boolean).join(' ');
    put('full_name', full);
  }

  const c = rows<Record<string, Uint8Array | string | null>>(
    `SELECT email_enc, phone_enc, address_line1_enc, address_line2_enc, city_enc,
            postal_code_enc, region, country FROM contact WHERE id = 1`,
  )[0];
  if (c) {
    const open = async (column: string): Promise<string | null> => {
      const blob = c[column];
      if (!blob || typeof blob === 'string') return null;
      return decryptValue(stillLeased(lease), new Uint8Array(blob), 'contact:1', column);
    };
    put('email', await open('email_enc'));
    put('phone', await open('phone_enc'));
    put('address_line1', await open('address_line1_enc'));
    put('address_line2', await open('address_line2_enc'));
    put('city', await open('city_enc'));
    put('postal_code', await open('postal_code_enc'));
    put('region', c.region as string | null);
    put('country', c.country as string | null);
  }

  // Sort order 0 is the top of the CV, which is the current or most recent
  // role. "Current employer" on a form means that one either way.
  const job = rows<Record<string, string | null>>(
    'SELECT employer, title FROM work_history ORDER BY sort_order LIMIT 1',
  )[0];
  if (job) {
    put('current_employer', job.employer);
    put('current_title', job.title);
  }

  const school = rows<Record<string, string | null>>(
    'SELECT institution, degree, field FROM education ORDER BY sort_order LIMIT 1',
  )[0];
  if (school) {
    put('education_school', school.institution);
    put('education_degree', school.degree);
    put('education_field', school.field);
  }

  for (const link of rows<Record<string, string>>(
    'SELECT kind, url FROM link ORDER BY sort_order',
  )) {
    const kind = String(link.kind).toLowerCase();
    if (kind.includes('linkedin')) put('linkedin_url', link.url);
    else if (kind.includes('github') || kind.includes('gitlab')) put('github_url', link.url);
    else if (!values.portfolio_url) put('portfolio_url', link.url);
  }

  stillLeased(lease);
  return { values, resume: await readResume(lease) };
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
  async fillValues() {
    await openDatabase();
    return readFillValues();
  },
  async setResume({ filename, mimeType, base64 }) {
    await openDatabase();
    return setResume(filename ?? '', mimeType ?? '', base64 ?? '');
  },
  async resumeMeta() {
    await openDatabase();
    // Metadata only. The bytes are read exactly once per fill, by the call
    // that is about to attach them.
    requireKey();
    const row = resumeRow();
    if (!row) return null;
    // Filename and type only. The stored size would have to be derived from
    // the ciphertext length, which is the base64 plus an IV and a tag, so any
    // number shown here would be a plausible-looking lie.
    return { filename: row.filename, mimeType: row.mime_type } satisfies ResumeMeta;
  },
};

/**
 * Commands run one at a time, chained onto this tail.
 *
 * SQLite's oo1 handle is one connection and BEGIN is global state on it, not a
 * per-caller object. Every await inside a handler is a yield point, so without
 * this queue a second command could execute SQL inside the first one's open
 * transaction, and its ROLLBACK would undo work that was never its own.
 *
 * The tail always resolves: a failed command settles its own reply and must not
 * stop the ones behind it.
 */
let queue: Promise<void> = Promise.resolve();

async function run(id: number, cmd: string, payload: Record<string, string>): Promise<void> {
  try {
    const handler = handlers[cmd];
    if (!handler) throw new Error(`unknown command: ${cmd}`);
    self.postMessage({ id, ok: true, value: await handler(payload) });
  } catch (err) {
    self.postMessage({ id, ok: false, error: err instanceof Error ? err.message : String(err) });
  }
}

self.onmessage = (event: MessageEvent) => {
  const { id, cmd, payload } = event.data ?? {};
  queue = queue.then(() => run(id, cmd, payload ?? {}));
};
