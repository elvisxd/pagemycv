// Custom listboxes: the ones that are not a <select>.
//
// Workday renders its dropdowns as a button plus a menu built on demand, and
// 09-ats.md records that the menu is gone by the next task — so the open, the
// read and the click have to happen in ONE synchronous pass. That constraint
// is architectural: a fill path that awaits between opening and choosing
// cannot be retrofitted into one that does not.
//
// So the split here is deliberate. The MECHANISM is code and is testable:
// that a single synchronous pass can open a menu, read its options and pick
// one. The SELECTORS are data on the ATS definition, because they are the
// part nobody has verified against a real tenant — spikes/phase-4 models
// them from the documentation rather than observing them. When somebody
// finally opens a real Workday application, only the data should need to
// change.
import type { AtsDefinition } from '../ats/registry';
import { chooseOption } from './plan';
import type { FieldKind, ListboxAction, ListboxDescriptor, ListboxSkip } from './types';

/**
 * What to do with each listbox, decided before anything is opened.
 *
 * Pure, so the decision can be tested exhaustively; opening a menu is the
 * caller's problem and happens in one synchronous burst per field.
 */
export function planListboxes(
  boxes: readonly ListboxDescriptor[],
  values: Readonly<Partial<Record<FieldKind, string>>>,
  ats: AtsDefinition,
): ListboxAction[] {
  const map = new Map(Object.entries(ats.fields).map(([k, v]) => [k.toLowerCase(), v]));
  return boxes.map((box) => {
    const skip = (reason: ListboxSkip): ListboxAction => ({
      action: 'skip',
      ref: box.ref,
      label: box.label,
      reason,
    });
    if (!ats.listbox) return skip('unsupported');

    // Identity comes from the automation id alone. A listbox has no `name`
    // and its label is page text, so the label heuristics that carry the
    // other passes would be guessing here — and a wrong guess on a country
    // field is a wrong answer submitted, not a blank one.
    const kind = map.get(box.automationId.toLowerCase());
    if (!kind) return skip('unrecognised');

    const value = values[kind];
    if (!value) return skip('no-value');
    if (box.current.trim()) return skip('already-filled');

    return { action: 'select', ref: box.ref, label: box.label, kind, value };
  });
}

/**
 * Which of the menu's options answers `value`, or null to close it untouched.
 *
 * Shares `chooseOption` with the <select> path on purpose: two matchers would
 * mean a country accepted in one kind of dropdown and refused in the other,
 * and that difference would live in whichever one has fewer tests.
 */
export function chooseListboxOption(optionTexts: readonly string[], value: string): number | null {
  const options = optionTexts.map((text, i) => ({ value: String(i), text }));
  const picked = chooseOption(options, value);
  return picked === null ? null : Number(picked);
}
