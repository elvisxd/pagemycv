// The only module in the codebase that touches crypto.subtle or Argon2.
//
// Everything here follows docs/03-security.md. The two rules that are easy to
// break by accident and expensive to break in production:
//
//   1. Every encryption is bound to its position with AAD. Without it, all
//      columns share one key, so any ciphertext decrypts in any column and an
//      attacker with file access can relocate a visa status into another row.
//   2. The key is never persisted. Not to disk, not to chrome.storage, not as
//      a non-extractable CryptoKey in IndexedDB. A persisted key survives a
//      restart, which would let anyone with the browser profile read the CV
//      without ever knowing the passphrase.
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

/**
 * The shortest passphrase the vault will accept.
 *
 * Argon2id buys roughly three orders of magnitude against a GPU, which is a
 * great deal and still nothing against a four character passphrase: the whole
 * space is searched regardless of how slow each guess is. Twelve is the length
 * at which a memorable phrase of three or four words starts to be plausible,
 * and it is what the lock screen asks for.
 */
export const MIN_PASSPHRASE = 12;

export function passphraseProblem(passphrase: string): string | null {
  if (passphrase.length < MIN_PASSPHRASE) {
    return `the passphrase needs at least ${MIN_PASSPHRASE} characters`;
  }
  return null;
}

const enc = new TextEncoder();

/** WebCrypto wants a view over a plain ArrayBuffer, never a shared one. */
const own = (v: Uint8Array): Uint8Array<ArrayBuffer> =>
  new Uint8Array(v) as Uint8Array<ArrayBuffer>;
const dec = new TextDecoder();

export function randomSalt(): Uint8Array<ArrayBuffer> {
  return crypto.getRandomValues(new Uint8Array(SALT_BYTES));
}

export async function deriveKey(passphrase: string, salt: Uint8Array): Promise<CryptoKey> {
  const raw = await argon2id({
    password: passphrase,
    salt,
    ...KDF,
    outputType: 'binary',
  });
  // extractable: false. It is obfuscation rather than a boundary, but it stops
  // the raw bytes ever reaching a log or a serialized state object by accident.
  return crypto.subtle.importKey('raw', own(raw as Uint8Array), 'AES-GCM', false, [
    'encrypt',
    'decrypt',
  ]);
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
): Uint8Array<ArrayBuffer> {
  return enc.encode(`${rowId}.${column}.${version}`);
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
      { name: 'AES-GCM', iv, additionalData: aad(rowId, column) },
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
      { name: 'AES-GCM', iv, additionalData: aad(rowId, column) },
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
