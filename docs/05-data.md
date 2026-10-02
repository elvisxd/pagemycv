# Data

## Where it lives

One SQLite database, in the extension's Origin Private File System, reachable
only through the offscreen document's dedicated worker. See
`02-architecture.md` for why that chain is the only one that works.

Nothing is stored anywhere else. No `chrome.storage.sync`, which would put your
CV on Google's servers, which is exactly what this project exists to avoid.

| Store | Used for | Limit |
|---|---|---|
| OPFS via SQLite | Everything that matters | Quota, lifted by `unlimitedStorage` |
| `chrome.storage.local` | The Byte endpoint URL, UI preferences | 10 MB |
| `chrome.storage.session` | Unlock state for the session, in memory only, never on disk | 10 MB |
| `chrome.storage.sync` | **Never used** | — |

## Conventions

- A column ending in `_enc` holds an AES-GCM ciphertext blob, unreadable
  without the vault key, which lives in `chrome.storage.local` rather than in
  this file. See `03-security.md` for what that does and does not buy. Every
  one is encrypted with
  `additionalData = rowId + "." + columnName + "." + schemaVersion`, so a
  ciphertext cannot be moved between rows or columns. See `03-security.md`.
- Low-entropy sensitive columns are padded to a fixed block before encryption,
  because ciphertext length otherwise reveals the value.
- Every table carries `created_at` and `updated_at` as Unix epoch seconds.
- Nothing is ever hard-deleted from `application` or `event_log`. A rejected
  application you cannot find is an employer you write to twice.
- Identifiers are text UUIDs, because rows sync to nothing and an integer buys
  you nothing.

## Schema

```sql
-- ─── vault ────────────────────────────────────────────────────────────────
-- One row. Holds the key-derivation parameters and a verifier, never the key.
CREATE TABLE vault (
  id              INTEGER PRIMARY KEY CHECK (id = 1),
  kdf             TEXT    NOT NULL DEFAULT 'argon2id',
  kdf_params      TEXT    NOT NULL DEFAULT '{"m":19456,"t":2,"p":1}',
  salt            BLOB    NOT NULL,
  verifier_enc    BLOB    NOT NULL,   -- a known plaintext, encrypted
  created_at      INTEGER NOT NULL,
  updated_at      INTEGER NOT NULL
);

-- ─── profile ──────────────────────────────────────────────────────────────
-- One row. The non-sensitive identity that goes on every application.
CREATE TABLE profile (
  id              INTEGER PRIMARY KEY CHECK (id = 1),
  legal_first     TEXT    NOT NULL,
  legal_last      TEXT    NOT NULL,
  preferred_name  TEXT,
  headline        TEXT,               -- "Senior Full-Stack Engineer"
  summary         TEXT,               -- the profile paragraph from cv.md
  locale          TEXT    NOT NULL DEFAULT 'en-US',
  created_at      INTEGER NOT NULL,
  updated_at      INTEGER NOT NULL
);

-- ─── contact ──────────────────────────────────────────────────────────────
-- Encrypted, because an address plus a phone number is the leak that matters.
CREATE TABLE contact (
  id              INTEGER PRIMARY KEY CHECK (id = 1),
  email_enc       BLOB    NOT NULL,
  phone_enc       BLOB,
  address_line1_enc BLOB,
  address_line2_enc BLOB,
  city_enc        BLOB,
  region          TEXT,               -- state, not encrypted: it is on your CV
  postal_code_enc BLOB,
  country         TEXT    NOT NULL DEFAULT 'US',
  created_at      INTEGER NOT NULL,
  updated_at      INTEGER NOT NULL
);

-- ─── work_history ─────────────────────────────────────────────────────────
CREATE TABLE work_history (
  id              TEXT    PRIMARY KEY,
  employer        TEXT    NOT NULL,
  title           TEXT    NOT NULL,
  location        TEXT,
  is_remote       INTEGER NOT NULL DEFAULT 0,
  started_on      TEXT    NOT NULL,   -- ISO 8601, month precision is fine
  ended_on        TEXT,               -- NULL means current
  description     TEXT,
  sort_order      INTEGER NOT NULL,
  created_at      INTEGER NOT NULL,
  updated_at      INTEGER NOT NULL
);

-- ─── education ────────────────────────────────────────────────────────────
CREATE TABLE education (
  id              TEXT    PRIMARY KEY,
  institution     TEXT    NOT NULL,
  degree          TEXT,
  field           TEXT,
  started_on      TEXT,
  ended_on        TEXT,
  sort_order      INTEGER NOT NULL,
  created_at      INTEGER NOT NULL,
  updated_at      INTEGER NOT NULL
);

-- ─── link ─────────────────────────────────────────────────────────────────
CREATE TABLE link (
  id              TEXT    PRIMARY KEY,
  kind            TEXT    NOT NULL,   -- linkedin | github | portfolio | other
  url             TEXT    NOT NULL,
  sort_order      INTEGER NOT NULL
);

-- ─── document ─────────────────────────────────────────────────────────────
-- The files attached to applications, stored so a file input can be fed
-- offline. One row per kind — `resume`, `cover_letter` — replaced on upload;
-- the ids are `<kind>-default`. A PDF or Word CV imported through the panel
-- becomes the `resume` row too, if none was stored yet.
CREATE TABLE document (
  id              TEXT    PRIMARY KEY,
  kind            TEXT    NOT NULL,   -- resume | cover_letter | portfolio
  filename        TEXT    NOT NULL,
  mime_type       TEXT    NOT NULL,
  bytes_enc       BLOB    NOT NULL,
  is_default      INTEGER NOT NULL DEFAULT 0,
  created_at      INTEGER NOT NULL
);

-- ─── sensitive_value ──────────────────────────────────────────────────────
-- Always encrypted. NEVER auto-filled. Offered one field at a time, with
-- `reason` shown to you before anything is written.
CREATE TABLE sensitive_value (
  id              TEXT    PRIMARY KEY,
  category        TEXT    NOT NULL,   -- see 03-security.md for the six categories
  key             TEXT    NOT NULL UNIQUE,
  value_enc       BLOB    NOT NULL,
  reason          TEXT    NOT NULL,   -- why this is worth thinking about
  never_offer     INTEGER NOT NULL DEFAULT 0,
  created_at      INTEGER NOT NULL,
  updated_at      INTEGER NOT NULL
);

-- ─── answer ───────────────────────────────────────────────────────────────
-- Reusable free text, keyed by a normalized fingerprint of the question, so
-- "Why do you want to work here?" matches across employers.
CREATE TABLE answer (
  id              TEXT    PRIMARY KEY,
  fingerprint     TEXT    NOT NULL,
  question_text   TEXT    NOT NULL,
  body            TEXT    NOT NULL,
  source          TEXT    NOT NULL,   -- typed | byte | edited
  times_used      INTEGER NOT NULL DEFAULT 0,
  last_used_at    INTEGER,
  created_at      INTEGER NOT NULL,
  updated_at      INTEGER NOT NULL
);
CREATE INDEX idx_answer_fingerprint ON answer (fingerprint);

-- ─── application ──────────────────────────────────────────────────────────
-- One row per application. Never deleted.
CREATE TABLE application (
  id              TEXT    PRIMARY KEY,
  url             TEXT    NOT NULL,
  ats             TEXT,               -- lever | greenhouse | ashby | workday | unknown
  company         TEXT,
  role            TEXT,
  status          TEXT    NOT NULL DEFAULT 'filled',
                                      -- filled | submitted | rejected | interview | offer | withdrawn
  filled_at       INTEGER NOT NULL,
  submitted_at    INTEGER,
  notes           TEXT,
  created_at      INTEGER NOT NULL,
  updated_at      INTEGER NOT NULL
);
CREATE INDEX idx_application_status ON application (status, filled_at DESC);

-- ─── filled_field ─────────────────────────────────────────────────────────
-- The audit trail: what was written, where the value came from, and how it
-- was matched. This is what lets you answer "why did it type that?"
CREATE TABLE filled_field (
  id              TEXT    PRIMARY KEY,
  application_id  TEXT    NOT NULL REFERENCES application (id),
  field_label     TEXT,
  field_selector  TEXT    NOT NULL,
  match_strategy  TEXT    NOT NULL,   -- autocomplete | label | ats_map | manual
  confidence      REAL    NOT NULL,
  source_table    TEXT,               -- profile | contact | answer | ...
  source_id       TEXT,
  was_sensitive   INTEGER NOT NULL DEFAULT 0,
  was_confirmed   INTEGER NOT NULL DEFAULT 0,
  filled_at       INTEGER NOT NULL
);
CREATE INDEX idx_filled_field_application ON filled_field (application_id);

-- ─── skipped_field ────────────────────────────────────────────────────────
-- Everything deliberately NOT written, and why. A honeypot that was correctly
-- skipped must be visible, otherwise you cannot tell the denylist still works.
CREATE TABLE skipped_field (
  id              TEXT    PRIMARY KEY,
  application_id  TEXT    NOT NULL REFERENCES application (id),
  field_selector  TEXT    NOT NULL,
  reason          TEXT    NOT NULL,   -- honeypot | hidden | sensitive | unresolved | declined
  skipped_at      INTEGER NOT NULL
);

-- ─── event_log ────────────────────────────────────────────────────────────
-- Append only. Never deleted, never edited.
CREATE TABLE event_log (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  at              INTEGER NOT NULL,
  kind            TEXT    NOT NULL,   -- unlock | lock | fill | confirm | decline | export | byte_call
  detail          TEXT,
  application_id  TEXT
);
```

## The question fingerprint

Free-text questions are the same question wearing different clothes. "Why do you
want to work at Acme?" and "What interests you about this role at Acme?" should
find the same stored answer.

The fingerprint is computed in packaged code, never by a model, for the same
reason Byte computes job scores in code: a value that changes between runs cannot
be reviewed.

1. Lowercase, strip punctuation and collapse whitespace
2. Remove the company and role names, which are already columns on `application`
3. Drop a stopword list
4. Sort the remaining tokens and hash them

Exact matches offer the stored answer directly. Near matches offer it as a
starting point, marked as such. Nothing is written without you accepting it.

## Migrations

Plain numbered SQL files run inside one transaction, tracked by
`PRAGMA user_version`. No ORM and no migration framework. There is one database,
on one machine, with one writer.

```
src/db/migrations/
  001_initial.sql
  002_add_skipped_field.sql
```

## Backup and portability

A real requirement, not a nice-to-have: OPFS data is tied to one browser
profile on one machine, and removing the extension deletes both the database
and the key that opens it.

**Built.** The side panel's *Backup* section exports everything a person
entered to `pagemycv-backup-YYYY-MM-DD.json` and restores it — into the same
browser or a brand-new one. The format and its validator are
`src/backup/format.ts`; the worker's `exportBackup` and `importBackup` do the
reading and writing.

- **The file is not encrypted.** This reverses what this section said the day
  before, and the reason is something found while building it: **no code sets
  a sensitive value.** `sensitive_value` is seeded empty when a vault is
  created and nothing ever writes `value_enc`. So what a backup can hold today
  is the CV, the résumé file and the screening answers — roughly what gets sent
  to employers anyway. A passphrase on the file would buy little for that, and
  would turn a forgotten passphrase into a lost backup, which is the exact
  failure a backup exists to prevent. Decided with Elvis, not by default.
- **That reasoning expires.** The day sensitive values become settable, an
  unencrypted backup must not carry them. `tests/unit/backup-coverage.test.ts`
  fails as soon as the worker gains an `UPDATE sensitive_value`, with a
  message that says to redesign the backup before adding them to it.
- **Every table has a decision.** The same test fails if a migration adds a
  table that is neither in `BACKED_UP_TABLES` nor in `NOT_BACKED_UP` with a
  reason, or if a table excluded as "nothing writes it yet" starts being
  written. A backup that silently forgets a table restores "successfully" and
  the loss is found weeks later.
- **Restore replaces, it does not merge.** A merge has no answer for "the
  backup has no résumé and the vault does". After a restore the vault is
  exactly the file, in one transaction, all or nothing.
- **A damaged file is refused before anything is touched**, naming the field.
  A restore that guessed at a damaged file would replace a good vault with a
  guess. Unknown screening questions are refused too, and a backup from a
  newer PageMyCV says so rather than calling itself damaged.
- **The résumé passes the same rules as an upload** — type allowlist, 8 MB —
  because a backup file is just another way in. So does the cover letter file.
- **The cover letter travels twice**: as the `cover_letter` screening answer
  (text) and as `coverLetter` (the file). The file field was added after
  version 1 shipped, as an **optional** field rather than a version 2: a file
  written before it existed simply has no cover letter, and refusing it would
  turn last week's backup into one that "needs updating" for nothing.
- The key does not travel. A restore goes into whichever vault is open and is
  sealed again under its key.
- The export is never uploaded anywhere by the extension. It is saved from the
  panel's own page as a blob link, which needs no permission; `chrome.downloads`
  stays refused by the guard.
