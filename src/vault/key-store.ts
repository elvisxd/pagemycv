// The ONLY module that puts vault key material on disk, and the only reason
// the extension asks for the `storage` permission.
//
// It is a separate door for the same reason crypto.subtle and SQLite have one:
// a second caller is a second place that can forget a rule. Here the rule is
// that the material is written to storage.local and NOWHERE else — not to
// storage.sync, which would put the key on Google's servers next to a CV that
// never leaves the machine, and not to storage.session, which would be
// forgotten on every browser restart and so re-open the prompt this exists to
// remove. The guard enforces the allowlist.
//
// Why a document and not the worker: the worker is the only place the key is
// used, so it would be the natural owner. It cannot be. `chrome` is undefined
// inside a dedicated worker — measured in a real browser, see spikes/phase-5 —
// so whatever owns key material at rest has to be a document. The offscreen
// document is the one that already owns the worker.
import { KEY_BYTES } from './crypto';

const STORAGE_KEY = 'vault.key.v1';

/**
 * Stored as a plain number array rather than a Uint8Array.
 *
 * chrome.storage serializes with the structured clone algorithm in some
 * paths and JSON in others; a Uint8Array survives the first and comes back
 * from the second as `{"0":12,"1":...}`, which has no `length` and reads as
 * an empty key. Committing to the lossless-under-JSON shape means the value
 * round-trips the same way whichever path it takes.
 */
type Stored = number[];

export async function loadKeyMaterial(): Promise<Uint8Array | null> {
  const got = await chrome.storage.local.get(STORAGE_KEY);
  const raw = got[STORAGE_KEY] as Stored | undefined;
  if (!Array.isArray(raw)) return null;
  // A truncated or rewritten value must not become a silently different key:
  // importKeyMaterial would reject the length anyway, but reporting "no key"
  // here would instead offer to create a second vault over the first.
  if (raw.length !== KEY_BYTES) {
    throw new Error(`the stored vault key is ${raw.length} bytes, expected ${KEY_BYTES}`);
  }
  return new Uint8Array(raw);
}

export async function saveKeyMaterial(material: Uint8Array): Promise<void> {
  if (material.length !== KEY_BYTES) {
    throw new Error(`refusing to store a ${material.length} byte vault key`);
  }
  await chrome.storage.local.set({ [STORAGE_KEY]: Array.from(material) satisfies Stored });
}

/** True when this browser profile already holds a key. */
export async function hasKeyMaterial(): Promise<boolean> {
  return (await loadKeyMaterial()) !== null;
}
