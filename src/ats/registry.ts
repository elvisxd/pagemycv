// Which ATS a URL belongs to, and the field names that ATS uses.
//
// The maps here come from public documentation and public page source, not
// from a live session. docs/09-ats.md tracks which are verified. A map nobody
// probed is a hypothesis, so pass 3 is deliberately the third of four: it
// refines what the standards-based passes already found, and never carries a
// field on its own that the other passes could not reach.
import type { FieldKind } from '../fill/types';

export type AtsId = 'lever' | 'greenhouse' | 'ashby' | 'unknown';

export interface AtsDefinition {
  id: AtsId;
  label: string;
  /** Host patterns, matched exactly or as a suffix after a leading dot. */
  hosts: readonly string[];
  /**
   * name / id / data-automation-id -> our field kind. Compared case
   * insensitively against the raw attribute, not against words, because these
   * are the exact strings the ATS emits.
   */
  fields: Readonly<Record<string, FieldKind>>;
}

const LEVER: AtsDefinition = {
  id: 'lever',
  label: 'Lever',
  hosts: ['jobs.lever.co'],
  fields: {
    // Lever posts a flat form; the name attribute is the contract.
    name: 'full_name',
    email: 'email',
    phone: 'phone',
    org: 'current_employer',
    resume: 'resume_file',
    'urls[LinkedIn]': 'linkedin_url',
    'urls[GitHub]': 'github_url',
    'urls[Portfolio]': 'portfolio_url',
    'urls[Other]': 'other_url',
    comments: 'cover_letter',
  },
};

const GREENHOUSE: AtsDefinition = {
  id: 'greenhouse',
  label: 'Greenhouse',
  // Both hosts. boards.greenhouse.io is the legacy board and
  // job-boards.greenhouse.io is the current one; missing either loses half
  // the market. The embed host used in Phase 3 is the same origin.
  hosts: ['boards.greenhouse.io', 'job-boards.greenhouse.io'],
  fields: {
    first_name: 'given_name',
    last_name: 'family_name',
    email: 'email',
    phone: 'phone',
    resume: 'resume_file',
    cover_letter: 'cover_letter',
    // The current board renders the same fields under a job_application[…]
    // envelope, so both spellings have to be here.
    'job_application[first_name]': 'given_name',
    'job_application[last_name]': 'family_name',
    'job_application[email]': 'email',
    'job_application[phone]': 'phone',
  },
};

const ASHBY: AtsDefinition = {
  id: 'ashby',
  label: 'Ashby',
  // One host for every company: jobs.ashbyhq.com/{company}/{jobId}/application.
  // Ashby also embeds itself in company careers pages, which Phase 3 already
  // handles — the embed's origin is this one, and that is the whole grant.
  hosts: ['jobs.ashbyhq.com'],
  // Deliberately thin. Ashby renders a React form whose `name` attributes are
  // generated per job rather than fixed the way Lever's and Greenhouse's are,
  // so a map keyed on them would be a hypothesis with a short shelf life.
  // What IS stable is the visible label — "Preferred Full Name", "Legal Full
  // Name" — and the label heuristics read exactly that. The few entries here
  // are the ones seen in page source; the rest is carried by passes 1 and 4.
  fields: {
    _systemfield_name: 'full_name',
    _systemfield_email: 'email',
    _systemfield_phone: 'phone',
    _systemfield_resume: 'resume_file',
  },
};

export const ATS_DEFINITIONS: readonly AtsDefinition[] = [LEVER, GREENHOUSE, ASHBY];

const UNKNOWN: AtsDefinition = {
  id: 'unknown',
  label: 'this page',
  hosts: [],
  fields: {},
};

/**
 * Host match, not substring match. `jobs.lever.co.evil.test` contains
 * "jobs.lever.co" and is not Lever; a suffix check anchored on a dot is the
 * only comparison that cannot be spoofed by a longer hostname.
 */
function hostMatches(hostname: string, pattern: string): boolean {
  const host = hostname.toLowerCase();
  return host === pattern || host.endsWith(`.${pattern}`);
}

export function atsForUrl(url: string): AtsDefinition {
  let hostname: string;
  try {
    const parsed = new URL(url);
    // http: and https: only. A file: or chrome-extension: URL reaching here
    // would mean the content script ran somewhere it was not meant to.
    if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') return UNKNOWN;
    hostname = parsed.hostname;
  } catch {
    return UNKNOWN;
  }
  for (const def of ATS_DEFINITIONS) {
    if (def.hosts.some((h) => hostMatches(hostname, h))) return def;
  }
  return UNKNOWN;
}

/** The manifest's content-script matches, derived from the same list. */
export const CONTENT_MATCHES: readonly string[] = ATS_DEFINITIONS.flatMap((d) =>
  d.hosts.map((h) => `https://${h}/*`),
);
