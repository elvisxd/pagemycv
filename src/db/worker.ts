/// <reference lib="webworker" />
// The ONLY module that touches SQLite, and the only place the vault key exists.
//
// It runs in a dedicated worker because that is the single context where
// FileSystemFileHandle.createSyncAccessHandle is exposed. The service worker
// cannot host this: it has neither that API nor the Worker constructor needed
// to delegate. Both were confirmed in a real browser, see spikes/phase-0.
import sqlite3InitModule from '@sqlite.org/sqlite-wasm';
import type { FieldKind, FillValues, ResumeFile, ScreeningAnswers } from '../fill/types';
import { SCREENING_KINDS } from '../fill/types';
import { parseCvMarkdown } from '../import/cv-markdown';
import { SENSITIVE_FIELDS } from '../sensitive/registry';
import { fromBase64, toBase64 } from '../util/base64';
import {
  checkVerifier,
  decryptValue,
  encryptValue,
  importKeyMaterial,
  makeVerifier,
  randomSalt,
} from '../vault/crypto';
import INITIAL_SQL from './migrations/001_initial.sql?raw';
import SCREENING_SQL from './migrations/002_screening_answers.sql?raw';
import type { ProfileView, ResumeMeta, VaultState } from './schema';

const DB_PATH = '/pagemycv.sqlite3';
const POOL_NAME = 'pagemycv';

/** What the `kdf` column says for a vault with no passphrase behind it. */
const KDF_RANDOM = 'random';

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
/**
 * Null until the offscreen document hands the material over.
 *
 * This worker cannot fetch it: `chrome` is undefined here, measured rather
 * than assumed (spikes/phase-5). So the window between the worker starting
 * and being given the key is real, and every read has to cope with it.
 */
let key: CryptoKey | null = null;

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

/**
 * Ordered, and applied in order from whatever version the file is at.
 *
 * A list rather than the single hardcoded step this used to be, because 002
 * is the first schema change to meet a vault that already holds somebody's
 * CV. Each step runs in its own transaction and sets the version inside it,
 * so a failure half way leaves the file at the last version that fully
 * applied rather than at a version whose tables do not all exist.
 */
const MIGRATIONS: readonly { version: number; sql: string }[] = [
  { version: 1, sql: INITIAL_SQL },
  { version: 2, sql: SCREENING_SQL },
];

const LATEST = MIGRATIONS[MIGRATIONS.length - 1]?.version ?? 0;

function migrate(handle: Db): void {
  const version = handle.selectValue('PRAGMA user_version') as number;
  if (version > LATEST) {
    throw new Error(`this vault was written by a newer version (schema ${version})`);
  }
  for (const step of MIGRATIONS) {
    if (version >= step.version) continue;
    // The version is an integer from the literal list above and never from
    // anything a page or a file could influence, which is what makes the
    // interpolation below safe. Asserted rather than assumed.
    if (!Number.isInteger(step.version)) throw new Error('migration version must be an integer');
    handle.exec('BEGIN');
    try {
      handle.exec(step.sql);
      handle.exec(`PRAGMA user_version = ${step.version}`);
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

function state(): VaultState {
  // Never report a database we could not open as an absent vault. That path
  // creates one, and creating over an existing vault is data loss.
  if (!db) return { status: 'unavailable', problem: 'the database could not be opened' };
  const hasVault = (db.selectValue('SELECT count(*) FROM vault') as number) > 0;
  if (!hasVault) return { status: 'absent' };
  if (key) return { status: 'unlocked' };
  // A vault exists but this worker has not been given its key. Which screen
  // that means depends on why, and only the kdf column knows: a vault made
  // from a passphrase has key material nobody has stored yet.
  const kdf = db.selectValue('SELECT kdf FROM vault WHERE id = 1') as string;
  return kdf === KDF_RANDOM ? { status: 'opening' } : { status: 'needs_passphrase' };
}

function requireKey(): CryptoKey {
  if (!key) throw new Error('the vault is not open yet');
  return key;
}

async function createVault(material: Uint8Array): Promise<VaultState> {
  await openDatabase();
  if ((db.selectValue('SELECT count(*) FROM vault') as number) > 0) {
    throw new Error('a vault already exists');
  }
  // Kept NOT NULL and kept random even though nothing derives from it. A
  // vault converted from a passphrase still needs its original salt to stay
  // meaningful, so the column cannot become "unused" for one kind and
  // load-bearing for the other without the rows lying about which is which.
  const salt = randomSalt();
  const derived = await importKeyMaterial(material);
  const verifier = await makeVerifier(derived);
  const t = now();
  db.exec({
    sql: `INSERT INTO vault (id, kdf, kdf_params, salt, verifier_enc, created_at, updated_at)
          VALUES (1, ?, ?, ?, ?, ?, ?)`,
    bind: [KDF_RANDOM, '{}', salt, verifier, t, t],
  });
  for (const f of SENSITIVE_FIELDS) {
    db.exec({
      sql: `INSERT INTO sensitive_value (id, category, key, label, value_enc, reason, created_at, updated_at)
            VALUES (?, ?, ?, ?, NULL, ?, ?, ?)`,
      bind: [uid(), f.category, f.key, f.label, f.reason, t, t],
    });
  }
  key = derived;
  log('create');
  return state();
}

/**
 * Take the key material the offscreen document is holding.
 *
 * Checked against the verifier rather than trusted. Adopting the wrong key
 * would not fail here — AES-GCM only complains when something is decrypted —
 * so the first symptom would be every field reading as an error, long after
 * the cause, and a create-over-the-top would look like the fix.
 */
async function openVault(material: Uint8Array): Promise<VaultState> {
  await openDatabase();
  const row = rows<{ verifier_enc: Uint8Array }>('SELECT verifier_enc FROM vault WHERE id = 1')[0];
  if (!row) throw new Error('no vault to open');
  const candidate = await importKeyMaterial(material);
  if (!(await checkVerifier(candidate, new Uint8Array(row.verifier_enc)))) {
    log('open_failed');
    throw new Error('the stored key does not open this vault');
  }
  key = candidate;
  log('open');
  return state();
}

/** The salt an existing passphrase vault was created with. Not a secret. */
async function vaultSalt(): Promise<Uint8Array> {
  await openDatabase();
  const row = rows<{ salt: Uint8Array }>('SELECT salt FROM vault WHERE id = 1')[0];
  if (!row) throw new Error('no vault');
  return new Uint8Array(row.salt);
}

/**
 * Record that this vault no longer has a passphrase behind it.
 *
 * Called only after the derived material has been verified AND stored. The
 * data is not re-encrypted: it is the same key either way, so there is no
 * half-converted state to recover from. Only the label changes, and it
 * changes last, so a crash anywhere before this leaves a vault that still
 * asks for the passphrase rather than one that asks for nothing and cannot
 * open.
 */
function markConverted(): void {
  db.exec({
    sql: 'UPDATE vault SET kdf = ?, kdf_params = ?, updated_at = ? WHERE id = 1',
    bind: [KDF_RANDOM, '{}', now()],
  });
  log('converted');
}

async function readContact(vaultKey: CryptoKey): Promise<ProfileView['contact']> {
  const row = rows<Record<string, Uint8Array | string | null>>(
    'SELECT email_enc, phone_enc, city_enc, region, country FROM contact WHERE id = 1',
  )[0];
  if (!row) return null;
  const open = async (column: string): Promise<string | null> => {
    const blob = row[column];
    if (!blob || typeof blob === 'string') return null;
    // The key is passed in rather than re-read, so one read cannot see two
    // next one rather than finishing the set and posting plaintext out.
    return decryptValue(vaultKey, new Uint8Array(blob), 'contact:1', column);
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
  const vaultKey = requireKey();
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
    contact: await readContact(vaultKey),
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
  const vaultKey = requireKey();
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
    value ? await encryptValue(vaultKey, value, 'contact:1', column) : null;
  const cityEnc = await seal(cv.city, 'city_enc');
  const emailEnc = await seal(cv.email, 'email_enc');
  const phoneEnc = await seal(cv.phone, 'phone_enc');

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
  const vaultKey = requireKey();
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
  const enc = await encryptValue(vaultKey, base64, `document:${RESUME_ID}`, 'bytes_enc');
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

async function readResume(vaultKey: CryptoKey): Promise<ResumeFile | null> {
  const row = resumeRow();
  if (!row) return null;
  const base64 = await decryptValue(
    vaultKey,
    new Uint8Array(row.bytes_enc),
    `document:${RESUME_ID}`,
    'bytes_enc',
  );
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
  const vaultKey = requireKey();
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
      return decryptValue(vaultKey, new Uint8Array(blob), 'contact:1', column);
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

  return { values, resume: await readResume(vaultKey) };
}

/**
 * Your own answers to the screening questions.
 *
 * Each row is keyed by field kind, and the AAD binds the ciphertext to that
 * kind and that column, so an answer moved to another row stops decrypting —
 * the same guarantee every other personal column has. A decryption that
 * fails is skipped rather than thrown: one unreadable answer should leave
 * the rest of a fill working.
 */
async function readScreeningAnswers(): Promise<ScreeningAnswers> {
  const vaultKey = requireKey();
  const out: ScreeningAnswers = {};
  for (const row of rows<{ kind: string; answer_enc: Uint8Array }>(
    'SELECT kind, answer_enc FROM screening_answer',
  )) {
    if (!SCREENING_KINDS.includes(row.kind as FieldKind)) continue;
    try {
      out[row.kind as FieldKind] = await decryptValue(
        vaultKey,
        new Uint8Array(row.answer_enc),
        `screening:${row.kind}`,
        'answer_enc',
      );
    } catch {}
  }
  return out;
}

async function setScreeningAnswer(kind: string, answer: string): Promise<{ saved: true }> {
  const vaultKey = requireKey();
  // The kind has to be one we know. A row keyed by anything else could never
  // be read back by the fill path, so storing it would be a silent no-op
  // that looks like it worked.
  if (!SCREENING_KINDS.includes(kind as FieldKind)) {
    throw new Error(`${kind} is not a screening question`);
  }
  const trimmed = answer.trim();
  const t = Date.now();
  if (!trimmed) {
    // Clearing is deleting. An empty ciphertext would still be a stored
    // answer as far as the planner is concerned.
    db?.exec({ sql: 'DELETE FROM screening_answer WHERE kind = ?', bind: [kind] });
    return { saved: true };
  }
  const enc = await encryptValue(vaultKey, trimmed, `screening:${kind}`, 'answer_enc');
  db?.exec({
    sql: `INSERT INTO screening_answer (kind, answer_enc, updated_at) VALUES (?, ?, ?)
          ON CONFLICT(kind) DO UPDATE SET
            answer_enc = excluded.answer_enc,
            updated_at = excluded.updated_at`,
    bind: [kind, enc, t],
  });
  return { saved: true };
}

const handlers: Record<string, (payload: Record<string, string>) => Promise<unknown>> = {
  async state() {
    await openDatabase();
    return state();
  },
  async create({ material }) {
    return createVault(fromBase64(material ?? ''));
  },
  async open({ material }) {
    return openVault(fromBase64(material ?? ''));
  },
  async salt() {
    return toBase64(await vaultSalt());
  },
  async markConverted() {
    await openDatabase();
    markConverted();
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
  async fillValues() {
    await openDatabase();
    return readFillValues();
  },
  async screeningAnswers() {
    await openDatabase();
    return readScreeningAnswers();
  },
  async setScreeningAnswer({ kind, answer }) {
    await openDatabase();
    return setScreeningAnswer(kind ?? '', answer ?? '');
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
