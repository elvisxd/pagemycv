// Background to offscreen document. The offscreen document owns the worker that
// owns the database, and it is the only context that holds the vault key.
//
// Keys are prefixed 'db:' so they cannot be confused with the 'vault:' channel.
import { defineExtensionMessaging } from '@webext-core/messaging';
import type { ProfileView, VaultState } from '../db/schema';

interface DbProtocol {
  'db:state'(): VaultState;
  'db:create'(data: { passphrase: string }): VaultState;
  'db:unlock'(data: { passphrase: string }): VaultState;
  'db:lock'(): VaultState;
  'db:profile'(): ProfileView;
  'db:importCv'(data: { markdown: string }): { imported: true; counts: Record<string, number> };
  'db:touch'(): VaultState;
}

export const { sendMessage: sendDb, onMessage: onDb } = defineExtensionMessaging<DbProtocol>();
