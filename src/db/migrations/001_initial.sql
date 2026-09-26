-- Columns ending in _enc hold iv ‖ ciphertext ‖ tag, encrypted with AAD bound
-- to rowId.columnName.schemaVersion. See docs/03-security.md and 05-data.md.

CREATE TABLE vault (
  id              INTEGER PRIMARY KEY CHECK (id = 1),
  kdf             TEXT    NOT NULL DEFAULT 'argon2id',
  kdf_params      TEXT    NOT NULL DEFAULT '{"m":19456,"t":2,"p":1}',
  salt            BLOB    NOT NULL,
  verifier_enc    BLOB    NOT NULL,
  created_at      INTEGER NOT NULL,
  updated_at      INTEGER NOT NULL
);

CREATE TABLE profile (
  id              INTEGER PRIMARY KEY CHECK (id = 1),
  legal_first     TEXT    NOT NULL,
  legal_last      TEXT    NOT NULL,
  preferred_name  TEXT,
  headline        TEXT,
  summary         TEXT,
  locale          TEXT    NOT NULL DEFAULT 'en-US',
  created_at      INTEGER NOT NULL,
  updated_at      INTEGER NOT NULL
);

CREATE TABLE contact (
  id                INTEGER PRIMARY KEY CHECK (id = 1),
  email_enc         BLOB,
  phone_enc         BLOB,
  address_line1_enc BLOB,
  address_line2_enc BLOB,
  city_enc          BLOB,
  region            TEXT,
  postal_code_enc   BLOB,
  country           TEXT    NOT NULL DEFAULT 'US',
  created_at        INTEGER NOT NULL,
  updated_at        INTEGER NOT NULL
);

CREATE TABLE work_history (
  id              TEXT    PRIMARY KEY,
  employer        TEXT    NOT NULL,
  title           TEXT    NOT NULL,
  location        TEXT,
  is_remote       INTEGER NOT NULL DEFAULT 0,
  started_on      TEXT    NOT NULL,
  ended_on        TEXT,
  description     TEXT,
  sort_order      INTEGER NOT NULL,
  created_at      INTEGER NOT NULL,
  updated_at      INTEGER NOT NULL
);

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

CREATE TABLE link (
  id              TEXT    PRIMARY KEY,
  kind            TEXT    NOT NULL,
  url             TEXT    NOT NULL,
  sort_order      INTEGER NOT NULL
);

CREATE TABLE document (
  id              TEXT    PRIMARY KEY,
  kind            TEXT    NOT NULL,
  filename        TEXT    NOT NULL,
  mime_type       TEXT    NOT NULL,
  bytes_enc       BLOB    NOT NULL,
  is_default      INTEGER NOT NULL DEFAULT 0,
  created_at      INTEGER NOT NULL
);

-- Always encrypted, always padded, NEVER auto-filled.
CREATE TABLE sensitive_value (
  id              TEXT    PRIMARY KEY,
  category        TEXT    NOT NULL,
  key             TEXT    NOT NULL UNIQUE,
  label           TEXT    NOT NULL,
  value_enc       BLOB,
  reason          TEXT    NOT NULL,
  never_offer     INTEGER NOT NULL DEFAULT 0,
  created_at      INTEGER NOT NULL,
  updated_at      INTEGER NOT NULL
);

CREATE TABLE answer (
  id              TEXT    PRIMARY KEY,
  fingerprint     TEXT    NOT NULL,
  question_text   TEXT    NOT NULL,
  body            TEXT    NOT NULL,
  source          TEXT    NOT NULL,
  times_used      INTEGER NOT NULL DEFAULT 0,
  last_used_at    INTEGER,
  created_at      INTEGER NOT NULL,
  updated_at      INTEGER NOT NULL
);
CREATE INDEX idx_answer_fingerprint ON answer (fingerprint);

CREATE TABLE application (
  id              TEXT    PRIMARY KEY,
  url             TEXT    NOT NULL,
  ats             TEXT,
  company         TEXT,
  role            TEXT,
  status          TEXT    NOT NULL DEFAULT 'filled',
  filled_at       INTEGER NOT NULL,
  submitted_at    INTEGER,
  notes           TEXT,
  created_at      INTEGER NOT NULL,
  updated_at      INTEGER NOT NULL
);
CREATE INDEX idx_application_status ON application (status, filled_at DESC);

CREATE TABLE filled_field (
  id              TEXT    PRIMARY KEY,
  application_id  TEXT    NOT NULL REFERENCES application (id),
  field_label     TEXT,
  field_selector  TEXT    NOT NULL,
  match_strategy  TEXT    NOT NULL,
  confidence      REAL    NOT NULL,
  source_table    TEXT,
  source_id       TEXT,
  was_sensitive   INTEGER NOT NULL DEFAULT 0,
  was_confirmed   INTEGER NOT NULL DEFAULT 0,
  filled_at       INTEGER NOT NULL
);
CREATE INDEX idx_filled_field_application ON filled_field (application_id);

-- A honeypot correctly skipped must be visible, or you cannot tell the
-- denylist still works.
CREATE TABLE skipped_field (
  id              TEXT    PRIMARY KEY,
  application_id  TEXT    NOT NULL REFERENCES application (id),
  field_selector  TEXT    NOT NULL,
  reason          TEXT    NOT NULL,
  skipped_at      INTEGER NOT NULL
);

CREATE TABLE event_log (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  at              INTEGER NOT NULL,
  kind            TEXT    NOT NULL,
  detail          TEXT,
  application_id  TEXT
);
