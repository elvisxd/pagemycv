// Side panel to background.
//
// The extension messenger has no namespace option, so the two channels are kept
// apart by their key prefixes instead: a context that has not registered a key
// simply does not answer it.
import { defineExtensionMessaging } from '@webext-core/messaging';
import type { ProfileView, ResumeMeta, VaultState } from '../db/schema';
import type { FillReport, ScreeningAnswers } from '../fill/types';

export interface VaultProtocol {
  'vault:state'(): VaultState;
  /** One time, for a vault that predates the stored key. */
  'vault:convert'(data: { passphrase: string }): VaultState;
  'vault:profile'(): ProfileView;
  'vault:importCv'(data: { markdown: string }): { imported: true; counts: Record<string, number> };
  'vault:resumeMeta'(): ResumeMeta | null;
  'vault:screeningAnswers'(): ScreeningAnswers;
  'vault:setScreeningAnswer'(data: { kind: string; answer: string }): { saved: true };
  'vault:setResume'(data: { filename: string; mimeType: string; base64: string }): {
    stored: true;
    meta: ResumeMeta;
  };
  /**
   * Describe the active tab, plan a fill, execute it, and report back.
   *
   * One message rather than three, so the panel cannot hold a plan across a
   * page navigation and apply it to a form that is no longer the one it was
   * built from.
   */
  'vault:fill'(): FillReport;
  'vault:clearFill'(): { cleared: true };
}

export const { sendMessage: sendVault, onMessage: onVault } =
  defineExtensionMessaging<VaultProtocol>();
