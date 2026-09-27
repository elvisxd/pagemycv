// Which ATS a URL belongs to, and the field names that ATS uses.
//
// The maps here come from public documentation and public page source, not
// from a live session. docs/09-ats.md tracks which are verified. A map nobody
// probed is a hypothesis, so pass 3 is deliberately the third of four: it
// refines what the standards-based passes already found, and never carries a
// field on its own that the other passes could not reach.
import type { FieldKind, ListboxSelectors } from '../fill/types';

export type AtsId = 'lever' | 'greenhouse' | 'workday' | 'unknown';

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

export const ATS_DEFINITIONS: readonly AtsDefinition[] = [LEVER, GREENHOUSE, WORKDAY];

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
