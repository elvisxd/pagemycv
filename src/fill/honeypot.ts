// Layer one of two. See docs/03-security.md, invariant 3.
//
// A honeypot is a field a human never sees and a bot fills anyway. Workday
// ships one called `beecatcher`, labelled "This input is for robots only, do
// not enter if you're human." Writing to it flags the application as
// automated, and nothing tells you.
//
// This list is not the defence. The defence is visibility.ts, because the next
// honeypot will not be called `beecatcher`. This list exists for the case that
// gate misses: a trap that is genuinely visible and simply asks you not to
// fill it.
import type { FieldDescriptor } from './types';

/**
 * Matched whole-word against name, id and the automation id.
 *
 * Substring matching would be wrong in both directions: `website` as a
 * substring hits `websiteUrl`, a real field on several boards, while a
 * honeypot named `bee_catcher` slips past an exact-string check. Whole words,
 * split on the separators these attributes actually use.
 */
const DENIED_WORDS: readonly string[] = [
  'beecatcher',
  'bee',
  'catcher',
  // Workday's second honeypot. Named the same as a legitimate field elsewhere,
  // which is the point of it; see `PERMITTED_WHEN_LABELLED` below.
  'website',
  // Seen across form-spam libraries. Cheap to add, no legitimate collision.
  'honeypot',
  'honigtopf',
  'winnie',
  'leaveblank',
  'donotfill',
  'nofill',
  'bottrap',
  'spamtrap',
  'confirm_email_address_secondary',
];

/**
 * `website` is a real, wanted field on Lever and Greenhouse, where it is
 * labelled and visible. It is a honeypot on Workday, where it is not. Rather
 * than guess from the ATS, require the evidence that separates them: a
 * honeypot has no visible label, because a label would warn a human.
 *
 * A field on this list is released from the denylist only when it carries a
 * label AND passes the visibility gate. Both, never one.
 */
const PERMITTED_WHEN_LABELLED: ReadonlySet<string> = new Set(['website']);

const SEPARATORS = /[^a-z0-9]+/;

function words(value: string): string[] {
  return value
    .toLowerCase()
    .replace(/([a-z])([A-Z])/g, '$1 $2')
    .split(SEPARATORS)
    .filter(Boolean);
}

/** Every word in every attribute a honeypot is identified by. */
function attributeWords(field: FieldDescriptor): Set<string> {
  const out = new Set<string>();
  for (const attr of [field.name, field.id, field.automationId]) {
    // camelCase is split too: Workday writes `data-automation-id="beeCatcher"`.
    for (const w of words(attr.replace(/([a-z0-9])([A-Z])/g, '$1 $2'))) out.add(w);
  }
  return out;
}

/**
 * The reason this field must never be written to, or null.
 *
 * `visible` is passed in rather than recomputed so the caller decides the
 * order: the visibility gate runs first, and its answer is what releases an
 * ambiguous name like `website`.
 */
export function honeypotReason(field: FieldDescriptor, visible: boolean): string | null {
  const found = attributeWords(field);
  for (const word of DENIED_WORDS) {
    if (!found.has(word)) continue;
    if (PERMITTED_WHEN_LABELLED.has(word) && visible && field.label.trim() !== '') continue;
    return `matched the honeypot denylist on "${word}"`;
  }
  // A field whose own label admits it. Workday's says so in English, and a
  // trap that announces itself is the easiest one to respect.
  const label = `${field.label} ${field.ariaLabel} ${field.placeholder}`.toLowerCase();
  if (/robots? only|do not enter if you|leave (this )?(field )?blank|not for humans/.test(label)) {
    return "the field's own label says it is not for humans";
  }
  return null;
}

/** Exposed for the tests and for docs/09-ats.md to stay honest about the list. */
export const HONEYPOT_WORDS = DENIED_WORDS;
