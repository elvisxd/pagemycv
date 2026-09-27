// The questions a CV cannot answer, and the two bugs that finding them
// exposed in code that was already shipped.
//
// Every label below is copied verbatim from a real Ashby application, which
// is why they are worth keeping: they are not what I imagined a form asks,
// they are what one actually asked.
import { describe, expect, it } from 'vitest';
import { ATS_DEFINITIONS, atsForUrl } from '../../src/ats/registry';
import { classify } from '../../src/fill/detect';
import { buildPlan } from '../../src/fill/plan';
import type {
  Classification,
  FieldDescriptor,
  FillValues,
  ScreeningAnswers,
} from '../../src/fill/types';
import { isScreeningKind, SCREENING_KINDS } from '../../src/fill/types';

const ASHBY = atsForUrl('https://jobs.ashbyhq.com/npx/abc/application');

function field(label: string, over: Partial<FieldDescriptor> = {}): FieldDescriptor {
  return {
    ref: 'f0',
    fingerprint: 'input|text||',
    tag: 'input',
    type: 'text',
    name: '',
    id: '',
    automationId: '',
    label,
    ariaLabel: '',
    placeholder: '',
    autocomplete: '',
    required: false,
    disabled: false,
    readOnly: false,
    hasValue: false,
    options: [],
    metrics: {
      detached: false,
      display: 'block',
      visibility: 'visible',
      opacity: '1',
      hiddenAttribute: false,
      browserVisible: true,
      clipped: false,
      width: 200,
      height: 30,
      top: 100,
      left: 20,
      documentWidth: 1200,
      documentHeight: 3000,
    },
    ...over,
  };
}

const VALUES: FillValues = {
  given_name: 'Ada',
  family_name: 'M. Lovelace',
  full_name: 'Ada M. Lovelace',
  email: 'ada@lovelace.test',
  phone: '+1 407 555 0142',
  city: 'Orlando',
  region: 'Florida',
  current_employer: 'Nesty C.A.',
};

/**
 * One field through the whole path, in a form-shaped context.
 *
 * The companions are not padding. Chromium applies its heuristics only to a
 * form with at least three distinctly-classified fields, and detect.ts
 * replicates that guard on purpose — so a single field in isolation never
 * reaches the Chromium pass at all, and a test written that way would be
 * exercising a code path no real form takes. The first version of this file
 * did exactly that and reported "Legal Full Name" as unclassified.
 */
const COMPANIONS = ['Email', 'First name', 'City'] as const;

function decide(label: string, answers: ScreeningAnswers = {}, values: FillValues = VALUES) {
  const target = field(label, { ref: 'target' });
  const form = [target, ...COMPANIONS.map((l, i) => field(l, { ref: `c${i}` }))];
  const cls: Classification[] = classify(form, ASHBY);
  const plan = buildPlan(form, cls, values, ASHBY, null, answers);
  const row = plan.fields.find((f) => f.ref === 'target');
  const c = cls.find((x) => x.ref === 'target');
  if (!row) throw new Error('no plan row');
  return { row, kind: c?.kind ?? null, sensitiveKey: c?.sensitiveKey ?? null };
}

describe('the notice-period bug', () => {
  const LABEL =
    'How much notice would you need to give your current employer before starting in this role?';

  it('does NOT write the employer name into the notice box', () => {
    // The bug, exactly. The label contains "current employer", the broad
    // `\bemployer\b` alternative matched it first, and the box asking when
    // you can start was filled with the name of the company you work for.
    const { row, kind } = decide(LABEL, { notice_period: '1 month' });
    expect(kind).toBe('notice_period');
    if (row.action !== 'fill') throw new Error(`expected a fill, got ${row.action}`);
    expect(row.value).toBe('1 month');
    expect(row.value).not.toBe('Nesty C.A.');
  });

  it('still recognises a real current-employer question', () => {
    // The fix must not be a blanket refusal of the word.
    const { row, kind } = decide('Current employer');
    expect(kind).toBe('current_employer');
    if (row.action !== 'fill') throw new Error('expected a fill');
    expect(row.value).toBe('Nesty C.A.');
  });

  it.each([
    'Notice period',
    'How soon can you start?',
    'When could you start?',
    'Earliest possible start date',
  ])('reads "%s" as the notice question', (label) => {
    expect(decide(label, { notice_period: '2 weeks' }).kind).toBe('notice_period');
  });
});

describe('preferred name versus legal name', () => {
  it('fills the preferred box with the preferred name', () => {
    // Chromium has no preferred-name type; its FULL_NAME pattern matches
    // `full.?name`, so this box got the legal name. Ashby puts the two
    // directly above each other, which is how it was noticed.
    const { row, kind } = decide('Preferred Full Name', { preferred_name: 'Ada' });
    expect(kind).toBe('preferred_name');
    if (row.action !== 'fill') throw new Error('expected a fill');
    expect(row.value).toBe('Ada');
  });

  it('leaves the legal box to the legal name', () => {
    const { row, kind } = decide('Legal Full Name');
    expect(kind).toBe('full_name');
    if (row.action !== 'fill') throw new Error('expected a fill');
    expect(row.value).toBe('Ada M. Lovelace');
  });
});

describe('the sensitive class, on a real form', () => {
  it.each([
    ['Are you legally eligible to work in Canada?', 'work_authorization_status'],
    [
      'Will you now or in the future require sponsorship for employment visa status to work in Canada?',
      'requires_sponsorship',
    ],
    ['Pronouns', 'gender'],
    ['What are you looking for as a base salary?', 'salary_expected'],
  ])('refuses "%s" as %s', (label, key) => {
    const { row, sensitiveKey } = decide(label);
    expect(sensitiveKey).toBe(key);
    if (row.action !== 'skip') throw new Error('expected a skip');
    expect(row.reason).toBe('sensitive');
  });

  it('a salary question is refused BY THE REGISTRY, not by having no value', () => {
    // It used to come back "unrecognised": not filled, but only because the
    // vault held no number. Protected by accident rather than by design, and
    // the person never saw the reason the registry exists to give them.
    const { row } = decide(
      'What are you looking for as a base salary?',
      {},
      {
        ...VALUES,
        // Even if some future path produced one.
        current_employer: 'Nesty C.A.',
      },
    );
    if (row.action !== 'skip') throw new Error('expected a skip');
    expect(row.reason).toBe('sensitive');
    expect(row.detail).toMatch(/first number spoken/i);
  });
});

describe('screening answers', () => {
  it('fills only from an answer you gave', () => {
    const { row } = decide('Notice period', { notice_period: '2 weeks' });
    if (row.action !== 'fill') throw new Error('expected a fill');
    expect(row.value).toBe('2 weeks');
  });

  it('says you have not answered yet, rather than "skipped"', () => {
    const { row } = decide('Notice period', {});
    if (row.action !== 'skip') throw new Error('expected a skip');
    expect(row.reason).toBe('unanswered');
    expect(row.detail).toMatch(/have not set your answer/i);
  });

  it('cannot be satisfied from the CV values, only from answers', () => {
    // The guarantee the old outright refusal gave, kept by a better route.
    // Putting a notice period in the CV-derived map must change nothing.
    const sneaked = { ...VALUES, notice_period: 'immediately' } as FillValues;
    const { row } = decide('Notice period', {}, sneaked);
    if (row.action !== 'skip') throw new Error('expected a skip');
    expect(row.reason).toBe('unanswered');
  });

  it.each([
    ['Are you comfortable with the travel requirements listed in the job posting?', 'travel_ok'],
    ['Which utility do you have an active security clearance with?', 'security_clearance'],
    ['Are you willing to relocate?', 'relocation_ok'],
  ])('recognises "%s" as %s', (label, kind) => {
    expect(decide(label).kind).toBe(kind);
  });

  it('every screening kind is one the planner treats as answer-only', () => {
    for (const kind of SCREENING_KINDS) expect(isScreeningKind(kind)).toBe(true);
  });
});

describe('Ashby', () => {
  it('is matched by host, and only its own host', () => {
    expect(atsForUrl('https://jobs.ashbyhq.com/npx/x/application').id).toBe('ashby');
    // The suffix check is anchored on a dot, so a longer hostname cannot
    // borrow the name.
    expect(atsForUrl('https://jobs.ashbyhq.com.evil.test/x').id).toBe('unknown');
  });

  it('is declared in the content-script matches, so the script actually runs there', () => {
    const ashby = ATS_DEFINITIONS.find((d) => d.id === 'ashby');
    expect(ashby?.hosts).toContain('jobs.ashbyhq.com');
  });
});

describe('preferred name is never inferred', () => {
  it('stays empty when you have not set one, even though the CV has a first name', () => {
    // The tempting fix was to default it to the given name. It is the wrong
    // fix: a "Preferred Name" box exists because the answer may differ from
    // the legal one, and filling it from the legal name fails exactly the
    // people the field is there for.
    const { row } = decide('Preferred Full Name', {}, { ...VALUES, given_name: 'Ada' });
    if (row.action !== 'skip') throw new Error(`expected a skip, got ${row.action}`);
    expect(row.reason).toBe('unanswered');
  });
});

describe('the refusal message names every board it supports', () => {
  it('has a label for each definition, so the message can name them all', () => {
    // The message in background.ts is built from these. It used to be a
    // hand-written sentence naming two boards; Ashby was added and the
    // sentence was not, so the extension told people it did not support a
    // board it had just started supporting — in the one place somebody
    // looks when a fill does not work.
    for (const def of ATS_DEFINITIONS) {
      expect(def.label.trim()).not.toBe('');
      expect(def.hosts.length).toBeGreaterThan(0);
    }
    expect(ATS_DEFINITIONS.map((d) => d.label)).toEqual(
      expect.arrayContaining(['Lever', 'Greenhouse', 'Ashby', 'Workday']),
    );
  });
});
