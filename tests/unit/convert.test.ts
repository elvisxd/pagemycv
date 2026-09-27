import { describe, expect, it } from 'vitest';
import { convertVault } from '../../src/vault/convert';

const MATERIAL = new Uint8Array(32).fill(7);

/** Records the order the steps ran in, and lets any one of them fail. */
function steps(failAt?: 'open' | 'save' | 'markConverted') {
  const order: string[] = [];
  const step = <T>(name: string, value: T) => {
    order.push(name);
    if (name === failAt) return Promise.reject(new Error(`${name} failed`));
    return Promise.resolve(value);
  };
  return {
    order,
    readSalt: () => step('readSalt', new Uint8Array([1, 2, 3])),
    derive: (_p: string, _s: Uint8Array) => step('derive', MATERIAL),
    open: (_m: Uint8Array) => step('open', { status: 'unlocked' as const }),
    save: (_m: Uint8Array) => step('save', undefined),
    markConverted: () => step('markConverted', undefined),
  };
}

describe('converting a passphrase vault', () => {
  it('verifies, then stores, then relabels', async () => {
    const s = steps();
    await convertVault('a passphrase', s);
    expect(s.order).toEqual(['readSalt', 'derive', 'open', 'save', 'markConverted']);
  });

  it('returns the state the worker reported', async () => {
    await expect(convertVault('a passphrase', steps())).resolves.toEqual({ status: 'unlocked' });
  });

  it('stores nothing when the passphrase does not open the vault', async () => {
    // The dangerous version of this bug is silent: a wrong key on disk is
    // adopted by the next start, and every field reads as corrupt with the
    // passphrase screen long gone.
    const s = steps('open');
    await expect(convertVault('wrong', s)).rejects.toThrow(/open failed/);
    expect(s.order).not.toContain('save');
    expect(s.order).not.toContain('markConverted');
  });

  it('does not relabel the vault when the key could not be stored', async () => {
    // Relabelling here would claim the vault needs no passphrase while
    // nothing holds its key: unopenable, and nothing would ask for the
    // passphrase again to fix it.
    const s = steps('save');
    await expect(convertVault('a passphrase', s)).rejects.toThrow(/save failed/);
    expect(s.order).not.toContain('markConverted');
  });

  it('leaves a convertible vault behind when the relabel itself fails', async () => {
    // The one survivable failure: the key is stored and verified, only the
    // label is stale, so the next start asks for the passphrase once more.
    const s = steps('markConverted');
    await expect(convertVault('a passphrase', s)).rejects.toThrow(/markConverted failed/);
    expect(s.order).toEqual(['readSalt', 'derive', 'open', 'save', 'markConverted']);
  });

  it('refuses an empty passphrase before deriving anything', async () => {
    const s = steps();
    await expect(convertVault('', s)).rejects.toThrow(/required/);
    expect(s.order).toEqual([]);
  });
});
