// Which ATS a URL belongs to, and the field names that ATS uses.
//
// The maps here come from public documentation and public page source, not
// from a live session. docs/09-ats.md tracks which are verified. A map nobody
// probed is a hypothesis, so pass 3 is deliberately the third of four: it
// refines what the standards-based passes already found, and never carries a
// field on its own that the other passes could not reach.
import type { FieldKind, ListboxSelectors } from '../fill/types';

export type AtsId =
  | 'lever'
  | 'greenhouse'
  | 'ashby'
  | 'workday'
  | 'workable'
  | 'smartrecruiters'
  | 'jobvite'
  | 'unknown';

export interface AtsDefinition {
  id: AtsId;
  label: string;
  /**
   * Host patterns.
   *
   * `example.com` matches that host and its subdomains. A leading `*.`
   * matches subdomains ONLY, which is what Workday needs: every tenant is
   * `{tenant}.wd{n}.myworkdayjobs.com` and the bare apex is not an
   * application form.
   */
  hosts: readonly string[];
  /**
   * name / id / data-automation-id -> our field kind. Compared case
   * insensitively against the raw attribute, not against words, because these
   * are the exact strings the ATS emits.
   */
  fields: Readonly<Record<string, FieldKind>>;
  /**
   * How to drive this ATS's custom dropdowns, when it has any.
   *
   * Data rather than code because this is the unverified part: the selectors
   * below are modelled from documentation, not observed on a real tenant.
   * See src/fill/listbox.ts for why the split matters.
   */
  listbox?: ListboxSelectors;
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

const WORKDAY: AtsDefinition = {
  id: 'workday',
  label: 'Workday',
  // Every tenant gets its own subdomain under a numbered pod, so the host
  // cannot be enumerated. `*.myworkdaysite.com` is referenced in 09-ats.md
  // as an alternate candidate host and is deliberately NOT here: it could
  // not be confirmed, and an unconfirmed host widens where the content
  // script runs in exchange for nothing proven.
  hosts: ['*.myworkdayjobs.com'],
  fields: {
    // Workday's contract with its own tenants is `data-automation-id`, which
    // survives tenant skinning where name and id do not. detect.ts already
    // compares this map against the automation id as well as name and id.
    'formField-legalName--firstName': 'given_name',
    'formField-legalName--lastName': 'family_name',
    'formField-preferredName--firstName': 'preferred_name',
    'formField-addressLine1': 'address_line1',
    'formField-addressLine2': 'address_line2',
    'formField-city': 'city',
    'formField-postalCode': 'postal_code',
    'formField-countryRegion': 'country',
    'formField-phoneNumber': 'phone',
    'formField-email': 'email',
    email: 'email',
    'formField-source': 'how_did_you_hear',
    'file-upload-input-ref': 'resume_file',
    // NOT mapped, deliberately: every formField- in the voluntary
    // disclosures section. gender, hispanicOrLatino, ethnicity,
    // veteranStatus, disabilityStatus and the signature fields are the
    // sensitive class, and pass 0 refuses them before this map is consulted.
    // Naming them here could only ever weaken that.
  },
  // UNVERIFIED against a real tenant. Modelled on the description in
  // 09-ats.md: a button that opens a menu built on demand, whose options are
  // gone by the next task. The mechanism that drives these is tested; that
  // these are the right strings is not, and cannot be from here.
  listbox: {
    container: '[data-automation-id^="formField-"]',
    trigger: 'button[aria-haspopup="listbox"], [role="combobox"]',
    option: '[role="option"]',
    display: '[data-automation-id="selectedItem"], button[aria-haspopup="listbox"]',
  },
};

// The three below carry NO field map on purpose. Their hosts are documented
// in docs/09-ats.md; their forms are not, and a map written from guesswork
// is a hypothesis wearing the confidence score of a fact. With an empty map
// pass 2 contributes nothing and the standards-based passes — autocomplete,
// Chromium's patterns, our label rules — carry the form, which is exactly
// what happens on a site nobody has named. Declaring the host buys one thing:
// the content script is already there, so an application embedded in a
// company careers page fills without the person clicking the icon first.
const WORKABLE: AtsDefinition = {
  id: 'workable',
  label: 'Workable',
  hosts: ['apply.workable.com'],
  fields: {},
};

const SMARTRECRUITERS: AtsDefinition = {
  id: 'smartrecruiters',
  label: 'SmartRecruiters',
  hosts: ['careers.smartrecruiters.com', 'jobs.smartrecruiters.com'],
  fields: {},
};

const JOBVITE: AtsDefinition = {
  id: 'jobvite',
  label: 'Jobvite',
  hosts: ['jobs.jobvite.com'],
  fields: {},
};

export const ATS_DEFINITIONS: readonly AtsDefinition[] = [
  LEVER,
  GREENHOUSE,
  ASHBY,
  WORKDAY,
  WORKABLE,
  SMARTRECRUITERS,
  JOBVITE,
];

/**
 * Any site the list above does not name. It is a definition rather than a
 * refusal: an empty map means pass 2 has nothing to say and the other three
 * passes do the work, which is the same thing that happens on Workable. What
 * differs is only how the content script gets there — see src/fill/inject.ts.
 */
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
  if (pattern.startsWith('*.')) {
    // Subdomains only. Chrome's own `*.x` match pattern also matches bare
    // `x`, so the apex can be injected into; this returns `unknown` for it
    // and the roll call then refuses the page. Injecting somewhere we then
    // decline to act is the safe direction of that mismatch.
    const apex = pattern.slice(2);
    return host.endsWith(`.${apex}`);
  }
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
  // A `*.` pattern is already Chrome's own subdomain syntax, so it passes
  // through; a bare host is written as itself and matches that host alone.
  d.hosts.map((h) => `https://${h}/*`),
);

/**
 * The boards it knows, as a sentence, for the two places that tell somebody
 * which those are.
 *
 * Both of them were hand-written lists naming Lever and Greenhouse, and both
 * were still saying that after Ashby shipped — the refusal message, and the
 * panel's own "Open a Lever or Greenhouse application", which is on screen
 * while somebody tries to fill an Ashby form. One function rather than two
 * copies for the reason `normaliseText` exists: the duplicate that drifts is
 * always the one nobody is looking at.
 */
export function boardList(joiner: 'and' | 'or' = 'and'): string {
  const names = ATS_DEFINITIONS.map((d) => d.label);
  if (names.length === 0) return 'no boards yet';
  if (names.length === 1) return names[0] as string;
  return `${names.slice(0, -1).join(', ')} ${joiner} ${names[names.length - 1]}`;
}
