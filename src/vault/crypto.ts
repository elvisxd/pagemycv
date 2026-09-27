// The only module in the codebase that touches crypto.subtle or Argon2.
//
// Everything here follows docs/03-security.md. The two rules that are easy to
// break by accident and expensive to break in production:
//
//   1. Every encryption is bound to its position with AAD. Without it, all
//      columns share one key, so any ciphertext decrypts in any column and an
//      attacker with file access can relocate a visa status into another row.
//   2. Raw key material leaves this module in exactly one direction: out of
//      newKeyMaterial and deriveKeyMaterial, into the one module allowed to
//      persist it. It is never read back out of a CryptoKey — importKey is
//      called with extractable: false and exportKey is banned by the guard —
//      so a key in use cannot be turned back into bytes by any caller.
import { argon2id } from 'hash-wasm';

/** Bumped only when the meaning of a stored column changes. Part of the AAD. */
export const SCHEMA_VERSION = 1;

/** OWASP's current Argon2id configuration: 19 MiB, two passes, no parallelism. */
export const KDF = { memorySize: 19456, iterations: 2, parallelism: 1, hashLength: 32 } as const;

export const KDF_ID = 'argon2id';
const IV_BYTES = 12;
const SALT_BYTES = 16;

/** Low-entropy values are padded so ciphertext length stops revealing them. */
export const PAD_BLOCK = 64;

/** AES-256. The length of the key the vault is encrypted with. */
export const KEY_BYTES = 32;

const enc = new TextEncoder();

/** WebCrypto wants a view over a plain ArrayBuffer, never a shared one. */
const own = (v: Uint8Array): Uint8Array<ArrayBuffer> =>
  new Uint8Array(v) as Uint8Array<ArrayBuffer>;
const dec = new TextDecoder();

export function randomSalt(): Uint8Array<ArrayBuffer> {
  return crypto.getRandomValues(new Uint8Array(SALT_BYTES));
}

/**
 * A fresh vault key, from the CSPRNG rather than from anything a person typed.
 *
 * There is no passphrase, so there is no low-entropy input to stretch and
 * nothing for Argon2id to do: 32 random bytes are already beyond brute force.
 * What replaces the passphrase is not a weaker secret, it is no secret at all
 * — see docs/03-security.md for what that costs and what it still buys.
 */
export function newKeyMaterial(): Uint8Array<ArrayBuffer> {
  return crypto.getRandomValues(new Uint8Array(KEY_BYTES));
}

/**
 * Turn stored bytes into the key the vault is read and written with.
 *
 * `async` so the length check REJECTS rather than throwing synchronously. A
 * Promise-returning function that throws before it returns one escapes every
 * .catch() its caller wrote, which here would take down the offscreen
 * document's open instead of reporting a corrupt stored key.
 */
export async function importKeyMaterial(material: Uint8Array): Promise<CryptoKey> {
  if (material.length !== KEY_BYTES) {
    throw new Error(`the vault key must be ${KEY_BYTES} bytes, got ${material.length}`);
  }
  // extractable: false. It is obfuscation rather than a boundary, but it stops
  // the raw bytes ever reaching a log or a serialized state object by accident.
  return crypto.subtle.importKey('raw', own(material), 'AES-GCM', false, ['encrypt', 'decrypt']);
}

/**
 * The key material an existing passphrase vault is already encrypted under.
 *
 * Only the one-time conversion calls this. It returns bytes rather than a
 * CryptoKey precisely because those bytes have to be stored: converting by
 * re-encrypting every column under a new key would be a migration that can
 * half-finish, and this cannot — the same key keeps working either way.
 */
export async function deriveKeyMaterial(
  passphrase: string,
  salt: Uint8Array,
): Promise<Uint8Array<ArrayBuffer>> {
  const raw = await argon2id({
    // Normalize first. "contraseña" typed on macOS often arrives decomposed
    // (n + combining tilde) and on Linux or Windows composed (ñ). Those are
    // different byte sequences, so Argon2id derives different keys from what
    // the user believes is one passphrase: the vault opens on the machine that
    // created it and reports "wrong passphrase" everywhere else, with no
    // recovery because the key is never stored. NFC is the composed form.
    password: passphrase.normalize('NFC'),
    salt,
    ...KDF,
    outputType: 'binary',
  });
  return own(raw as Uint8Array);
}

/**
 * Binds a ciphertext to exactly one place in the database. Passed as AES-GCM
 * additional authenticated data on both encrypt and decrypt, so a ciphertext
 * moved to another row or column fails to authenticate.
 */
export function aad(
  rowId: string,
  column: string,
  version = SCHEMA_VERSION,
  padded = false,
): Uint8Array<ArrayBuffer> {
  return enc.encode(JSON.stringify([rowId, column, version, padded]));
}

function pad(bytes: Uint8Array, block: number): Uint8Array<ArrayBuffer> {
  if (bytes.length > 0xffff) throw new Error('value too long to pad');
  const total = Math.ceil((bytes.length + 2) / block) * block;
  const out = new Uint8Array(total);
  out[0] = (bytes.length >> 8) & 0xff;
  out[1] = bytes.length & 0xff;
  out.set(bytes, 2);
  return out;
}

function unpad(padded: Uint8Array): Uint8Array<ArrayBuffer> {
  const len = ((padded[0] ?? 0) << 8) | (padded[1] ?? 0);
  // Without this, reading an unpadded blob as padded silently returns a slice
  // of the plaintext rather than failing: 'hello' comes back as 'llo'. The AAD
  // now makes that mismatch fail authentication first, and this is the second
  // line of defence for a blob that was corrupted rather than mislabelled.
  if (len > padded.length - 2) {
    throw new Error('padded value is malformed: the declared length exceeds the block');
  }
  return padded.slice(2, 2 + len);
}

export interface EncryptOptions {
  /** Pad to a fixed block first. Use for columns with few possible values. */
  padded?: boolean;
}

/** Returns iv ‖ ciphertext ‖ tag as one blob, ready for a BLOB column. */
export async function encryptValue(
  key: CryptoKey,
  plaintext: string,
  rowId: string,
  column: string,
  opts: EncryptOptions = {},
): Promise<Uint8Array<ArrayBuffer>> {
  const iv = crypto.getRandomValues(new Uint8Array(IV_BYTES));
  const body = opts.padded ? pad(enc.encode(plaintext), PAD_BLOCK) : enc.encode(plaintext);
  const ct = new Uint8Array(
    await crypto.subtle.encrypt(
      { name: 'AES-GCM', iv, additionalData: aad(rowId, column, SCHEMA_VERSION, !!opts.padded) },
      key,
      own(body),
    ),
  );
  const out = new Uint8Array(iv.length + ct.length);
  out.set(iv, 0);
  out.set(ct, iv.length);
  return out;
}

/** Throws if the blob has been moved to a different row or column. */
export async function decryptValue(
  key: CryptoKey,
  blob: Uint8Array,
  rowId: string,
  column: string,
  opts: EncryptOptions = {},
): Promise<string> {
  const iv = blob.slice(0, IV_BYTES);
  const ct = blob.slice(IV_BYTES);
  const plain = new Uint8Array(
    await crypto.subtle.decrypt(
      { name: 'AES-GCM', iv, additionalData: aad(rowId, column, SCHEMA_VERSION, !!opts.padded) },
      key,
      own(ct),
    ),
  );
  return dec.decode(opts.padded ? unpad(plain) : plain);
}

const VERIFIER_TEXT = 'pagemycv.vault.v1';
const VERIFIER_ROW = 'vault';
const VERIFIER_COL = 'verifier';

export function makeVerifier(key: CryptoKey): Promise<Uint8Array<ArrayBuffer>> {
  return encryptValue(key, VERIFIER_TEXT, VERIFIER_ROW, VERIFIER_COL);
}

/** True when the passphrase that produced this key is the right one. */
export async function checkVerifier(key: CryptoKey, blob: Uint8Array): Promise<boolean> {
  try {
    return (await decryptValue(key, blob, VERIFIER_ROW, VERIFIER_COL)) === VERIFIER_TEXT;
  } catch {
    return false;
  }
}
