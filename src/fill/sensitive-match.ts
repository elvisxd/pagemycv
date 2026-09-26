// Recognising a sensitive question on a form, which is a different problem
// from storing one. src/sensitive/registry.ts owns what the class IS and why;
// this owns how it is spotted in the wild.
//
// It runs BEFORE all four detection passes, and it wins. That ordering is the
// whole point rather than a detail: "Country of citizenship" matches
// Chromium's COUNTRY pattern exactly, and without this running first the
// planner would cheerfully write the user's country of residence into a
// citizenship question. Same for `autocomplete="bday"`, which is a
// standards-blessed token for a field we refuse on purpose.
import { isSensitiveKey } from '../sensitive/registry';
import { normaliseText } from './text';
import type { FieldDescriptor } from './types';

interface Matcher {
  key: string;
  /** Any of these in the combined text is enough. */
  pattern: RegExp;
  /** Unless one of these is too, which means the question is a different one. */
  except?: RegExp;
}

/**
 * Ordered: the first match wins, so the narrow questions come before the broad
 * ones. `salary_expected` before `salary_current` would be wrong the other way
 * round, and `work_authorization_expiry` has to beat the status question whose
 * wording it shares.
 */
const MATCHERS: readonly Matcher[] = [
  {
    key: 'date_of_birth',
    pattern:
      /\b(date of birth|birth ?date|birthday|d\.?o\.?b\.?|year of birth)\b|\bbday\b|\bare you (at least|over) \d+\b|\b(18|21) (years )?(of age|or older)\b/,
  },
  {
    key: 'ssn',
    pattern: /\bs\.?s\.?n\.?\b|\bsocial security\b|\bsoc(ial)? sec\b/,
  },
  {
    key: 'national_id',
    pattern:
      /\bnational (id|identity|identification)\b|\bgovernment (issued )?id\b|\bpassport (number|no)\b|\bdriver'?s? licen[cs]e\b|\btax (id|identification)\b|\bcurp\b|\bcedula\b/,
  },
  {
    key: 'work_authorization_expiry',
    // Narrower than the status question below and shares its vocabulary, so it
    // has to be tested first.
    pattern:
      /\b(work (authorization|authorisation|permit)|visa|ead|sponsorship)\b[^.?]{0,40}\b(expir\w*|valid (until|through)|end date)\b|\b(expir\w*|valid (until|through))\b[^.?]{0,40}\b(work (authorization|authorisation|permit)|visa|ead)\b/,
  },
  {
    key: 'requires_sponsorship',
    pattern:
      /\bsponsor(ship)?\b|\bwill you (now or in the future )?require\b|\bneed (visa |immigration )?sponsorship\b/,
  },
  {
    key: 'citizenship',
    pattern: /\bcitizen(ship)?\b|\bnationality\b|\bcountry of (citizenship|origin|nationality)\b/,
  },
  {
    key: 'work_authorization_status',
    pattern:
      /\b(work (authorization|authorisation|permit|status|eligibility))\b|\bauthori[sz]ed to work\b|\blegally (able|entitled|eligible) to work\b|\bright to work\b|\bvisa (type|status|category)\b|\bimmigration status\b|\bwork eligibility\b/,
  },
  {
    key: 'salary_expected',
    pattern:
      /\b(expected|desired|target|requested)\b[^.?]{0,20}\b(salary|compensation|pay|rate|remuneration)\b|\bsalary (expectation|requirement)s?\b|\bcompensation expectation\b/,
  },
  {
    key: 'salary_current',
    pattern:
      /\b(current|present|existing|last)\b[^.?]{0,20}\b(salary|compensation|pay|rate|remuneration|ctc)\b|\bsalary history\b/,
  },
  {
    key: 'race_ethnicity',
    // Before `gender`, because a combined "Race / Gender" heading should be
    // treated as the more identifying of the two.
    pattern: /\b(race|ethnicit\w+|hispanic|latino|latina|latinx)\b/,
  },
  {
    key: 'veteran_status',
    pattern: /\bveteran\b|\bmilitary service\b|\bprotected veteran\b|\buniformed service\b/,
  },
  {
    key: 'disability_status',
    pattern: /\bdisabilit\w+\b|\bdisabled\b|\bsection 503\b|\bself.?identif\w* .{0,20}disab/,
  },
  {
    key: 'gender',
    pattern: /\bgender\b|\bsex\b|\bpronouns?\b/,
    // "Gender pay gap" is prose in a policy blurb, not a question being asked.
    except: /\bpay gap\b/,
  },
  {
    key: 'criminal_record',
    pattern:
      /\b(criminal|convict\w+|felony|felonies|misdemean\w+|offen[cs]e)\b|\bbackground check\b|\bever been (arrested|charged|convicted)\b/,
  },
];

/** Everything on a control that could carry the question's wording. */
function haystack(field: FieldDescriptor): string {
  return normaliseText(
    [
      field.label,
      field.ariaLabel,
      field.placeholder,
      field.name,
      field.id,
      field.automationId,
    ].join(' '),
  );
}

/**
 * The registry key of the sensitive question this field asks, or null.
 *
 * Returns a key rather than a boolean because the panel shows the registry's
 * reason for that specific key, and a generic "this looked sensitive" would
 * make the confirmation step meaningless.
 */
export function sensitiveKeyFor(field: FieldDescriptor): string | null {
  const text = haystack(field);
  if (!text) return null;
  for (const m of MATCHERS) {
    if (!m.pattern.test(text)) continue;
    if (m.except?.test(text)) continue;
    // A matcher naming a key the registry does not have would fail silently
    // as a field that is skipped with no reason to show.
    if (!isSensitiveKey(m.key)) throw new Error(`no registry entry for sensitive key ${m.key}`);
    return m.key;
  }
  return null;
}

/** Exposed so a test can assert every registry key is reachable from a form. */
export const SENSITIVE_MATCHER_KEYS: readonly string[] = MATCHERS.map((m) => m.key);
