// Turning "what is this field" into "what, if anything, do we write".
//
// Pure, and deliberately the only place that decides. The content script does
// not choose: it receives a plan and executes it, so every refusal is visible
// in one list, testable without a browser, and countable in the gate.
import type { AtsDefinition } from '../ats/registry';
import { sensitiveByKey } from '../sensitive/registry';
import { honeypotReason } from './honeypot';
import type {
  Classification,
  DocumentKind,
  FieldDescriptor,
  FillPlan,
  FillValues,
  PlannedField,
  ScreeningAnswers,
  StoredFilenames,
} from './types';
import { documentFor, isScreeningKind } from './types';
import { visibilityProblem } from './visibility';

// There used to be a NEVER_AUTOFILL set here, holding `cover_letter`, and
// before that `notice_period` and `how_did_you_hear`. Each left it the same
// way: once there was a place for the person to put their own answer, the
// refusal became SCREENING_KINDS — fill from what they typed or not at all.
// The guarantee the set gave (never from the CV, never from a guess) is kept
// by the type: a screening kind cannot be satisfied from `values`.

/** What each document is called when it is missing, in the review list. */
const DOCUMENT_NAMES: Record<DocumentKind, string> = {
  resume: 'resume file',
  cover_letter: 'cover letter file',
};

const WRITABLE_TAGS: ReadonlySet<string> = new Set(['input', 'select', 'textarea']);

/**
 * Checkboxes and radios carry a value in their checked state rather than in
 * their text, and getting a radio group wrong means answering a question
 * differently from how the user would. Phase 2 does not write them. File
 * inputs are attached separately, as a File.
 */
const UNWRITABLE_INPUT_TYPES: ReadonlySet<string> = new Set([
  'checkbox',
  'radio',
  'file',
  'password',
  'hidden',
  'submit',
  'button',
  'reset',
  'image',
  'range',
  'color',
]);

function displayLabel(field: FieldDescriptor): string {
  const candidate = field.label || field.ariaLabel || field.placeholder || field.name || field.id;
  return candidate.trim().replace(/\s+/g, ' ').slice(0, 120) || '(unlabelled field)';
}

/**
 * Pick the option of a select that means `value`.
 *
 * Exact value, then exact text, then a prefix, then a containment — in that
 * order, because a select of countries contains both "United States" and
 * "United States Minor Outlying Islands" and the loose match must never win
 * over the exact one. Returns null rather than guessing when nothing is clear,
 * which leaves the field for the user.
 */
const MIN_LOOSE_MATCH = 3;

export function chooseOption(
  options: readonly { value: string; text: string }[],
  value: string,
): string | null {
  const want = value.trim().toLowerCase();
  if (!want) return null;
  const norm = (s: string) => s.trim().toLowerCase();

  for (const o of options) if (norm(o.value) === want) return o.value;
  for (const o of options) if (norm(o.text) === want) return o.value;

  // Below this, a prefix is a coincidence rather than a match: "US" is a
  // prefix of "Usually", and a country list is not the only list a form has.
  // An exact match on the value or the text above still handles a two-letter
  // code, which is the case that matters.
  if (want.length < MIN_LOOSE_MATCH) return null;

  const prefixed = options.filter((o) => norm(o.text).startsWith(want));
  if (prefixed.length === 1) return (prefixed[0] as { value: string }).value;

  const contained = options.filter((o) => norm(o.text).includes(want));
  if (contained.length === 1) return (contained[0] as { value: string }).value;

  return null;
}

export function buildPlan(
  fields: readonly FieldDescriptor[],
  classifications: readonly Classification[],
  values: FillValues,
  ats: AtsDefinition,
  /** Filenames only. The bytes never pass through the planner. */
  documents: StoredFilenames = {},
  /** Your own answers to the screening questions. See SCREENING_KINDS. */
  answers: ScreeningAnswers = {},
): FillPlan {
  const byRef = new Map(classifications.map((c) => [c.ref, c]));
  const planned: PlannedField[] = [];

  for (const field of fields) {
    const label = displayLabel(field);
    const skip = (
      reason: Extract<PlannedField, { action: 'skip' }>['reason'],
      detail: string,
      sensitiveKey?: string,
    ) => planned.push({ action: 'skip', ref: field.ref, label, reason, detail, sensitiveKey });

    // Order matters and is the order of the invariants. Visibility is computed
    // before the honeypot check because an ambiguous name like `website` is
    // released from the denylist only by being visible AND labelled.
    const hidden = visibilityProblem(field.metrics);
    const trap = honeypotReason(field, hidden === null);
    if (trap) {
      skip('honeypot', trap);
      continue;
    }
    if (hidden) {
      skip('hidden', hidden);
      continue;
    }

    if (field.disabled || field.readOnly) {
      skip('unsupported', field.disabled ? 'the field is disabled' : 'the field is read-only');
      continue;
    }
    const c = byRef.get(field.ref);

    // The sensitive branch comes before the control-type check on purpose: a
    // demographic question asked as a radio group must be reported with the
    // registry's reason, not dismissed as an unsupported widget.
    if (c?.sensitiveKey) {
      const definition = sensitiveByKey(c.sensitiveKey);
      // The registry's own wording, not a paraphrase. It is what the user
      // reads before deciding, every single time.
      skip(
        'sensitive',
        definition?.reason ?? 'this belongs to the sensitive class',
        c.sensitiveKey,
      );
      continue;
    }
    if (!c?.kind || !c.strategy) {
      skip('unrecognised', 'no pass recognised this field');
      continue;
    }

    const isFileInput = field.tag === 'input' && field.type === 'file';
    const document = documentFor(c.kind);
    // A cover letter can be asked for as a file or as a box to type in. The
    // file input attaches the stored file; the box is a screening kind and
    // falls through to the answer the person typed. A résumé is only ever a
    // file.
    if (c.kind === 'resume_file' || (document && isFileInput)) {
      // A file input takes a File, never a string. Typing a path into one
      // does nothing at all, which is why this is its own action rather than
      // a value lookup, and why it is decided before the writability check
      // that would otherwise reject every file input.
      if (!isFileInput || !document) {
        skip('unsupported', 'this asks for a resume but is not a file input');
        continue;
      }
      const filename = documents[document];
      if (!filename) {
        skip('no-value', `no ${DOCUMENT_NAMES[document]} is stored yet`);
        continue;
      }
      planned.push({
        action: 'attach',
        ref: field.ref,
        fingerprint: field.fingerprint,
        label,
        // Narrowed by `document` above: only these two kinds name a file.
        kind: c.kind === 'resume_file' ? 'resume_file' : 'cover_letter',
        strategy: c.strategy,
        confidence: c.confidence,
        filename,
      });
      continue;
    }

    if (!WRITABLE_TAGS.has(field.tag) || UNWRITABLE_INPUT_TYPES.has(field.type)) {
      skip('unsupported', `a ${field.type || field.tag} control is not filled in this phase`);
      continue;
    }
    // Screening kinds read from a different map on purpose. Provenance lives
    // in the type rather than in a convention: there is no way to satisfy one
    // of these from `values`, so no future edit to the CV parser can start
    // answering a question about you by inference.
    const screening = isScreeningKind(c.kind);
    const value = screening ? answers[c.kind] : values[c.kind];
    if (!value) {
      if (screening) {
        skip('unanswered', `you have not set your answer for ${c.kind.replace(/_/g, ' ')} yet`);
        continue;
      }
      skip('no-value', `nothing stored for ${c.kind.replace(/_/g, ' ')}`);
      continue;
    }
    if (field.hasValue) {
      // Somebody typed here, or the board prefilled it from a profile. Either
      // way it is not ours to overwrite.
      skip('already-filled', 'it already has a value');
      continue;
    }

    if (field.tag === 'select') {
      const optionValue = chooseOption(field.options, value);
      if (optionValue === null) {
        skip('no-value', `no option of this list matches "${value}"`);
        continue;
      }
      planned.push({
        action: 'fill',
        ref: field.ref,
        fingerprint: field.fingerprint,
        label,
        kind: c.kind,
        strategy: c.strategy,
        confidence: c.confidence,
        value,
        optionValue,
      });
      continue;
    }

    planned.push({
      action: 'fill',
      ref: field.ref,
      fingerprint: field.fingerprint,
      label,
      kind: c.kind,
      strategy: c.strategy,
      confidence: c.confidence,
      value,
    });
  }

  // Listboxes are planned by planListboxes, which needs the descriptors this
  // function never sees. Empty rather than optional, so a caller that
  // forgets them writes nothing instead of writing undefined.
  return { ats: ats.id, fields: planned, listboxes: [] };
}

/**
 * Whether this plan has anywhere to put a given document.
 *
 * Its bytes cross into the page's process only when the answer is yes. Most
 * application forms have one file input and many have none, and sending the
 * whole CV either way would undo the reason the plan is built in the
 * background rather than in the tab. Asked per document, so a form with a
 * résumé input and no cover-letter input receives the résumé and nothing else.
 */
export function planNeedsDocument(plan: FillPlan, document: DocumentKind): boolean {
  return plan.fields.some((f) => f.action === 'attach' && documentFor(f.kind) === document);
}

/** The documents a plan attaches, from those stored. */
export function documentsFor<T>(
  plan: FillPlan,
  stored: Partial<Record<DocumentKind, T>>,
): Partial<Record<DocumentKind, T>> {
  const out: Partial<Record<DocumentKind, T>> = {};
  for (const [kind, file] of Object.entries(stored) as [DocumentKind, T][]) {
    if (file && planNeedsDocument(plan, kind)) out[kind] = file;
  }
  return out;
}
