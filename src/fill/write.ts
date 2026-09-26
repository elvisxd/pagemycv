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
import type { FillReport, PlannedField, ResumeFile } from './types';

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
 */
function announce(el: Control): void {
  el.dispatchEvent(new Event('input', { bubbles: true }));
  el.dispatchEvent(new Event('change', { bubbles: true }));
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
function attachFile(el: HTMLInputElement, resume: ResumeFile): void {
  const bytes = fromBase64(resume.base64);
  const file = new File([bytes], resume.filename, { type: resume.mimeType });
  const transfer = new DataTransfer();
  transfer.items.add(file);
  el.files = transfer.files;
  announce(el);
}

export function applyPlan(
  fields: readonly PlannedField[],
  elements: Map<string, Control>,
  resume: ResumeFile | null,
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
        if (!resume || !(el instanceof HTMLInputElement)) {
          failures.push({ ref: field.ref, label: field.label, detail: 'no file to attach' });
          continue;
        }
        attachFile(el, resume);
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

  return { url, ats, filled, attached, skipped, fields: [...fields], failures };
}
