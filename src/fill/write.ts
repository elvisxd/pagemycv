// Executing a plan against the page. The other half of the DOM boundary.
//
// It has no access to a submit primitive, which is how invariant 1 is kept:
// not by remembering not to submit, but by there being nothing here that
// could. No form.submit, no requestSubmit, no click on a submit control, no
// synthesized Enter. scripts/guard.mjs fails the build if any of them appear
// in any file, and tests/e2e/gate.cjs counts submits in a real browser.
import { fromBase64 } from '../util/base64';
import type { Control } from './descriptor';
import { fingerprintOf } from './descriptor';
import { chooseListboxOption } from './listbox';
import type {
  FillReport,
  ListboxAction,
  ListboxSelectors,
  PlannedField,
  StoredFile,
  StoredFiles,
} from './types';
import { documentFor } from './types';

/**
 * Assign through the prototype's own setter.
 *
 * React, Preact and Vue all install a value setter on the element instance to
 * track changes. Assigning `el.value = x` goes through that instance property,
 * which updates the DOM but leaves the framework's internal record untouched,
 * so the next render puts the old value back. Going through the prototype
 * setter and then dispatching the events is what every well-behaved autofill
 * does, and what makes the value survive on Ashby and the newer Greenhouse.
 */
function setValue(el: Control, value: string): void {
  const proto =
    el instanceof HTMLTextAreaElement
      ? HTMLTextAreaElement.prototype
      : el instanceof HTMLSelectElement
        ? HTMLSelectElement.prototype
        : HTMLInputElement.prototype;
  const setter = Object.getOwnPropertyDescriptor(proto, 'value')?.set;
  if (setter) setter.call(el, value);
  else el.value = value;
}

/**
 * The events a real edit produces, minus the ones that could submit.
 *
 * `input` then `change` is what a paste produces, and a paste is the closest
 * honest analogy to what this is. No keydown or keyup: a synthesized Enter in
 * a single-input form submits it, and the way to be sure that never happens is
 * never to synthesize a key at all.
 *
 * `composed` is not decoration. A bubbling event stops dead at a shadow
 * boundary: inside a closed root the listener in that root hears it and the
 * document never does. A framework listening at document level — the common
 * case — would see a field holding a value that, as far as its own state is
 * concerned, was never typed, and submit the form without it. With
 * `composed` the event crosses and arrives retargeted at the host, which is
 * what a real keystroke in there looks like. Measured both ways in
 * spikes/phase-4: "(nothing)" against "my-information".
 */
function announce(el: Control): void {
  el.dispatchEvent(new Event('input', { bubbles: true, composed: true }));
  el.dispatchEvent(new Event('change', { bubbles: true, composed: true }));
}

const HIGHLIGHT = '2px solid #3b82f6';

/**
 * Mark what was written. Stored on a WeakMap rather than a data attribute so
 * the page cannot read back which of its fields were machine-filled.
 */
const PREVIOUS_OUTLINE = new WeakMap<Control, { outline: string; offset: string }>();

function highlight(el: Control): void {
  // Both properties, because clearing only one leaves the page's own styling
  // half-restored. A form that set its own outlineOffset would keep ours.
  if (!PREVIOUS_OUTLINE.has(el)) {
    PREVIOUS_OUTLINE.set(el, { outline: el.style.outline, offset: el.style.outlineOffset });
  }
  el.style.outline = HIGHLIGHT;
  el.style.outlineOffset = '1px';
}

export function clearHighlights(elements: Iterable<Control>): void {
  for (const el of elements) {
    const previous = PREVIOUS_OUTLINE.get(el);
    if (previous === undefined) continue;
    el.style.outline = previous.outline;
    el.style.outlineOffset = previous.offset;
    PREVIOUS_OUTLINE.delete(el);
  }
}

/**
 * Put a File into a file input.
 *
 * `input.files` is read-only as a property but assignable from a FileList, and
 * DataTransfer is the only way to build one. This runs in the content script's
 * isolated world: the FileList it produces is accepted by the page's input
 * because the assignment goes through the real DOM binding, and the page's own
 * framework sees it after the change event. tests/e2e/gate.cjs asserts the
 * file is actually there afterwards rather than trusting that.
 */
function attachFile(el: HTMLInputElement, stored: StoredFile): void {
  const bytes = fromBase64(stored.base64);
  const file = new File([bytes], stored.filename, { type: stored.mimeType });
  const transfer = new DataTransfer();
  transfer.items.add(file);
  el.files = transfer.files;
  announce(el);
}

export function applyPlan(
  fields: readonly PlannedField[],
  elements: Map<string, Control>,
  documents: StoredFiles,
  url: string,
  ats: string,
): FillReport {
  let filled = 0;
  let attached = 0;
  let skipped = 0;
  const failures: FillReport['failures'] = [];

  for (const field of fields) {
    if (field.action === 'skip') {
      skipped++;
      continue;
    }
    const el = elements.get(field.ref);
    if (!el) {
      // The page re-rendered between describing it and writing to it. Report
      // it rather than retrying: a second pass over a changed page is how an
      // autofill writes the right value into the wrong box.
      failures.push({
        ref: field.ref,
        label: field.label,
        detail: 'the field disappeared before it could be written',
      });
      continue;
    }
    // Two checks between holding a reference and writing through it, because
    // a plan crosses two message hops and a page can re-render in between.
    //
    // `isConnected` catches a node replaced by a re-render: writing to a
    // detached node changes nothing anyone can see, and counting it as filled
    // would be a report that lies.
    if (!el.isConnected) {
      failures.push({
        ref: field.ref,
        label: field.label,
        detail: 'the field was removed from the page before it could be written',
      });
      continue;
    }
    // The fingerprint catches the worse case: React and friends REUSE DOM
    // nodes across renders and change their attributes, so a held reference
    // can still be in the document and no longer be the same field. Writing
    // through it puts the right value in the wrong box and reports success.
    const now = fingerprintOf(el);
    if (now !== field.fingerprint) {
      failures.push({
        ref: field.ref,
        label: field.label,
        detail: `the field changed while the plan was being built (was ${field.fingerprint}, is ${now})`,
      });
      continue;
    }
    try {
      if (field.action === 'attach') {
        const document = documentFor(field.kind);
        const stored = document ? documents[document] : undefined;
        if (!stored || !(el instanceof HTMLInputElement)) {
          failures.push({ ref: field.ref, label: field.label, detail: 'no file to attach' });
          continue;
        }
        attachFile(el, stored);
        highlight(el);
        attached++;
        continue;
      }
      setValue(el, field.optionValue ?? field.value);
      announce(el);
      highlight(el);
      filled++;
    } catch (err) {
      failures.push({
        ref: field.ref,
        label: field.label,
        detail: err instanceof Error ? err.message : String(err),
      });
    }
  }

  // `selected` is zero here by construction: this path assigns values, it
  // never opens a menu. The caller merges in what applyListboxes did.
  return {
    url,
    ats,
    filled,
    attached,
    selected: 0,
    skipped,
    fields: [...fields],
    failures,
    declined: [],
  };
}

/**
 * Open a custom listbox, pick an option and close it — in one task.
 *
 * Everything between the trigger click and the option click is synchronous
 * on purpose. 09-ats.md records that Workday's menu is gone by the next
 * task, and spikes/phase-4 reproduces exactly that against a model of it: 3
 * options read in the opening task, 0 read one task later. An `await`
 * anywhere in here would find an empty menu and report "your answer was not
 * in the list" for a list that had the answer in it.
 *
 * Dispatched events rather than `.click()`, because Workday covers its own
 * controls with a transparent overlay: in the spike a real click on the
 * button under it times out while a dispatched one lands.
 */
export function selectFromListbox(
  container: Element,
  value: string,
  selectors: ListboxSelectors,
): { ok: true; chosen: string } | { ok: false; reason: 'no-trigger' | 'no-options' | 'no-match' } {
  // Same discipline as the text writer: the element was described in an
  // earlier task and a framework may have replaced it since.
  if (!container.isConnected) return { ok: false, reason: 'no-trigger' };
  const trigger = container.querySelector(selectors.trigger);
  if (!trigger) return { ok: false, reason: 'no-trigger' };

  click(trigger);

  // Same task. Nothing may await between here and the option click.
  const own = Array.from(container.querySelectorAll(selectors.option));
  const searched =
    own.length > 0
      ? own
      : // Workday can portal its menu to the end of <body>, so it is not a
        // descendant of the field that owns it. Looked for only when the
        // container itself has none, so a page with two open menus cannot
        // have one answer the other's question.
        Array.from(container.ownerDocument.querySelectorAll(selectors.option));
  if (searched.length === 0) {
    close(trigger);
    return { ok: false, reason: 'no-options' };
  }

  const index = chooseListboxOption(
    searched.map((o) => o.textContent?.trim() ?? ''),
    value,
  );
  if (index === null) {
    // Leave it as it was. A question we cannot answer is a question for the
    // human, not a field to put the closest thing in.
    close(trigger);
    return { ok: false, reason: 'no-match' };
  }

  const option = searched[index] as Element;
  const chosen = option.textContent?.trim() ?? '';
  click(option);
  return { ok: true, chosen };
}

/** A click the page believes, through an overlay that would swallow a real one. */
function click(el: Element): void {
  for (const type of ['pointerdown', 'mousedown', 'mouseup', 'click']) {
    el.dispatchEvent(
      type.startsWith('pointer')
        ? new PointerEvent(type, { bubbles: true, cancelable: true, composed: true })
        : new MouseEvent(type, { bubbles: true, cancelable: true, composed: true }),
    );
  }
}

/**
 * Put an opened menu back, so an unanswered question is left as it was found.
 *
 * A second click on the trigger, not Escape. The guard refused the key press
 * and it was right to: invariant 1 says never synthesize a key at all, and
 * the reason it has no exceptions is that "this particular key is harmless"
 * is the argument that eventually submits a form. The trigger is a toggle
 * and it is already open, so clicking it is both safer and closer to what a
 * person would do.
 */
function close(trigger: Element): void {
  click(trigger);
}

/**
 * Drive every listbox the plan asked for, one synchronous pass each.
 *
 * Kept out of `applyPlan` rather than folded into it. The two share nothing
 * but the report they contribute to: one writes a `.value` through a
 * prototype setter, the other clicks a menu open and picks from it inside a
 * single task. Merging them would put an unverified mechanism on the path
 * that already fills Lever and Greenhouse.
 */
export function applyListboxes(
  actions: readonly ListboxAction[],
  elements: Map<string, Element>,
  selectors: ListboxSelectors | undefined,
): {
  selected: number;
  skipped: number;
  declined: FillReport['declined'];
  failures: FillReport['failures'];
} {
  let selected = 0;
  let skipped = 0;
  const declined: FillReport['declined'] = [];
  const failures: FillReport['failures'] = [];
  if (!selectors) return { selected, skipped: actions.length, declined, failures };

  for (const action of actions) {
    if (action.action === 'skip') {
      skipped++;
      continue;
    }
    const container = elements.get(action.ref);
    if (!container) {
      failures.push({
        ref: action.ref,
        label: action.label,
        detail: 'the dropdown disappeared before it could be opened',
      });
      continue;
    }
    const result = selectFromListbox(container, action.value, selectors);
    if (result.ok) {
      selected++;
      continue;
    }
    if (result.reason === 'no-match') {
      // Not a failure. We opened it, read it, and the answer was not there,
      // so it stays as the person left it and they are told why.
      declined.push({
        ref: action.ref,
        label: action.label,
        detail: `opened it, and "${action.value}" was not among the options — left as it was`,
      });
      continue;
    }
    failures.push({
      ref: action.ref,
      label: action.label,
      detail:
        result.reason === 'no-options'
          ? 'opened it and it listed nothing'
          : 'could not find what opens it',
    });
  }
  return { selected, skipped, declined, failures };
}
