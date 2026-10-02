/** Shared row and view types. No SQL here; the tables live in migrations/. */
import type { DocumentKind } from '../fill/types';

/**
 * 'absent'          nothing on disk yet; the next open creates it
 * 'opening'         a vault with a stored key, which this worker has not been
 *                   given yet. Transient, and never a screen: the offscreen
 *                   document hands the key over before any command returns.
 * 'needs_passphrase' a vault created before the passphrase was dropped. The
 *                   one state that still puts a prompt on screen, once.
 * 'unlocked'        open and readable
 * 'unavailable'     the database could not be opened at all
 */
export type VaultStatus = 'absent' | 'opening' | 'needs_passphrase' | 'unlocked' | 'unavailable';

export interface VaultState {
  status: VaultStatus;
  /** Set only when status is 'unavailable'. */
  problem?: string;
}

export interface WorkHistoryRow {
  id: string;
  employer: string;
  title: string;
  location: string | null;
  isRemote: boolean;
  startedOn: string;
  endedOn: string | null;
  description: string | null;
  sortOrder: number;
}

export interface EducationRow {
  id: string;
  institution: string;
  degree: string | null;
  field: string | null;
  startedOn: string | null;
  endedOn: string | null;
  sortOrder: number;
}

export interface LinkRow {
  id: string;
  kind: string;
  url: string;
  sortOrder: number;
}

export type SensitiveCategory =
  | 'authorization'
  | 'government_id'
  | 'compensation'
  | 'demographics'
  | 'birth'
  | 'background';

export interface SensitiveFieldMeta {
  key: string;
  category: SensitiveCategory;
  label: string;
  /** Shown before the value, every single time it is offered. */
  reason: string;
  hasValue: boolean;
}

/** A stored file, without its bytes. */
export interface ResumeMeta {
  filename: string;
  mimeType: string;
}

/** Which files are stored, by document. Absent means none. */
export type DocumentsMeta = Partial<Record<DocumentKind, ResumeMeta>>;

/** What the side panel is allowed to see. Sensitive values are never included. */
export interface ProfileView {
  profile: {
    legalFirst: string;
    legalLast: string;
    preferredName: string | null;
    headline: string | null;
    summary: string | null;
  } | null;
  contact: {
    email: string | null;
    phone: string | null;
    city: string | null;
    region: string | null;
    country: string;
  } | null;
  work: WorkHistoryRow[];
  education: EducationRow[];
  links: LinkRow[];
  /** Metadata only. Never a value. */
  sensitive: SensitiveFieldMeta[];
}
