// Opening the vault: deciding, from what the worker reports, whether to create
// one, hand it the stored key, or wait for a passphrase.
//
// It lives here rather than in the service worker because that entrypoint can
// be imported by nothing, so it can be tested by nothing — the same trap
// DECISIONS.md records for the roll call. The first version of this logic sat
// there and carried a bug no test could reach: once an open had succeeded it
// was remembered forever, so when the offscreen document replaced a dead
// worker (which starts with no key) nothing ever opened the new one, and every
// command failed with "the vault is not open yet" until Chrome happened to
// idle the service worker out.
//
// So only the IN-FLIGHT open is shared. A finished one is forgotten, and the
// next command asks the worker again. That costs one state() round trip per
// command, at human pace, and it is the only way to be right about a worker
// this context cannot see die.
import type { VaultState } from '../db/schema';

export interface OpenSteps {
  state(): Promise<VaultState>;
  /** Fresh key material. Only called when there is no vault at all. */
  newMaterial(): Uint8Array;
  load(): Promise<Uint8Array | null>;
  save(material: Uint8Array): Promise<void>;
  create(material: Uint8Array): Promise<unknown>;
  open(material: Uint8Array): Promise<unknown>;
}

export const KEY_MISSING =
  'the vault exists but its key is not in this browser profile, so it cannot be opened';

export async function openVault(steps: OpenSteps): Promise<void> {
  const state = await steps.state();
  if (state.status === 'unavailable' || state.status === 'unlocked') return;

  if (state.status === 'absent') {
    // Stored BEFORE the vault is created. A vault encrypted under a key we
    // then failed to persist would be unopenable forever; a stored key with
    // no vault behind it is an unused value the next create overwrites.
    const material = steps.newMaterial();
    await steps.save(material);
    await steps.create(material);
    return;
  }

  // Made with a passphrase and not yet converted. The panel asks once.
  if (state.status === 'needs_passphrase') return;

  const material = await steps.load();
  // Creating a new vault here would write over a CV that is still on disk,
  // and asking for a passphrase would ask for one that was never set.
  if (!material) throw new Error(KEY_MISSING);
  await steps.open(material);
}

/**
 * One open at a time, and none remembered once it settles.
 *
 * Sharing the in-flight one is what stops two panels opening at once from
 * both seeing an absent vault and both creating one. Forgetting the finished
 * one is what lets a replaced worker be opened again.
 */
export function createOpener(steps: OpenSteps): () => Promise<void> {
  let inFlight: Promise<void> | null = null;
  return () => {
    if (!inFlight) {
      inFlight = openVault(steps).finally(() => {
        inFlight = null;
      });
    }
    return inFlight;
  };
}
