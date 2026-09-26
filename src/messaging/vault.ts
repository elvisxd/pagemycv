// Side panel to background.
//
// The extension messenger has no namespace option, so the two channels are kept
// apart by their key prefixes instead: a context that has not registered a key
// simply does not answer it.
import { defineExtensionMessaging } from '@webext-core/messaging';
import type { ProfileView, VaultState } from '../db/schema';

interface VaultProtocol {
  'vault:state'(): VaultState;
  'vault:create'(data: { passphrase: string }): VaultState;
  'vault:unlock'(data: { passphrase: string }): VaultState;
  'vault:lock'(): VaultState;
  'vault:profile'(): ProfileView;
  'vault:importCv'(data: { markdown: string }): { imported: true; counts: Record<string, number> };
  'vault:touch'(): VaultState;
}

export const { sendMessage: sendVault, onMessage: onVault } =
  defineExtensionMessaging<VaultProtocol>();
