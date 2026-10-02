import { beforeAll, describe, expect, it } from 'vitest';
import {
  aad,
  checkVerifier,
  decryptValue,
  deriveKeyMaterial,
  encryptValue,
  importKeyMaterial,
  KDF,
  KDF_ID,
  KEY_BYTES,
  makeVerifier,
  newKeyMaterial,
  PAD_BLOCK,
  randomSalt,
} from '../../src/vault/crypto';

/** The conversion path, which is the only thing a passphrase is still for. */
const deriveKey = async (passphrase: string, salt: Uint8Array): Promise<CryptoKey> =>
  importKeyMaterial(await deriveKeyMaterial(passphrase, salt));

const PASSPHRASE = 'correct horse battery staple';
let key: CryptoKey;
let salt: Uint8Array;

beforeAll(async () => {
  salt = randomSalt();
  key = await deriveKey(PASSPHRASE, salt);
}, 60_000);

describe('a vault key with no passphrase behind it', () => {
  it('is the full AES-256 width', () => {
    expect(newKeyMaterial()).toHaveLength(KEY_BYTES);
    expect(KEY_BYTES).toBe(32);
  });

  it('is never the same twice', () => {
    const a = Buffer.from(newKeyMaterial());
    const b = Buffer.from(newKeyMaterial());
    expect(a.equals(b)).toBe(false);
  });

  it('round trips through the store as bytes', async () => {
    const material = newKeyMaterial();
    const written = await importKeyMaterial(material);
    const blob = await encryptValue(written, 'Orlando', 'contact:1', 'city_enc');
    // A copy, because what comes back out of chrome.storage is a new array,
    // not the one that went in.
    const read = await importKeyMaterial(new Uint8Array(material));
    await expect(decryptValue(read, blob, 'contact:1', 'city_enc')).resolves.toBe('Orlando');
  });

  it('cannot be exported once imported', async () => {
    expect((await importKeyMaterial(newKeyMaterial())).extractable).toBe(false);
  });

  it('refuses material of the wrong length rather than padding it', async () => {
    // Silently accepting a short key would encrypt the vault under something
    // nobody can reproduce, and the failure would land at the first read.
    await expect(importKeyMaterial(new Uint8Array(16))).rejects.toThrow(/32 bytes/);
    await expect(importKeyMaterial(new Uint8Array(33))).rejects.toThrow(/32 bytes/);
  });

  it('does not open a vault made under a different key', async () => {
    const blob = await makeVerifier(await importKeyMaterial(newKeyMaterial()));
    await expect(checkVerifier(await importKeyMaterial(newKeyMaterial()), blob)).resolves.toBe(
      false,
    );
  });
});

describe('deriving from a passphrase, for the one-time conversion', () => {
  it('produces a key that cannot be exported', () => {
    expect(key.extractable).toBe(false);
  });

  it('is deterministic for the same passphrase and salt', async () => {
    const again = await deriveKey(PASSPHRASE, salt);
    const blob = await encryptValue(key, 'hello', 'r1', 'c1');
    await expect(decryptValue(again, blob, 'r1', 'c1')).resolves.toBe('hello');
  }, 60_000);

  it('produces a different key for a different salt', async () => {
    const other = await deriveKey(PASSPHRASE, randomSalt());
    const blob = await encryptValue(key, 'hello', 'r1', 'c1');
    await expect(decryptValue(other, blob, 'r1', 'c1')).rejects.toThrow();
  }, 60_000);
});

describe('round trip', () => {
  it('returns what went in', async () => {
    const blob = await encryptValue(key, 'Orlando', 'contact:1', 'city_enc');
    await expect(decryptValue(key, blob, 'contact:1', 'city_enc')).resolves.toBe('Orlando');
  });

  it('survives characters outside ASCII', async () => {
    const text = 'María Auxiliadora II · Bolívar';
    const blob = await encryptValue(key, text, 'r', 'c');
    await expect(decryptValue(key, blob, 'r', 'c')).resolves.toBe(text);
  });

  it('never produces the same ciphertext twice', async () => {
    const a = await encryptValue(key, 'same', 'r', 'c');
    const b = await encryptValue(key, 'same', 'r', 'c');
    expect(Buffer.from(a).equals(Buffer.from(b))).toBe(false);
  });
});

// This is the test the whole AAD design exists for. Without binding, every
// column shares one key, so any ciphertext would decrypt in any column.
describe('position binding', () => {
  it('fails when the ciphertext is moved to another row', async () => {
    const blob = await encryptValue(key, 'valid until 2029', 'sensitive:row-1', 'value_enc');
    await expect(decryptValue(key, blob, 'sensitive:row-1', 'value_enc')).resolves.toBeTruthy();
    await expect(decryptValue(key, blob, 'sensitive:row-2', 'value_enc')).rejects.toThrow();
  });

  it('fails when the ciphertext is moved to another column', async () => {
    const blob = await encryptValue(key, '+1 555 0100', 'contact:1', 'phone_enc');
    await expect(decryptValue(key, blob, 'contact:1', 'address_line1_enc')).rejects.toThrow();
  });

  it('fails when the schema version changes underneath it', async () => {
    const blob = await encryptValue(key, 'x', 'r', 'c');
    const iv = blob.slice(0, 12);
    const ct = blob.slice(12);
    await expect(
      crypto.subtle.decrypt({ name: 'AES-GCM', iv, additionalData: aad('r', 'c', 2) }, key, ct),
    ).rejects.toThrow();
  });
});

describe('the padding flag is part of the format', () => {
  it('refuses to read an unpadded value as padded', async () => {
    const blob = await encryptValue(key, 'hello', 'r', 'c');
    // This used to resolve to "llo": a slice of the plaintext, silently.
    await expect(decryptValue(key, blob, 'r', 'c', { padded: true })).rejects.toThrow();
  });

  it('refuses to read a padded value as unpadded', async () => {
    const blob = await encryptValue(key, 'hello', 'r', 'c', { padded: true });
    // This used to resolve to "\u0000\u0005hello\u0000…" straight into a form.
    await expect(decryptValue(key, blob, 'r', 'c')).rejects.toThrow();
  });
});

describe('padding', () => {
  it('hides the length of a low entropy value', async () => {
    const short = await encryptValue(key, 'Yes', 'r', 'c', { padded: true });
    const long = await encryptValue(key, 'No, and I never will', 'r', 'c', { padded: true });
    expect(short.length).toBe(long.length);
    expect(short.length).toBeGreaterThan(PAD_BLOCK);
  });

  it('leaks the length when padding is off, which is why sensitive columns use it', async () => {
    const short = await encryptValue(key, 'Yes', 'r', 'c');
    const long = await encryptValue(key, 'No, and I never will', 'r', 'c');
    expect(short.length).not.toBe(long.length);
  });

  it('round trips a value that exactly fills a block', async () => {
    const exact = 'x'.repeat(PAD_BLOCK - 2);
    const blob = await encryptValue(key, exact, 'r', 'c', { padded: true });
    await expect(decryptValue(key, blob, 'r', 'c', { padded: true })).resolves.toBe(exact);
  });

  it('round trips an empty value', async () => {
    const blob = await encryptValue(key, '', 'r', 'c', { padded: true });
    await expect(decryptValue(key, blob, 'r', 'c', { padded: true })).resolves.toBe('');
  });

  it('measures bytes, not characters', async () => {
    // 40 characters, 80 bytes: must land in the second block, not the first.
    const accented = 'ñ'.repeat(40);
    const blob = await encryptValue(key, accented, 'r', 'c', { padded: true });
    await expect(decryptValue(key, blob, 'r', 'c', { padded: true })).resolves.toBe(accented);
  });

  it('round trips a padded value exactly', async () => {
    const blob = await encryptValue(key, 'valid until 2029', 'r', 'c', { padded: true });
    await expect(decryptValue(key, blob, 'r', 'c', { padded: true })).resolves.toBe(
      'valid until 2029',
    );
  });
});

describe('verifier', () => {
  it('accepts the right passphrase', async () => {
    const blob = await makeVerifier(key);
    await expect(checkVerifier(key, blob)).resolves.toBe(true);
  });

  it('rejects the wrong passphrase without throwing', async () => {
    const blob = await makeVerifier(key);
    const wrong = await deriveKey('not the passphrase', salt);
    await expect(checkVerifier(wrong, blob)).resolves.toBe(false);
  }, 60_000);
});

// The parameters below are asserted against literals on purpose. Comparing
// them to the constants they describe would make the test pass for any value,
// and these two numbers are the entire security argument for choosing Argon2id.
describe('the security parameters are pinned', () => {
  it('uses the OWASP Argon2id configuration', () => {
    expect(KDF).toEqual({ memorySize: 19456, iterations: 2, parallelism: 1, hashLength: 32 });
  });

  it('names Argon2id as the derivation, not a fallback', () => {
    expect(KDF_ID).toBe('argon2id');
  });

  it('binds a ciphertext to row, column, version and padding', () => {
    expect(new TextDecoder().decode(aad('contact:1', 'city_enc'))).toBe(
      '["contact:1","city_enc",1,false]',
    );
  });

  it('cannot produce the same binding for two different positions', () => {
    // Dot-joining made these identical. A self-delimiting encoding cannot.
    expect(aad('a.b', 'c')).not.toEqual(aad('a', 'b.c'));
  });
});

// A passphrase is what the user typed, not how their keyboard encoded it. This
// matters more now than it did, not less: the conversion gets ONE chance to
// derive the key an old vault is already encrypted under, and a vault created
// on a Mac and converted on a PC would otherwise be unopenable for good.
describe('Unicode normalization', () => {
  it('opens with the same passphrase in either normal form', async () => {
    const s = randomSalt();
    const composed = 'contraseña muy larga'.normalize('NFC');
    const decomposed = 'contraseña muy larga'.normalize('NFD');
    expect(composed).not.toBe(decomposed);

    const written = await deriveKey(composed, s);
    const blob = await encryptValue(written, 'Orlando', 'contact:1', 'city_enc');
    const read = await deriveKey(decomposed, s);
    await expect(decryptValue(read, blob, 'contact:1', 'city_enc')).resolves.toBe('Orlando');
  }, 120_000);
});
