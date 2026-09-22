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
| `chrome.storage.session` | Unlock state for the session, in memory only | 10 MB |
| `chrome.storage.sync` | **Never used** | — |

## Conventions

- A column ending in `_enc` holds an AES-GCM ciphertext blob. Never readable
  without the passphrase.
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
  kdf             TEXT    NOT NULL DEFAULT 'PBKDF2-HMAC-SHA256',
  iterations      INTEGER NOT NULL DEFAULT 600000,
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
-- The CV PDF itself, stored as a blob so the file input can be fed offline.
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

An encrypted export is a real requirement, not a nice-to-have: OPFS data is
tied to one browser profile on one machine, and losing it means retyping your
entire history.

- **Export** writes a single file containing the ciphertext columns as they are,
  plus the vault's salt and parameters. The passphrase is still required to read
  it. Exporting is logged to `event_log`.
- **Import** into a fresh install restores everything with the same passphrase.
- The export is never uploaded anywhere by the extension. You move the file.
