import { describe, expect, it } from 'vitest';
import { atsForUrl } from '../../src/ats/registry';
import { classify } from '../../src/fill/detect';
import type { FieldDescriptor, VisibilityMetrics } from '../../src/fill/types';

// What the classifier does on a site nobody has named: the per-ATS map is
// empty, so everything rests on autocomplete, Chromium's patterns and the
// label rules. These are the labels job forms commonly use, and each one is
// asserted against the kind it must land on — or, for the sensitive class,
// against being refused before any pass can claim it.

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
function field(over: Partial<FieldDescriptor>): FieldDescriptor {
  const base: FieldDescriptor = {
    ref: `g${counter++}`,
    fingerprint: '',
    tag: 'input',
    type: 'text',
    name: `made_up_${counter}`,
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
    trigger: null,
    ...over,
  };
  return { ...base, fingerprint: [base.tag, base.type, base.name, base.id].join('|') };
}

const UNKNOWN = atsForUrl('https://careers.some-company.test/jobs/42/apply');

/** A form large enough for Chromium's three-distinct-fields guard. */
const COMMON = [
  field({ label: 'First name' }),
  field({ label: 'Last name' }),
  field({ label: 'Email address', type: 'email' }),
  field({ label: 'Phone number', type: 'tel' }),
];

function kindOf(label: string, over: Partial<FieldDescriptor> = {}) {
  const probe = field({ label, ...over });
  const all = classify([...COMMON, probe], UNKNOWN);
  const last = all[all.length - 1];
  if (!last) throw new Error('classify returned nothing for the probe');
  return last;
}

describe('an unknown site is a definition, not a refusal', () => {
  it('resolves to an empty map rather than to nothing', () => {
    expect(UNKNOWN.id).toBe('unknown');
    expect(Object.keys(UNKNOWN.fields)).toEqual([]);
  });

  it('is what a declared board with no map resolves to as well', () => {
    expect(atsForUrl('https://apply.workable.com/acme/j/ABC/apply/').fields).toEqual({});
  });
});

describe('with no map, the labels carry the form', () => {
  it.each([
    ['First name', 'given_name'],
    ['Last name', 'family_name'],
    ['Email address', 'email'],
    ['Phone number', 'phone'],
    ['Current company', 'current_employer'],
    ['Job title', 'current_title'],
    ['LinkedIn profile', 'linkedin_url'],
    ['GitHub', 'github_url'],
    ['How did you hear about this position?', 'how_did_you_hear'],
    ['Cover letter', 'cover_letter'],
  ])('"%s" → %s', (label, kind) => {
    const c = kindOf(label);
    expect(c.kind).toBe(kind);
    expect(c.strategy).not.toBe('ats');
  });

  it('reads the autocomplete attribute ahead of everything', () => {
    const c = kindOf('Postcode', { autocomplete: 'postal-code' });
    expect(c.kind).toBe('postal_code');
    expect(c.strategy).toBe('autocomplete');
  });

  it('recognises a résumé upload by its label', () => {
    expect(kindOf('Resume', { type: 'file' }).kind).toBe('resume_file');
  });
});

describe('with no map, the refusals still come first', () => {
  it('a work-authorisation question is the sensitive class, not a country', () => {
    const c = kindOf('Are you legally authorized to work in the United States?', {
      tag: 'select',
      type: 'select-one',
      options: [
        { value: '', text: 'Select' },
        { value: 'yes', text: 'Yes' },
      ],
    });
    expect(c.sensitiveKey).toBe('work_authorization_status');
    expect(c.kind).toBeNull();
  });

  it('a question nothing recognises stays unrecognised rather than guessed', () => {
    const c = kindOf('What is your favourite programming language?');
    expect(c.kind).toBeNull();
    expect(c.sensitiveKey).toBeNull();
  });
});
