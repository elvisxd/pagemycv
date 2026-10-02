import { argon2id } from 'hash-wasm';
import { describe, expect, it } from 'vitest';
import {
  decryptValue,
  deriveKeyMaterial,
  encryptValue,
  importKeyMaterial,
} from '../../src/vault/crypto';

// A vault created BEFORE the passphrase was dropped is encrypted under a key
// the old code derived and imported in one step. The conversion derives the
// same bytes again and stores them, re-encrypting nothing. So the whole of
// "your CV is still there afterwards" rests on one property: the new
// derivation produces the bytes the old one did. This file pins that.
//
// Everything below is asserted against LITERALS, never against the constants
// in src/vault/crypto.ts. Comparing to the constants would pass for any value;
// the point is to break loudly if anyone changes the KDF, the normalization,
// or the hash-wasm output, because any of those makes existing vaults
// unopenable with no recovery.

const PASSPHRASE = 'correct horse battery staple';
const SALT = new Uint8Array([
  3, 20, 37, 54, 71, 88, 105, 122, 139, 156, 173, 190, 207, 224, 241, 2,
]);

/**
 * The derivation exactly as the pre-change code performed it, written out
 * with the OWASP parameters inlined rather than imported. This is the
 * algorithm a passphrase vault on a real machine was created with.
 */
async function legacyDeriveKey(passphrase: string, salt: Uint8Array): Promise<CryptoKey> {
  const raw = await argon2id({
    password: passphrase.normalize('NFC'),
    salt,
    memorySize: 19456,
    iterations: 2,
    parallelism: 1,
    hashLength: 32,
    outputType: 'binary',
  });
  return crypto.subtle.importKey('raw', new Uint8Array(raw), 'AES-GCM', false, [
    'encrypt',
    'decrypt',
  ]);
}

describe('converting a vault made before the passphrase was dropped', () => {
  it('derives the exact bytes the old code derived (golden vector)', async () => {
    const material = await deriveKeyMaterial(PASSPHRASE, SALT);
    expect(Buffer.from(material).toString('hex')).toBe(
      'b28bb52d81459f0127d5c80f915a29d4df1b375a41822922cb84b480b1b0c3f3',
    );
  }, 60_000);

  it('opens a value the OLD derivation encrypted', async () => {
    // Encrypted the way an existing vault's columns are: under a key the
    // pre-change code derived and imported directly.
    const legacy = await legacyDeriveKey(PASSPHRASE, SALT);
    const blob = await encryptValue(legacy, 'Orlando', 'contact:1', 'city_enc');

    // Read the way the conversion reads: derive bytes, store them (elided),
    // import them.
    const converted = await importKeyMaterial(await deriveKeyMaterial(PASSPHRASE, SALT));
    await expect(decryptValue(converted, blob, 'contact:1', 'city_enc')).resolves.toBe('Orlando');
  }, 60_000);

  it('still opens it when the passphrase arrives in the other normal form', async () => {
    // A vault created on a Mac (NFD keyboard input) converted on a PC (NFC),
    // or the reverse. The conversion has exactly one chance at this.
    const composed = 'contraseña muy larga'.normalize('NFC');
    const decomposed = 'contraseña muy larga'.normalize('NFD');
    expect(composed).not.toBe(decomposed);

    const legacy = await legacyDeriveKey(composed, SALT);
    const blob = await encryptValue(legacy, 'Orlando', 'contact:1', 'city_enc');
    const converted = await importKeyMaterial(await deriveKeyMaterial(decomposed, SALT));
    await expect(decryptValue(converted, blob, 'contact:1', 'city_enc')).resolves.toBe('Orlando');
  }, 120_000);

  it('does NOT open it with a different passphrase, so a typo cannot be stored as the key', async () => {
    const legacy = await legacyDeriveKey(PASSPHRASE, SALT);
    const blob = await encryptValue(legacy, 'Orlando', 'contact:1', 'city_enc');
    const wrong = await importKeyMaterial(
      await deriveKeyMaterial('correct horse battery stapel', SALT),
    );
    await expect(decryptValue(wrong, blob, 'contact:1', 'city_enc')).rejects.toThrow();
  }, 60_000);
});
