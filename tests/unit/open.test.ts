import { describe, expect, it } from 'vitest';
import type { VaultState } from '../../src/db/schema';
import { createOpener, KEY_MISSING, type OpenSteps } from '../../src/vault/open';

/**
 * A worker and a key store, modelled just far enough to be wrong in the ways
 * that matter: the worker can lose its key (be replaced), and every call is
 * counted.
 */
function world(start: { vault: 'absent' | 'random' | 'passphrase'; stored?: boolean }) {
  const calls: string[] = [];
  let hasVault = start.vault !== 'absent';
  let kdf = start.vault === 'passphrase' ? 'argon2id' : 'random';
  let workerHasKey = false;
  let stored: Uint8Array | null = start.stored ? new Uint8Array(32).fill(1) : null;

  const steps: OpenSteps = {
    state: async (): Promise<VaultState> => {
      calls.push('state');
      if (!hasVault) return { status: 'absent' };
      if (workerHasKey) return { status: 'unlocked' };
      return { status: kdf === 'random' ? 'opening' : 'needs_passphrase' };
    },
    newMaterial: () => new Uint8Array(32).fill(2),
    load: async () => {
      calls.push('load');
      return stored;
    },
    save: async (m) => {
      calls.push('save');
      stored = m;
    },
    create: async () => {
      calls.push('create');
      hasVault = true;
      kdf = 'random';
      workerHasKey = true;
    },
    open: async () => {
      calls.push('open');
      workerHasKey = true;
    },
  };
  return {
    steps,
    calls,
    /** What the offscreen document does when a worker dies: a new one, keyless. */
    replaceWorker: () => {
      workerHasKey = false;
    },
    storedKey: () => stored,
  };
}

describe('opening the vault', () => {
  it('creates one on a first run, storing the key before the vault exists', async () => {
    const w = world({ vault: 'absent' });
    await createOpener(w.steps)();
    expect(w.calls).toEqual(['state', 'save', 'create']);
  });

  it('hands a closed vault its stored key', async () => {
    const w = world({ vault: 'random', stored: true });
    await createOpener(w.steps)();
    expect(w.calls).toEqual(['state', 'load', 'open']);
  });

  it('opens AGAIN after the worker is replaced', async () => {
    // The regression. Remembering a finished open meant a replacement worker,
    // which starts with no key, was never given one.
    const w = world({ vault: 'random', stored: true });
    const ensure = createOpener(w.steps);
    await ensure();
    w.replaceWorker();
    w.calls.length = 0;
    await ensure();
    expect(w.calls).toEqual(['state', 'load', 'open']);
  });

  it('does nothing but ask when the vault is already open', async () => {
    const w = world({ vault: 'random', stored: true });
    const ensure = createOpener(w.steps);
    await ensure();
    w.calls.length = 0;
    await ensure();
    expect(w.calls).toEqual(['state']);
  });

  it('shares one open between concurrent callers, so only one vault is created', async () => {
    const w = world({ vault: 'absent' });
    const ensure = createOpener(w.steps);
    await Promise.all([ensure(), ensure(), ensure(), ensure()]);
    expect(w.calls.filter((c) => c === 'create')).toHaveLength(1);
  });

  it('refuses to create a second vault when the key has gone missing', async () => {
    const w = world({ vault: 'random', stored: false });
    await expect(createOpener(w.steps)()).rejects.toThrow(KEY_MISSING);
    expect(w.calls).not.toContain('create');
    expect(w.calls).not.toContain('save');
  });

  it('retries after a failure instead of remembering it', async () => {
    const w = world({ vault: 'random', stored: false });
    const ensure = createOpener(w.steps);
    await expect(ensure()).rejects.toThrow();
    w.calls.length = 0;
    await expect(ensure()).rejects.toThrow();
    expect(w.calls).toEqual(['state', 'load']);
  });

  it('leaves a passphrase vault alone for the panel to convert', async () => {
    const w = world({ vault: 'passphrase', stored: false });
    await createOpener(w.steps)();
    expect(w.calls).toEqual(['state']);
    expect(w.storedKey()).toBeNull();
  });
});
