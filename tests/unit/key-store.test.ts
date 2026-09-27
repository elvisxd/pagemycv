import { beforeEach, describe, expect, it, vi } from 'vitest';
import { KEY_BYTES, newKeyMaterial } from '../../src/vault/crypto';
import { hasKeyMaterial, loadKeyMaterial, saveKeyMaterial } from '../../src/vault/key-store';

/**
 * A stand-in for chrome.storage.local that keeps what it was given, byte for
 * byte, with no serialization of its own. The point of these tests is the
 * SHAPE the module commits to, so a fake that quietly normalised values would
 * make them pass for the wrong reason.
 */
let store: Record<string, unknown>;

beforeEach(() => {
  store = {};
  vi.stubGlobal('chrome', {
    storage: {
      local: {
        get: async (k: string) => (k in store ? { [k]: store[k] } : {}),
        set: async (items: Record<string, unknown>) => {
          Object.assign(store, items);
        },
      },
    },
  });
});

describe('the vault key at rest', () => {
  it('comes back as the same bytes it went in as', async () => {
    const material = newKeyMaterial();
    await saveKeyMaterial(material);
    expect(Buffer.from((await loadKeyMaterial()) as Uint8Array).equals(Buffer.from(material))).toBe(
      true,
    );
  });

  it('reports nothing on a profile that has never stored one', async () => {
    expect(await loadKeyMaterial()).toBeNull();
    expect(await hasKeyMaterial()).toBe(false);
  });

  it('survives JSON, which is the failure mode a Uint8Array has here', async () => {
    await saveKeyMaterial(newKeyMaterial());
    // chrome.storage serializes on some paths and not others. A Uint8Array
    // comes back from the JSON path as {"0":..,"1":..}: no length, so it
    // reads as an EMPTY key rather than as an error. Round-tripping the
    // stored value through JSON here is the whole test.
    const throughJson = JSON.parse(JSON.stringify(store));
    store = throughJson;
    expect(await loadKeyMaterial()).toHaveLength(KEY_BYTES);
  });

  it('refuses to store material of the wrong length', async () => {
    await expect(saveKeyMaterial(new Uint8Array(16))).rejects.toThrow(/16 byte/);
    expect(store).toEqual({});
  });

  it('reports a truncated stored key rather than reading it as absent', async () => {
    // "Absent" is not a harmless answer here: it is the one that offers to
    // create a second vault over a CV that is still on disk.
    await saveKeyMaterial(newKeyMaterial());
    const [k] = Object.keys(store);
    store[k as string] = (store[k as string] as number[]).slice(0, 8);
    await expect(loadKeyMaterial()).rejects.toThrow(/8 bytes/);
  });

  it('does not mistake some other stored value for a key', async () => {
    store['vault.key.v1'] = 'not an array';
    expect(await loadKeyMaterial()).toBeNull();
  });
});
