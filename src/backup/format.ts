// The backup file: what is in it, and the one function allowed to believe it.
//
// A restore REPLACES the vault's contents, so a malformed file must be refused
// before anything is touched. That is the whole job of parseBackup: nothing
// downstream re-checks a field, because nothing downstream should ever see a
// field that was not checked here.
//
// The file is NOT encrypted. Decided, not overlooked: what it can hold today
// is the CV, the résumé file and the screening answers — roughly what gets
// sent to employers anyway — and a passphrase on the file would turn a
// forgotten passphrase into a lost backup, the exact failure a backup exists
// to prevent. That reasoning holds only while sensitive values cannot be
// stored, and tests/unit/backup-coverage.test.ts fails the day they can.
import { SCREENING_KINDS } from '../fill/types';

export const BACKUP_FORMAT = 'pagemycv-backup';
export const BACKUP_VERSION = 1;

export interface BackupProfile {
  legalFirst: string;
  legalLast: string;
  preferredName: string | null;
  headline: string | null;
  summary: string | null;
  locale: string;
}

export interface BackupContact {
  email: string | null;
  phone: string | null;
  addressLine1: string | null;
  addressLine2: string | null;
  city: string | null;
  region: string | null;
  postalCode: string | null;
  country: string;
}

/** Ids are not carried: they mean nothing outside the vault that made them. */
export interface BackupWork {
  employer: string;
  title: string;
  location: string | null;
  isRemote: boolean;
  startedOn: string;
  endedOn: string | null;
  description: string | null;
}

export interface BackupEducation {
  institution: string;
  degree: string | null;
  field: string | null;
  startedOn: string | null;
  endedOn: string | null;
}

export interface BackupLink {
  kind: string;
  url: string;
}

export interface BackupResume {
  filename: string;
  mimeType: string;
  base64: string;
}

/** Array order is the display order; it becomes sort_order on restore. */
export interface Backup {
  format: typeof BACKUP_FORMAT;
  version: typeof BACKUP_VERSION;
  exportedAt: string;
  profile: BackupProfile | null;
  contact: BackupContact | null;
  work: BackupWork[];
  education: BackupEducation[];
  links: BackupLink[];
  resume: BackupResume | null;
  screeningAnswers: Record<string, string>;
}

/**
 * Every table in the schema, sorted into the two lists. A table in neither is
 * a table nobody decided about, and the coverage test refuses it.
 */
export const BACKED_UP_TABLES = [
  'profile',
  'contact',
  'work_history',
  'education',
  'link',
  'document',
  'screening_answer',
] as const;

export const NOT_BACKED_UP: Readonly<Record<string, string>> = {
  vault:
    'the salt and key verifier of THIS install. A restore goes into whichever vault is open, under its key.',
  sensitive_value:
    'seeded empty when a vault is created, and no code sets a value yet. This file has no passphrase, so the day some code does, the backup must be redesigned before it may carry them.',
  event_log: 'what this install did, not what you entered.',
  answer: 'nothing writes it yet. Phase 5 owns it.',
  application: 'nothing writes it yet.',
  filled_field: 'nothing writes it yet.',
  skipped_field: 'nothing writes it yet.',
};

export function serializeBackup(backup: Backup): string {
  return `${JSON.stringify(backup, null, 2)}\n`;
}

/** Thrown for anything this file will not restore. The message is for the panel. */
export class BackupError extends Error {}

type Json = Record<string, unknown>;

const isObject = (v: unknown): v is Json =>
  typeof v === 'object' && v !== null && !Array.isArray(v);

function str(o: Json, key: string, where: string): string {
  const v = o[key];
  if (typeof v !== 'string') throw new BackupError(`${where}.${key} should be text`);
  return v;
}

function optStr(o: Json, key: string, where: string): string | null {
  const v = o[key];
  if (v === null || v === undefined) return null;
  if (typeof v !== 'string') throw new BackupError(`${where}.${key} should be text or empty`);
  return v;
}

function list(o: Json, key: string): Json[] {
  const v = o[key];
  if (!Array.isArray(v)) throw new BackupError(`${key} should be a list`);
  return v.map((item, i) => {
    if (!isObject(item)) throw new BackupError(`${key}[${i}] is not an entry`);
    return item;
  });
}

/**
 * Parse and check a backup file. Refuses rather than repairs: a restore that
 * guessed at a damaged file would replace a good vault with a guess.
 */
export function parseBackup(text: string): Backup {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    throw new BackupError('that file is not a PageMyCV backup: it is not readable JSON');
  }
  if (!isObject(raw) || raw.format !== BACKUP_FORMAT) {
    throw new BackupError('that file is not a PageMyCV backup');
  }
  if (raw.version !== BACKUP_VERSION) {
    throw new BackupError(
      typeof raw.version === 'number' && raw.version > BACKUP_VERSION
        ? 'that backup was made by a newer PageMyCV. Update this one, then restore it.'
        : 'that backup has a version this PageMyCV does not recognise',
    );
  }

  let profile: BackupProfile | null = null;
  if (raw.profile !== null) {
    if (!isObject(raw.profile)) throw new BackupError('profile is damaged');
    const p = raw.profile;
    profile = {
      legalFirst: str(p, 'legalFirst', 'profile'),
      legalLast: str(p, 'legalLast', 'profile'),
      preferredName: optStr(p, 'preferredName', 'profile'),
      headline: optStr(p, 'headline', 'profile'),
      summary: optStr(p, 'summary', 'profile'),
      locale: str(p, 'locale', 'profile'),
    };
  }

  let contact: BackupContact | null = null;
  if (raw.contact !== null) {
    if (!isObject(raw.contact)) throw new BackupError('contact is damaged');
    const c = raw.contact;
    contact = {
      email: optStr(c, 'email', 'contact'),
      phone: optStr(c, 'phone', 'contact'),
      addressLine1: optStr(c, 'addressLine1', 'contact'),
      addressLine2: optStr(c, 'addressLine2', 'contact'),
      city: optStr(c, 'city', 'contact'),
      region: optStr(c, 'region', 'contact'),
      postalCode: optStr(c, 'postalCode', 'contact'),
      country: str(c, 'country', 'contact'),
    };
  }

  const work = list(raw, 'work').map((w, i) => {
    const at = `work[${i}]`;
    if (typeof w.isRemote !== 'boolean')
      throw new BackupError(`${at}.isRemote should be true or false`);
    return {
      employer: str(w, 'employer', at),
      title: str(w, 'title', at),
      location: optStr(w, 'location', at),
      isRemote: w.isRemote,
      startedOn: str(w, 'startedOn', at),
      endedOn: optStr(w, 'endedOn', at),
      description: optStr(w, 'description', at),
    };
  });

  const education = list(raw, 'education').map((e, i) => {
    const at = `education[${i}]`;
    return {
      institution: str(e, 'institution', at),
      degree: optStr(e, 'degree', at),
      field: optStr(e, 'field', at),
      startedOn: optStr(e, 'startedOn', at),
      endedOn: optStr(e, 'endedOn', at),
    };
  });

  const links = list(raw, 'links').map((l, i) => ({
    kind: str(l, 'kind', `links[${i}]`),
    url: str(l, 'url', `links[${i}]`),
  }));

  let resume: BackupResume | null = null;
  if (raw.resume !== null) {
    if (!isObject(raw.resume)) throw new BackupError('resume is damaged');
    const r = raw.resume;
    resume = {
      filename: str(r, 'filename', 'resume'),
      mimeType: str(r, 'mimeType', 'resume'),
      base64: str(r, 'base64', 'resume'),
    };
    // Checked here, not at attach time: a résumé that cannot be decoded
    // would restore "successfully" and fail weeks later on a real form.
    try {
      atob(resume.base64);
    } catch {
      throw new BackupError('the résumé in that backup is damaged');
    }
  }

  if (!isObject(raw.screeningAnswers)) throw new BackupError('screeningAnswers is damaged');
  const known = new Set<string>(SCREENING_KINDS);
  const screeningAnswers: Record<string, string> = {};
  for (const [kind, answer] of Object.entries(raw.screeningAnswers)) {
    if (!known.has(kind)) {
      throw new BackupError(`that backup answers a question this PageMyCV does not know: ${kind}`);
    }
    if (typeof answer !== 'string') throw new BackupError(`the answer for ${kind} should be text`);
    screeningAnswers[kind] = answer;
  }

  // Refused for the same reason importCv refuses: a restore replaces what is
  // there, so an empty file would be a wipe with nothing to show for it.
  if (!profile && work.length === 0 && education.length === 0 && !resume) {
    throw new BackupError('that backup is empty, so nothing was changed');
  }

  return {
    format: BACKUP_FORMAT,
    version: BACKUP_VERSION,
    exportedAt: typeof raw.exportedAt === 'string' ? raw.exportedAt : '',
    profile,
    contact,
    work,
    education,
    links,
    resume,
    screeningAnswers,
  };
}
