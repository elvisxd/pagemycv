// The one-time move of an existing vault off its passphrase.
//
// This is the only code path in the project that can destroy a CV, so it is
// here on its own rather than inline in the offscreen document: the ORDER of
// the three steps is the whole safety argument, and an order is only testable
// if something can watch it.
//
// The data is never re-encrypted. The key a passphrase derives is the key the
// vault is already using, so conversion changes where that key comes from and
// nothing else. A migration that re-encrypted every column could stop halfway
// and leave a vault half readable under each of two keys; this cannot.

/** Everything the conversion touches, injected so the order can be observed. */
export interface ConvertSteps<S> {
  /** The salt the vault was created with. Not a secret. */
  readSalt(): Promise<Uint8Array>;
  /** Argon2id over the passphrase. Expensive, and the only slow step. */
  derive(passphrase: string, salt: Uint8Array): Promise<Uint8Array>;
  /** Hand the material to the worker. MUST reject if it does not open. */
  open(material: Uint8Array): Promise<S>;
  /** Put the material on disk. */
  save(material: Uint8Array): Promise<void>;
  /** Record that there is no passphrase behind this vault any more. */
  markConverted(): Promise<unknown>;
}

export async function convertVault<S>(passphrase: string, steps: ConvertSteps<S>): Promise<S> {
  if (!passphrase) throw new Error('the passphrase is required to open this vault once');
  const salt = await steps.readSalt();
  const material = await steps.derive(passphrase, salt);

  // 1. Verify FIRST. `open` rejects unless the material decrypts the
  //    verifier, so a wrong passphrase stops here having changed nothing.
  //    Storing first would leave a key on disk that opens no vault, and the
  //    next start would adopt it and report every field as corrupt.
  const state = await steps.open(material);

  // 2. Store SECOND. From here the vault can be opened without the person.
  await steps.save(material);

  // 3. Relabel LAST, and only because the first two worked. A crash before
  //    this leaves a vault that still asks for its passphrase — which is a
  //    working vault, just one that has not been converted yet. A crash
  //    between 3 and 2, if they were the other way round, would leave a vault
  //    that asks for nothing and has no key: unopenable, permanently.
  await steps.markConverted();
  return state;
}
