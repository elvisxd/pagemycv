import { describe, expect, it } from 'vitest';
import { atsForUrl } from '../../src/ats/registry';
import { classify } from '../../src/fill/detect';
import { honeypotReason } from '../../src/fill/honeypot';
import { buildPlan, chooseOption } from '../../src/fill/plan';
import { SENSITIVE_MATCHER_KEYS, sensitiveKeyFor } from '../../src/fill/sensitive-match';
import type { FieldDescriptor, FillValues, VisibilityMetrics } from '../../src/fill/types';
import { visibilityProblem } from '../../src/fill/visibility';
import { SENSITIVE_FIELDS } from '../../src/sensitive/registry';

const VISIBLE: VisibilityMetrics = {
  width: 220,
  height: 34,
  top: 120,
  left: 40,
  display: 'block',
  visibility: 'visible',
  opacity: '1',
  hiddenAttribute: false,
  detached: false,
  browserVisible: true,
  clipped: false,
  documentWidth: 1200,
  documentHeight: 3000,
};

let counter = 0;
function field(over: Partial<FieldDescriptor> = {}): FieldDescriptor {
  return {
    ref: `f${counter++}`,
    tag: 'input',
    type: 'text',
    name: '',
    id: '',
    autocomplete: '',
    label: '',
    placeholder: '',
    ariaLabel: '',
    automationId: '',
    required: false,
    hasValue: false,
    disabled: false,
    readOnly: false,
    options: [],
    metrics: VISIBLE,
    ...over,
  };
}

const LEVER = atsForUrl('https://jobs.lever.co/acme/1234');
const GREENHOUSE = atsForUrl('https://boards.greenhouse.io/acme/jobs/42');

function plan(fields: FieldDescriptor[], values: FillValues, ats = LEVER, resume?: string) {
  return buildPlan(fields, classify(fields, ats), values, ats, resume ?? null);
}

// ── The ATS registry ────────────────────────────────────────────────────────

describe('atsForUrl', () => {
  it('recognises both Greenhouse hosts, because missing one loses half the market', () => {
    expect(atsForUrl('https://boards.greenhouse.io/acme/jobs/1').id).toBe('greenhouse');
    expect(atsForUrl('https://job-boards.greenhouse.io/acme/jobs/1').id).toBe('greenhouse');
  });

  it('recognises Lever', () => {
    expect(atsForUrl('https://jobs.lever.co/acme/uuid/apply').id).toBe('lever');
  });

  it('is not fooled by a hostname that merely contains a known one', () => {
    expect(atsForUrl('https://jobs.lever.co.evil.test/acme').id).toBe('unknown');
    expect(atsForUrl('https://notjobs.lever.co.attacker.example/x').id).toBe('unknown');
  });

  it('accepts a real subdomain of a known host', () => {
    expect(atsForUrl('https://eu.jobs.lever.co/acme').id).toBe('lever');
  });

  it('rejects anything that is not http(s), and anything unparseable', () => {
    expect(atsForUrl('file:///tmp/jobs.lever.co/x').id).toBe('unknown');
    expect(atsForUrl('not a url').id).toBe('unknown');
  });
});

// ── The visibility gate ─────────────────────────────────────────────────────

describe('visibilityProblem', () => {
  it('passes an ordinary field', () => {
    expect(visibilityProblem(VISIBLE)).toBeNull();
  });

  const hidden: [string, Partial<VisibilityMetrics>][] = [
    ['display:none', { display: 'none' }],
    ['visibility:hidden', { visibility: 'hidden' }],
    ['visibility:collapse', { visibility: 'collapse' }],
    ['no layout box', { detached: true }],
    ['hidden attribute', { hiddenAttribute: true }],
    ['zero size', { width: 0, height: 0 }],
    ['one pixel', { width: 1, height: 1 }],
    ['three pixels, the size spam libraries use to dodge a 1px check', { width: 3, height: 3 }],
    ['transparent', { opacity: '0' }],
    ['almost transparent', { opacity: '0.01' }],
    [
      "an ANCESTOR with opacity:0, which the element's own style cannot show",
      { browserVisible: false },
    ],
    ['clipped to nothing by an ancestor', { clipped: true }],
    ['parked off the left edge', { left: -9999 }],
    ['parked above the top edge', { top: -9999 }],
    ['parked past the right of the document', { left: 5000 }],
  ];
  for (const [name, over] of hidden) {
    it(`refuses ${name}`, () => {
      expect(visibilityProblem({ ...VISIBLE, ...over })).not.toBeNull();
    });
  }

  it('fills a field below the fold, which is most of a long application', () => {
    // The distinction the whole rule turns on: scrolled out of view is normal,
    // parked outside the document is a trap.
    expect(visibilityProblem({ ...VISIBLE, top: 2400 })).toBeNull();
  });

  it('does not treat an unreadable opacity as transparent', () => {
    expect(visibilityProblem({ ...VISIBLE, opacity: '' })).toBeNull();
  });
});

// ── Honeypots ───────────────────────────────────────────────────────────────

describe('honeypotReason', () => {
  it("refuses Workday's beecatcher on any of the three attributes", () => {
    expect(honeypotReason(field({ name: 'beecatcher' }), true)).not.toBeNull();
    expect(honeypotReason(field({ id: 'beecatcher' }), true)).not.toBeNull();
    expect(honeypotReason(field({ automationId: 'beecatcher' }), true)).not.toBeNull();
  });

  it('refuses it however it is spelled, because the spelling is not the signal', () => {
    for (const name of ['bee_catcher', 'beeCatcher', 'bee-catcher', 'BEECATCHER']) {
      expect(honeypotReason(field({ name }), true), name).not.toBeNull();
    }
  });

  it('refuses a hidden `website`, which is the second Workday honeypot', () => {
    expect(honeypotReason(field({ name: 'website' }), false)).not.toBeNull();
  });

  it('allows a visible, labelled `website`, which is a real field on both boards', () => {
    expect(honeypotReason(field({ name: 'website', label: 'Website' }), true)).toBeNull();
  });

  it('still refuses a visible `website` with no label at all', () => {
    expect(honeypotReason(field({ name: 'website' }), true)).not.toBeNull();
  });

  it('does not refuse websiteUrl, where the word is only a substring', () => {
    expect(honeypotReason(field({ name: 'websiteUrl', label: 'Portfolio' }), true)).toBeNull();
  });

  it('refuses a field whose own label admits it is not for humans', () => {
    const f = field({
      name: 'extra_field',
      label: "This input is for robots only, do not enter if you're human.",
    });
    expect(honeypotReason(f, true)).not.toBeNull();
  });

  it('leaves an ordinary field alone', () => {
    expect(honeypotReason(field({ name: 'first_name', label: 'First name' }), true)).toBeNull();
  });
});

// ── The sensitive class ─────────────────────────────────────────────────────

describe('sensitiveKeyFor', () => {
  const cases: [string, string][] = [
    ['Are you legally authorized to work in the United States?', 'work_authorization_status'],
    ['Will you now or in the future require sponsorship?', 'requires_sponsorship'],
    ['Country of citizenship', 'citizenship'],
    ['When does your work authorization expire?', 'work_authorization_expiry'],
    ['Social Security Number', 'ssn'],
    ['National identity number', 'national_id'],
    ['Current salary', 'salary_current'],
    ['Expected salary', 'salary_expected'],
    ['Desired compensation', 'salary_expected'],
    ['Gender', 'gender'],
    ['Race / Ethnicity', 'race_ethnicity'],
    ['Are you Hispanic or Latino?', 'race_ethnicity'],
    ['Veteran status', 'veteran_status'],
    ['Disability status', 'disability_status'],
    ['Date of birth', 'date_of_birth'],
    ['Have you ever been convicted of a felony?', 'criminal_record'],
  ];
  for (const [label, key] of cases) {
    it(`reads "${label}" as ${key}`, () => {
      expect(sensitiveKeyFor(field({ label }))).toBe(key);
    });
  }

  it('reads the question out of a name attribute too, camelCase included', () => {
    expect(sensitiveKeyFor(field({ name: 'dateOfBirth' }))).toBe('date_of_birth');
    expect(sensitiveKeyFor(field({ name: 'requires_sponsorship' }))).toBe('requires_sponsorship');
  });

  it('leaves an ordinary field alone', () => {
    expect(sensitiveKeyFor(field({ label: 'First name' }))).toBeNull();
    expect(sensitiveKeyFor(field({ label: 'LinkedIn profile' }))).toBeNull();
  });

  it('does not read a gender pay gap blurb as a gender question', () => {
    expect(sensitiveKeyFor(field({ label: 'We publish our gender pay gap annually' }))).toBeNull();
  });

  it('names only keys the registry actually defines', () => {
    const known = new Set(SENSITIVE_FIELDS.map((f) => f.key));
    for (const key of SENSITIVE_MATCHER_KEYS) expect(known.has(key), key).toBe(true);
  });

  it('can reach every key in the registry, so none is stored and never recognised', () => {
    const reachable = new Set(SENSITIVE_MATCHER_KEYS);
    for (const f of SENSITIVE_FIELDS) expect(reachable.has(f.key), f.key).toBe(true);
  });
});

// ── Detection ───────────────────────────────────────────────────────────────

describe('classify', () => {
  it('takes the autocomplete token first, even behind section and billing tokens', () => {
    const fields = [field({ autocomplete: 'section-a billing given-name' })];
    const [c] = classify(fields, LEVER);
    expect(c?.kind).toBe('given_name');
    expect(c?.strategy).toBe('autocomplete');
    expect(c?.confidence).toBe(1);
  });

  it('ignores autocomplete="off" and "on", which are not field names', () => {
    for (const autocomplete of ['off', 'on']) {
      const [c] = classify([field({ autocomplete, label: 'Notes' })], LEVER);
      expect(c?.kind).toBeNull();
    }
  });

  it("uses Lever's own field names, which Chromium's patterns do not cover", () => {
    const fields = [field({ name: 'org', label: 'Current company' })];
    const [c] = classify(fields, LEVER);
    expect(c?.kind).toBe('current_employer');
  });

  it("maps Lever's link questions", () => {
    const [a, b] = classify(
      [field({ name: 'urls[LinkedIn]' }), field({ name: 'urls[GitHub]' })],
      LEVER,
    );
    expect(a?.kind).toBe('linkedin_url');
    expect(b?.kind).toBe('github_url');
  });

  it("maps Greenhouse's ids on both the legacy and the enveloped spelling", () => {
    const [a, b] = classify(
      [field({ id: 'first_name' }), field({ name: 'job_application[last_name]' })],
      GREENHOUSE,
    );
    expect(a?.kind).toBe('given_name');
    expect(b?.kind).toBe('family_name');
  });

  it("applies Chromium's patterns once a form has three distinct types", () => {
    const fields = [
      field({ label: 'First name' }),
      field({ label: 'Last name' }),
      field({ label: 'Email', type: 'email' }),
    ];
    const out = classify(fields, LEVER);
    expect(out.map((c) => c.kind)).toEqual(['given_name', 'family_name', 'email']);
    expect(out.every((c) => c.strategy === 'chromium')).toBe(true);
  });

  it('withholds them below three, so a lone search box is not an address', () => {
    // Chromium's own guard, replicated. Without it these heuristics fire on
    // the search field in a careers-page header.
    const fields = [field({ label: 'City' }), field({ label: 'Country' })];
    expect(classify(fields, LEVER).every((c) => c.kind === null)).toBe(true);
  });

  it('honours the negative half of a pattern', () => {
    // NAME_IGNORED covers `title`, scoped to the name kinds, so a job title
    // is not read as a person's name.
    const fields = [
      field({ label: 'Title' }),
      field({ label: 'Email', type: 'email' }),
      field({ label: 'City' }),
      field({ label: 'Postal code' }),
    ];
    const out = classify(fields, LEVER);
    expect(out[0]?.kind).not.toBe('full_name');
    expect(out[0]?.kind).not.toBe('given_name');
  });

  it('falls back to our own labels for the job-specific fields nobody else covers', () => {
    const cases: [string, string][] = [
      ['LinkedIn Profile', 'linkedin_url'],
      ['GitHub', 'github_url'],
      ['Portfolio', 'portfolio_url'],
      ['University', 'education_school'],
      ['Degree', 'education_degree'],
      ['Field of study', 'education_field'],
      ['Cover letter', 'cover_letter'],
      ['Résumé', 'resume_file'],
      ['How did you hear about us?', 'how_did_you_hear'],
    ];
    for (const [label, kind] of cases) {
      const [c] = classify([field({ label })], LEVER);
      expect(c?.kind, label).toBe(kind);
      expect(c?.strategy, label).toBe('label');
    }
  });

  it('leaves a question no pass understands unresolved rather than guessing', () => {
    const [c] = classify([field({ label: 'What is your favourite build tool?' })], LEVER);
    expect(c?.kind).toBeNull();
    expect(c?.strategy).toBeNull();
  });

  it('lets the sensitive class beat an autocomplete token', () => {
    // `bday` is a standards-blessed token for a field we refuse on purpose.
    const [c] = classify([field({ autocomplete: 'bday', label: 'Date of birth' })], LEVER);
    expect(c?.sensitiveKey).toBe('date_of_birth');
    expect(c?.kind).toBeNull();
  });

  it('lets the sensitive class beat Chromium, which is the dangerous collision', () => {
    // "Country of citizenship" matches Chromium's COUNTRY pattern exactly.
    // Without the sensitive pass running first, the planner would write the
    // user's country of residence into a citizenship question.
    const fields = [
      field({ label: 'Country of citizenship' }),
      field({ label: 'Email', type: 'email' }),
      field({ label: 'City' }),
      field({ label: 'First name' }),
    ];
    const [c] = classify(fields, LEVER);
    expect(c?.sensitiveKey).toBe('citizenship');
    expect(c?.kind).toBeNull();
  });
});

// ── Selects ─────────────────────────────────────────────────────────────────

describe('chooseOption', () => {
  const countries = [
    { value: '', text: 'Select…' },
    { value: 'US', text: 'United States' },
    { value: 'UM', text: 'United States Minor Outlying Islands' },
    { value: 'GB', text: 'United Kingdom' },
  ];

  it('prefers an exact value', () => {
    expect(chooseOption(countries, 'US')).toBe('US');
  });

  it('prefers an exact text over a longer one that merely starts the same', () => {
    expect(chooseOption(countries, 'United States')).toBe('US');
  });

  it('refuses an ambiguous prefix rather than picking one', () => {
    expect(chooseOption(countries, 'United')).toBeNull();
  });

  it('accepts an unambiguous prefix', () => {
    expect(chooseOption(countries, 'United King')).toBe('GB');
  });

  it('refuses an empty value', () => {
    expect(chooseOption(countries, '   ')).toBeNull();
  });
});

// ── The plan ────────────────────────────────────────────────────────────────

const VALUES: FillValues = {
  given_name: 'Elvis',
  family_name: 'Rey',
  full_name: 'Elvis Rey',
  email: 'e@example.test',
  phone: '+1 555 0100',
  city: 'Austin',
  region: 'TX',
  country: 'US',
  current_employer: 'Acme',
  current_title: 'Engineer',
  linkedin_url: 'https://linkedin.test/in/elvis',
};

describe('buildPlan', () => {
  it('fills what it recognises and records which pass found it', () => {
    const f = field({ name: 'email', type: 'email', label: 'Email' });
    const [row] = plan([f], VALUES).fields;
    expect(row?.action).toBe('fill');
    if (row?.action !== 'fill') throw new Error('expected a fill');
    expect(row.value).toBe('e@example.test');
    expect(row.strategy).toBe('ats');
  });

  it('never fills a sensitive field, and carries the registry reason across', () => {
    const f = field({ label: 'Expected salary' });
    const [row] = plan([f], { ...VALUES, current_title: 'Engineer' }).fields;
    if (row?.action !== 'skip') throw new Error('expected a skip');
    expect(row.reason).toBe('sensitive');
    expect(row.sensitiveKey).toBe('salary_expected');
    const registry = SENSITIVE_FIELDS.find((s) => s.key === 'salary_expected');
    expect(row.detail).toBe(registry?.reason);
  });

  it('refuses a honeypot before anything else looks at it', () => {
    const f = field({ name: 'beecatcher', label: 'First name' });
    const [row] = plan([f], VALUES).fields;
    if (row?.action !== 'skip') throw new Error('expected a skip');
    expect(row.reason).toBe('honeypot');
  });

  it('refuses a hidden field even when it is perfectly recognisable', () => {
    const f = field({ name: 'email', label: 'Email', metrics: { ...VISIBLE, width: 0 } });
    const [row] = plan([f], VALUES).fields;
    if (row?.action !== 'skip') throw new Error('expected a skip');
    expect(row.reason).toBe('hidden');
  });

  it('does not overwrite something already typed', () => {
    const f = field({ name: 'email', label: 'Email', hasValue: true });
    const [row] = plan([f], VALUES).fields;
    if (row?.action !== 'skip') throw new Error('expected a skip');
    expect(row.reason).toBe('already-filled');
  });

  it('treats an untouched select as empty, since its first option is its value', () => {
    const f = field({
      tag: 'select',
      type: 'select-one',
      name: 'country',
      autocomplete: 'country',
      label: 'Country',
      hasValue: false,
      options: [
        { value: '', text: 'Select…' },
        { value: 'US', text: 'United States' },
      ],
    });
    const [row] = plan([f], VALUES).fields;
    if (row?.action !== 'fill') throw new Error('expected a fill');
    expect(row.optionValue).toBe('US');
  });

  it('leaves a select alone when no option matches', () => {
    const f = field({
      tag: 'select',
      type: 'select-one',
      name: 'country',
      autocomplete: 'country',
      label: 'Country',
      options: [
        { value: '', text: 'Select…' },
        { value: 'FR', text: 'France' },
      ],
    });
    const [row] = plan([f], VALUES).fields;
    if (row?.action !== 'skip') throw new Error('expected a skip');
    expect(row.reason).toBe('no-value');
  });

  it('never writes a cover letter, even when it recognises the field', () => {
    const f = field({ tag: 'textarea', type: 'textarea', label: 'Cover letter' });
    const [row] = plan([f], { ...VALUES }).fields;
    if (row?.action !== 'skip') throw new Error('expected a skip');
    expect(row.reason).toBe('no-value');
  });

  it('attaches the resume rather than typing a path into the file input', () => {
    const f = field({ type: 'file', name: 'resume', label: 'Resume' });
    const [row] = plan([f], VALUES, LEVER, 'elvis-cv.pdf').fields;
    if (row?.action !== 'attach') throw new Error('expected an attach');
    expect(row.filename).toBe('elvis-cv.pdf');
  });

  it('says so plainly when no resume is stored', () => {
    const f = field({ type: 'file', name: 'resume', label: 'Resume' });
    const [row] = plan([f], VALUES).fields;
    if (row?.action !== 'skip') throw new Error('expected a skip');
    expect(row.detail).toMatch(/no resume file is stored/);
  });

  it('reports a sensitive radio group as sensitive, not as an unsupported widget', () => {
    // The ordering matters: a demographic question asked as a radio has to
    // reach the review list with the registry's reason on it.
    const f = field({ type: 'radio', label: 'Gender' });
    const [row] = plan([f], VALUES).fields;
    if (row?.action !== 'skip') throw new Error('expected a skip');
    expect(row.reason).toBe('sensitive');
  });

  it('refuses a disabled or read-only control', () => {
    const [a] = plan([field({ name: 'email', disabled: true })], VALUES).fields;
    const [b] = plan([field({ name: 'email', readOnly: true })], VALUES).fields;
    expect(a?.action === 'skip' && a.reason).toBe('unsupported');
    expect(b?.action === 'skip' && b.reason).toBe('unsupported');
  });

  it('writes nothing at all to a form that is entirely sensitive', () => {
    const fields = [
      field({ label: 'Gender' }),
      field({ label: 'Race / Ethnicity' }),
      field({ label: 'Veteran status' }),
      field({ label: 'Disability status' }),
      field({ label: 'Date of birth' }),
      field({ label: 'Social Security Number' }),
      field({ label: 'Expected salary' }),
      field({ label: 'Country of citizenship' }),
      field({ label: 'Have you ever been convicted of a felony?' }),
    ];
    const built = plan(fields, VALUES);
    expect(built.fields.every((f) => f.action === 'skip')).toBe(true);
    expect(built.fields.every((f) => f.action === 'skip' && f.reason === 'sensitive')).toBe(true);
  });

  it('carries a value for every field it claims to fill', () => {
    const fields = [
      field({ name: 'name', label: 'Full name' }),
      field({ name: 'email', type: 'email', label: 'Email' }),
      field({ name: 'phone', type: 'tel', label: 'Phone' }),
      field({ name: 'org', label: 'Current company' }),
      field({ name: 'urls[LinkedIn]', label: 'LinkedIn' }),
    ];
    const built = plan(fields, VALUES);
    const filled = built.fields.filter((f) => f.action === 'fill');
    expect(filled).toHaveLength(5);
    for (const f of filled) if (f.action === 'fill') expect(f.value.length).toBeGreaterThan(0);
  });
});
