import { beforeAll, describe, expect, it } from 'vitest';
import {
  aad,
  checkVerifier,
  decryptValue,
  deriveKey,
  encryptValue,
  KDF,
  KDF_ID,
  MIN_PASSPHRASE,
  makeVerifier,
  PAD_BLOCK,
  passphraseProblem,
  randomSalt,
} from '../../src/vault/crypto';

const PASSPHRASE = 'correct horse battery staple';
let key: CryptoKey;
let salt: Uint8Array;

beforeAll(async () => {
  salt = randomSalt();
  key = await deriveKey(PASSPHRASE, salt);
}, 60_000);

describe('deriveKey', () => {
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

describe('passphrase strength', () => {
  it('refuses a passphrase Argon2id cannot save', () => {
    expect(passphraseProblem('short')).toMatch(/at least/);
    expect(passphraseProblem('')).toMatch(/at least/);
  });

  it('accepts a memorable phrase', () => {
    expect(passphraseProblem('correct horse battery staple')).toBeNull();
  });

  it('measures characters, not words', () => {
    expect(passphraseProblem('a'.repeat(MIN_PASSPHRASE))).toBeNull();
    expect(passphraseProblem('a'.repeat(MIN_PASSPHRASE - 1))).toMatch(/at least/);
  });
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

  it('requires twelve characters', () => {
    expect(MIN_PASSPHRASE).toBe(12);
    expect(passphraseProblem('elevenchars')).toMatch(/at least/);
    expect(passphraseProblem('twelvechars!')).toBeNull();
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

// A passphrase is what the user typed, not how their keyboard encoded it.
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

  it('counts length after normalizing, so the rule and the key agree', () => {
    // Twelve characters composed, thirteen code units decomposed.
    const decomposed = 'contraseñaX'.normalize('NFD');
    expect(decomposed.length).toBeGreaterThan(11);
    expect(passphraseProblem(decomposed)).toMatch(/at least/);
  });
});
