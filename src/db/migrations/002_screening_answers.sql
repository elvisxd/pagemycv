-- Your own answers to the questions every application asks and no CV holds.
--
-- Separate from `answer`, which Phase 5 owns: that one is keyed by a
-- question's fingerprint and stores a generated draft you accepted for THAT
-- question. This one is keyed by field kind and stores a fact about you that
-- recurs on every form — how much notice you owe, whether you will travel.
--
-- Keyed by kind rather than by a generated id, because there is exactly one
-- current answer per kind and an UPSERT is the whole write path.
--
-- `answer_enc` is a BLOB for the same reason every other personal column is:
-- the AAD binds it to this row and this column, so a ciphertext moved
-- anywhere else stops decrypting. `answer.body` in the initial migration is
-- plaintext TEXT; that is Phase 5's to answer for, not this table's.
CREATE TABLE screening_answer (
  kind        TEXT    PRIMARY KEY,
  answer_enc  BLOB    NOT NULL,
  updated_at  INTEGER NOT NULL
);
