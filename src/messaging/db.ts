// Background to offscreen document. The offscreen document owns the worker that
// owns the database, and it is the only context that holds the vault key.
//
// Keys are prefixed 'db:' so they cannot be confused with the 'vault:' channel.
import { defineExtensionMessaging } from '@webext-core/messaging';
import type { ProfileView, ResumeMeta, VaultState } from '../db/schema';
import type { FillValues, ResumeFile } from '../fill/types';

export interface DbProtocol {
  'db:state'(): VaultState;
  'db:create'(data: { passphrase: string }): VaultState;
  'db:unlock'(data: { passphrase: string }): VaultState;
  'db:lock'(): VaultState;
  'db:profile'(): ProfileView;
  'db:importCv'(data: { markdown: string }): { imported: true; counts: Record<string, number> };
  'db:touch'(): VaultState;
  /**
   * The non-sensitive values the fill path may use, plus the resume bytes.
   * There is no variant of this that returns a sensitive value: see
   * readFillValues in src/db/worker.ts.
   */
  'db:fillValues'(): { values: FillValues; resume: ResumeFile | null };
  'db:setResume'(data: { filename: string; mimeType: string; base64: string }): {
    stored: true;
    meta: ResumeMeta;
  };
  'db:resumeMeta'(): ResumeMeta | null;
}

export const { sendMessage: sendDb, onMessage: onDb } = defineExtensionMessaging<DbProtocol>();
