// Field detection, four passes, in order of how much evidence each one has.
//
//   0. The sensitive class, which vetoes everything below it
//   1. The autocomplete attribute — the page telling us, explicitly
//   2. Chromium's vendored patterns — the classifier Chrome runs in production
//   3. The per-ATS map — what this particular board names its fields
//   4. Our own label heuristics — the job-specific fields nobody else covers
//
// A field no pass resolves is left unresolved and reported as such. It is
// never guessed at: a wrong value typed into a real application is worse than
// an empty box the user fills themselves.
import type { AtsDefinition } from '../ats/registry';
import { CHROMIUM_PATTERNS } from './chromium-patterns.generated';
import { sensitiveKeyFor } from './sensitive-match';
import { normaliseText } from './text';
import type { Classification, FieldDescriptor, FieldKind, MatchStrategy } from './types';

// ── Pass 1: the autocomplete attribute ──────────────────────────────────────

/**
 * The tokens worth acting on. `bday`, `sex` and the payment tokens are
 * deliberately absent: the first two are sensitive and refused upstream, and
 * we hold no payment data to offer.
 */
const AUTOCOMPLETE: Readonly<Record<string, FieldKind>> = {
  'given-name': 'given_name',
  'family-name': 'family_name',
  name: 'full_name',
  nickname: 'preferred_name',
  email: 'email',
  tel: 'phone',
  'tel-national': 'phone',
  'street-address': 'address_line1',
  'address-line1': 'address_line1',
  'address-line2': 'address_line2',
  'address-level2': 'city',
  'address-level1': 'region',
  'postal-code': 'postal_code',
  country: 'country',
  'country-name': 'country',
  organization: 'current_employer',
  'organization-title': 'current_title',
  url: 'portfolio_url',
};

/**
 * The spec allows `section-* [shipping|billing] token [webauthn]`, so the
 * bare token can be anywhere in the list. Take the last one we recognise,
 * which is where the field name sits in every valid ordering.
 */
function fromAutocomplete(field: FieldDescriptor): FieldKind | null {
  const raw = field.autocomplete.trim().toLowerCase();
  if (!raw || raw === 'off' || raw === 'on') return null;
  const tokens = raw.split(/\s+/);
  for (let i = tokens.length - 1; i >= 0; i--) {
    const kind = AUTOCOMPLETE[tokens[i] as string];
    if (kind) return kind;
  }
  return null;
}

// ── Pass 2: Chromium's patterns ─────────────────────────────────────────────

/** Our descriptor's shape in Chromium's control-type vocabulary. */
function controlType(field: FieldDescriptor): string {
  if (field.tag === 'textarea') return 'TEXT_AREA';
  if (field.tag === 'select') {
    return field.type === 'select-multiple' ? 'SELECT_MULTIPLE' : 'SELECT_ONE';
  }
  switch (field.type) {
    case 'email':
      return 'INPUT_EMAIL';
    case 'tel':
      return 'INPUT_TELEPHONE';
    case 'number':
      return 'INPUT_NUMBER';
    case 'search':
      return 'INPUT_SEARCH';
    case 'password':
      return 'INPUT_PASSWORD';
    // `url`, `date` and the rest classify as text: Chromium's patterns were
    // written before those input types were common and list INPUT_TEXT for
    // fields that today are marked up more precisely.
    default:
      return 'INPUT_TEXT';
  }
}

/** Chromium matches LABEL against the label and NAME against name and id. */
function attributeText(field: FieldDescriptor, attribute: string): string {
  if (attribute === 'LABEL') {
    return `${field.label} ${field.ariaLabel} ${field.placeholder}`.toLowerCase();
  }
  if (attribute === 'NAME') return `${field.name} ${field.id}`.toLowerCase();
  return '';
}

function compile(source: string): RegExp | null {
  try {
    // Chromium's patterns are ICU regexes. The subset used here is compatible
    // with JavaScript's, lookbehind included, but a vendor bump could
    // introduce one that is not, and an exception thrown mid-fill would take
    // the whole pass down. A pattern that will not compile is skipped, and
    // patterns.test.ts fails the build if any of them are.
    return new RegExp(source, 'iu');
  } catch {
    return null;
  }
}

const CACHE = new Map<string, RegExp | null>();
function regex(source: string): RegExp | null {
  let found = CACHE.get(source);
  if (found === undefined) {
    found = compile(source);
    CACHE.set(source, found);
  }
  return found;
}

interface VariantLike {
  positive: string;
  negative: string | null;
  attributes: readonly string[];
  controls: readonly string[];
}

function variantMatches(field: FieldDescriptor, variant: VariantLike): boolean {
  if (variant.controls.length > 0 && !variant.controls.includes(controlType(field))) return false;
  const positive = regex(variant.positive);
  if (!positive) return false;
  const attributes = variant.attributes.length > 0 ? variant.attributes : ['LABEL', 'NAME'];
  for (const attribute of attributes) {
    const text = attributeText(field, attribute);
    if (!text.trim()) continue;
    if (!positive.test(text)) continue;
    // The negative half. Skipping it is the single most common way a
    // hand-rolled heuristic goes wrong.
    const negative = variant.negative ? regex(variant.negative) : null;
    if (negative?.test(text)) continue;
    return true;
  }
  return false;
}

function vetoed(field: FieldDescriptor, kind: FieldKind): boolean {
  for (const veto of CHROMIUM_PATTERNS.vetoes) {
    if (veto.scope && !veto.scope.includes(kind)) continue;
    if (veto.variants.some((v) => variantMatches(field, v))) return true;
  }
  return false;
}

function fromChromium(field: FieldDescriptor): FieldKind | null {
  for (const entry of CHROMIUM_PATTERNS.positives) {
    if (!entry.variants.some((v) => variantMatches(field, v))) continue;
    if (vetoed(field, entry.kind)) continue;
    return entry.kind;
  }
  return null;
}

/**
 * Chromium applies these heuristics only to a form with at least three fields
 * classified as distinct types. Without that guard they fire on a search box,
 * which is exactly the shape of a careers-page header. Replicated here on
 * purpose; see docs/09-ats.md.
 */
const CHROMIUM_MIN_DISTINCT = 3;

// ── Pass 3: the per-ATS map ─────────────────────────────────────────────────

/** Built once per form, not once per field: a long application has ~100. */
function atsTable(ats: AtsDefinition): Map<string, FieldKind> {
  return new Map(Object.entries(ats.fields).map(([k, v]) => [k.toLowerCase(), v]));
}

function fromAts(field: FieldDescriptor, table: Map<string, FieldKind>): FieldKind | null {
  for (const attr of [field.name, field.id, field.automationId]) {
    const hit = attr && table.get(attr.toLowerCase());
    if (hit) return hit;
  }
  return null;
}

// ── Pass 4: our own label heuristics ────────────────────────────────────────

/**
 * Only the job-specific fields. Every one of the 83 Chromium types was
 * checked: none covers work history, education, links or notice period, so
 * these are ours to carry and there is no point duplicating what pass 2
 * already does better.
 */
const LABEL_RULES: readonly { kind: FieldKind; pattern: RegExp; not?: RegExp }[] = [
  {
    // Chromium has no preferred-name type at all: `FULL_NAME` matches
    // `full.?name`, so "Preferred Full Name" was classified as the legal
    // name and filled with it. `NAME_IGNORED` covers `nickname` but not
    // `preferred`, so nothing vetoed it either. See SHARPER_THAN_CHROMIUM.
    kind: 'preferred_name',
    pattern:
      /\bpreferred\b[^.?]{0,20}\bname\b|\bnickname\b|\bgoes by\b|\bname you go by\b|\bwhat should we call you\b/,
    not: /\blegal\b/,
  },
  { kind: 'linkedin_url', pattern: /\blinked\s?in\b/ },
  { kind: 'github_url', pattern: /\bgit\s?hub\b|\bgitlab\b/ },
  {
    kind: 'portfolio_url',
    // `website` is here even though it is also a Workday honeypot. The two
    // are separated by evidence rather than by the word: honeypot.ts releases
    // it only when the field is both visible and labelled, and the planner
    // runs that check before it ever reaches this table.
    pattern:
      /\bportfolio\b|\bpersonal (site|website|page)\b|\bwebsite\b|\bblog\b|\bdribbble\b|\bbehance\b/,
  },
  {
    kind: 'current_title',
    pattern: /\b(current|present|most recent|latest)\b[^.?]{0,20}\b(job )?title\b|\b(job )?title\b/,
    // "Mr/Ms" and a posting's own title are both called "title".
    not: /\b(salutation|prefix|honorific|job posting|position applied|role applied)\b/,
  },
  {
    // BEFORE current_employer, and the ordering is the fix rather than a
    // preference. "How much notice would you need to give your current
    // employer before starting in this role?" contains the word `employer`,
    // and the broad alternative below matched it first: the box asking when
    // you can start was filled with the name of the company you work for.
    // The right value in the wrong box, which is the failure this project
    // treats as worse than a blank.
    //
    // Same convention sensitive-match.ts already states and this list did not
    // follow: narrow questions before broad ones.
    kind: 'notice_period',
    pattern:
      /\bnotice period\b|\bhow (much|long a?) notice\b|\bnotice (required|needed|to give)\b|\bavailable to start\b|\bstart date\b|\bavailability\b|\bhow soon can you start\b|\bwhen (can|could|would) you (be able to )?start\b|\bearliest (possible )?start\b/,
  },
  {
    kind: 'current_employer',
    pattern:
      /\b(current|present|most recent|latest)\b[^.?]{0,20}\b(employer|company|organi[sz]ation)\b|\bemployer\b/,
    // Belt as well as braces. Ordering alone is one careless reshuffle away
    // from putting the bug back, and this rule is the one with a bare
    // `employer` alternative that reaches into other people's questions.
    not: /\bnotice\b|\bwhen (can|could|would) you\b|\bhow soon\b|\bstart (date|ing)\b/,
  },
  { kind: 'education_school', pattern: /\b(school|universit\w+|college|institution|alma mater)\b/ },
  { kind: 'education_degree', pattern: /\bdegree\b|\bqualification\b/ },
  { kind: 'education_field', pattern: /\b(field of study|major|discipline|concentration)\b/ },
  {
    kind: 'cover_letter',
    pattern: /\bcover letter\b|\bmotivation\b|\bwhy (do you want|are you interested)\b/,
  },
  { kind: 'resume_file', pattern: /\b(resume|cv|curriculum vitae)\b/ },
  {
    kind: 'how_did_you_hear',
    pattern: /\bhow did you (hear|find|learn)\b|\breferr?al source\b|\bwhere did you (hear|find)\b/,
  },
  {
    // Ashby asks for the whole place in one box where the other two boards
    // ask for city and region separately.
    kind: 'location',
    pattern:
      /^location$|\b(your|current) location\b|\bwhere are you (based|located)\b|\bcity and (state|province|region|country)\b/,
    // A work-location preference is a different question, and so is the
    // posting's own location.
    not: /\b(preference|type|remote|hybrid|on ?site|willing|relocat\w+|job|role|office)\b/,
  },
  {
    kind: 'relocation_ok',
    pattern: /\brelocat\w+\b/,
  },
  {
    kind: 'travel_ok',
    pattern: /\btravel\b/,
    // The posting describes travel; the question asks whether you accept it.
    not: /\breimburse\w*\b|\bexpense\b/,
  },
  {
    kind: 'security_clearance',
    pattern: /\bsecurity clearance\b|\bclearance (level|status|with)\b|\bactive clearance\b/,
  },
];

/**
 * Kinds where OUR label rule beats Chromium's guess.
 *
 * Normally Chromium wins: its patterns carry a negative half that hand-rolled
 * heuristics forget, which is most of why they are vendored at all. This set
 * is for the cases where Chromium has no type for the question, so a broader
 * type of its own claims the field and is confidently wrong.
 *
 * `preferred_name` is the whole set today. Chromium's `FULL_NAME` matches
 * `full.?name`, so "Preferred Full Name" — which Ashby puts directly above
 * "Legal Full Name" — was classified as the legal name and filled with it.
 * `NAME_IGNORED` covers `nickname` but not `preferred`, so nothing vetoed it.
 *
 * Kept as an explicit list rather than a general rule: "our heuristic beats
 * the vendored one" is the wrong default, and every entry here should have to
 * justify itself the way this one does.
 */
const SHARPER_THAN_CHROMIUM: ReadonlySet<FieldKind> = new Set<FieldKind>(['preferred_name']);

function normalise(field: FieldDescriptor): string {
  return normaliseText(
    [field.label, field.ariaLabel, field.placeholder, field.name, field.id].join(' '),
  );
}

function fromLabel(field: FieldDescriptor): FieldKind | null {
  const text = normalise(field);
  if (!text) return null;
  for (const rule of LABEL_RULES) {
    if (!rule.pattern.test(text)) continue;
    if (rule.not?.test(text)) continue;
    return rule.kind;
  }
  return null;
}

// ── The classifier ──────────────────────────────────────────────────────────

const CONFIDENCE: Record<MatchStrategy, number> = {
  // The page said so in a standard attribute. Nothing beats that.
  autocomplete: 1,
  // The board's own field name, which is a contract with its integrators.
  ats: 0.9,
  // Chrome's production classifier, negatives included.
  chromium: 0.8,
  // Ours. Lowest, and shown as such.
  label: 0.6,
  sensitive: 1,
};

/**
 * One deviation from the pass order in docs/09-ats.md, which listed Chromium
 * second and the ATS map third: the map runs first of the two.
 *
 * An exact match on the field name a board documents to its own integrators is
 * stronger evidence than a regex over label text, and the confidence scores
 * below already say so. Leaving the order the other way round would have meant
 * a 0.8 guess pre-empting a 0.9 fact. No conflict was found between them on
 * either board — Lever's `org` is invisible to Chromium's COMPANY_NAME, which
 * wants the whole word `organization` — so this changes ranking, not results,
 * on everything probed so far.
 */
export function classify(fields: readonly FieldDescriptor[], ats: AtsDefinition): Classification[] {
  const out: Classification[] = [];
  const table = atsTable(ats);

  // Pass 2 is resolved for the whole form first, because its own guard is a
  // property of the form rather than of any one field.
  const chromiumGuesses = new Map<string, FieldKind>();
  for (const field of fields) {
    const kind = fromChromium(field);
    if (kind) chromiumGuesses.set(field.ref, kind);
  }
  const distinct = new Set(chromiumGuesses.values()).size;
  const chromiumApplies = distinct >= CHROMIUM_MIN_DISTINCT;

  for (const field of fields) {
    // Pass 0. Runs first and wins, always. See sensitive-match.ts for why
    // "Country of citizenship" makes this ordering load-bearing.
    const sensitiveKey = sensitiveKeyFor(field);
    if (sensitiveKey) {
      out.push({
        ref: field.ref,
        kind: null,
        sensitiveKey,
        strategy: 'sensitive',
        confidence: CONFIDENCE.sensitive,
      });
      continue;
    }

    let kind = fromAutocomplete(field);
    let strategy: MatchStrategy | null = kind ? 'autocomplete' : null;

    if (!kind) {
      const fromMap = fromAts(field, table);
      if (fromMap) {
        kind = fromMap;
        strategy = 'ats';
      }
    }
    // Resolved before the Chromium branch because it can override it, and
    // skipped entirely when a higher pass has already answered.
    const labelGuess = kind ? null : fromLabel(field);

    if (!kind && chromiumApplies) {
      const guess = chromiumGuesses.get(field.ref);
      if (guess && !(labelGuess && SHARPER_THAN_CHROMIUM.has(labelGuess))) {
        kind = guess;
        strategy = 'chromium';
      }
    }
    if (!kind && labelGuess) {
      kind = labelGuess;
      strategy = 'label';
    }

    out.push({
      ref: field.ref,
      kind,
      sensitiveKey: null,
      strategy,
      confidence: strategy ? CONFIDENCE[strategy] : 0,
    });
  }
  return out;
}

/** Exposed for the tests that pin the guard and the token table. */
export const DETECT_INTERNALS = {
  AUTOCOMPLETE,
  CHROMIUM_MIN_DISTINCT,
  LABEL_RULES,
  controlType,
};
