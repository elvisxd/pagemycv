/** Shared row and view types. No SQL here; the tables live in migrations/. */

export type VaultStatus = 'absent' | 'locked' | 'unlocked';

export interface VaultState {
  status: VaultStatus;
  /** Epoch ms when an unlocked vault will auto-lock, if unlocked. */
  locksAt?: number;
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
