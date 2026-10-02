// Background to offscreen document. The offscreen document owns the worker that
// owns the database, and it is the only context that holds the vault key.
//
// Keys are prefixed 'db:' so they cannot be confused with the 'vault:' channel.
import { defineExtensionMessaging } from '@webext-core/messaging';
import type { Backup } from '../backup/format';
import type { ProfileView, ResumeMeta, VaultState } from '../db/schema';
import type { FillValues, ResumeFile, ScreeningAnswers } from '../fill/types';

export interface DbProtocol {
  /**
   * "Your listeners are registered." Answered by the offscreen document
   * itself, never relayed to the worker, because the worker being slow to
   * start is a different question from the document being ready to be asked.
   */
  'db:ping'(): { ready: true };
  'db:state'(): VaultState;
  /**
   * The four below carry or concern the vault key, and the SERVICE WORKER is
   * the only sender: it is the only context with chrome.storage, so it is the
   * only one that can know what the material is. `material` is base64 for the
   * reason src/util/base64.ts gives — a Uint8Array does not survive the trip.
   */
  'db:create'(data: { material: string }): VaultState;
  'db:open'(data: { material: string }): VaultState;
  /** The salt an old passphrase vault was created with. Not a secret. */
  'db:salt'(): string;
  /** Record that a converted vault has no passphrase behind it any more. */
  'db:markConverted'(): VaultState;
  'db:profile'(): ProfileView;
  'db:importCv'(data: { markdown: string }): { imported: true; counts: Record<string, number> };
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
  /** Everything a person entered, decrypted. See src/backup/format.ts. */
  'db:exportBackup'(): Backup;
  /** Replace the vault's contents with a backup file's text. All or nothing. */
  'db:importBackup'(data: { text: string }): { restored: true; counts: Record<string, number> };
  /** Your own answers to the screening questions, decrypted. */
  'db:screeningAnswers'(): ScreeningAnswers;
  /** Store one. An empty answer deletes it rather than storing a blank. */
  'db:setScreeningAnswer'(data: { kind: string; answer: string }): { saved: true };
}

export const { sendMessage: sendDb, onMessage: onDb } = defineExtensionMessaging<DbProtocol>();
