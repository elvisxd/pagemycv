// The only module that reads the page. Everything downstream works on the
// plain records this produces, which is what lets the classifier and the
// planner be tested exhaustively without a browser.
//
// It reads and never writes. The elements themselves stay in the caller's
// closure, keyed by the `ref` field, so nothing here marks up the page: a
// `data-*` attribute added to every control would be a fingerprint the page
// could read back, and a page that can tell it is being autofilled is a page
// that can behave differently while it is.
import type { FieldDescriptor, VisibilityMetrics } from './types';

export type Control = HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement;

const SELECTOR = 'input, select, textarea';

/** Ancestor walk, capped: a deeply nested form should not cost O(depth) twice. */
const MAX_ANCESTORS = 40;

function hiddenByAttribute(el: Element): boolean {
  let node: Element | null = el;
  for (let i = 0; node && i < MAX_ANCESTORS; i++) {
    if (node.hasAttribute('hidden')) return true;
    if (node.getAttribute('aria-hidden') === 'true') return true;
    if (node.hasAttribute('inert')) return true;
    node = node.parentElement;
  }
  return false;
}

function isDisabled(el: Control): boolean {
  // `.disabled` already accounts for an ancestor <fieldset disabled>, which is
  // how a multi-step form greys out the steps you have not reached.
  if (el.disabled) return true;
  return el.closest('fieldset[disabled]') !== null;
}

/**
 * An ancestor that clips this field out of existence.
 *
 * The visually-hidden pattern — a 1x1 box with `overflow: hidden`, or a
 * `clip-path` that leaves nothing — hides a field whose own rect is full size
 * inside it. No measurement of the element alone can see that, so the walk is
 * the only way. Bounded, and it stops at the first clipping ancestor small
 * enough to matter.
 */
function clippedByAncestor(el: Control): boolean {
  const view = el.ownerDocument.defaultView;
  if (!view) return false;
  let node: Element | null = el.parentElement;
  for (let i = 0; node && i < MAX_ANCESTORS; i++) {
    const style = view.getComputedStyle(node);
    const clips =
      style.overflow === 'hidden' ||
      style.overflow === 'clip' ||
      style.overflowX === 'hidden' ||
      style.overflowY === 'hidden' ||
      (style.clipPath !== 'none' && style.clipPath !== '');
    if (clips) {
      const rect = node.getBoundingClientRect();
      // A clipping box too small to show a field, whatever the field's own
      // rect says. `inset(50%)` leaves zero painted area even on a large box,
      // so it counts on its own.
      if (rect.width < MIN_VISIBLE_EDGE || rect.height < MIN_VISIBLE_EDGE) return true;
      if (/^inset\((?:100%|50%|[5-9]\d(?:\.\d+)?%)/.test(style.clipPath)) return true;
    }
    node = node.parentElement;
  }
  return false;
}

/** Kept in step with MIN_EDGE in visibility.ts, which owns the rule. */
const MIN_VISIBLE_EDGE = 4;

function measure(el: Control, doc: Document): VisibilityMetrics {
  const rect = el.getBoundingClientRect();
  const style = el.ownerDocument.defaultView?.getComputedStyle(el);
  const root = doc.documentElement;
  return {
    width: rect.width,
    height: rect.height,
    top: rect.top,
    left: rect.left,
    display: style?.display ?? '',
    visibility: style?.visibility ?? '',
    opacity: style?.opacity ?? '1',
    hiddenAttribute: hiddenByAttribute(el),
    // offsetParent is null for display:none anywhere up the tree, and also for
    // position:fixed, which is why it is one signal among several rather than
    // the test on its own.
    detached: el.offsetParent === null && style?.position !== 'fixed',
    // checkVisibility landed in Chrome 105 and the manifest requires 116, so
    // the fallback is for a non-Chrome host rather than an old one. It
    // defaults to `true` deliberately: an unanswerable question must not by
    // itself make a field unwritable, because the rules below still apply.
    browserVisible:
      typeof el.checkVisibility === 'function'
        ? el.checkVisibility({
            opacityProperty: true,
            visibilityProperty: true,
            contentVisibilityAuto: true,
          })
        : true,
    clipped: clippedByAncestor(el),
    documentWidth: Math.max(root.scrollWidth, root.clientWidth),
    documentHeight: Math.max(root.scrollHeight, root.clientHeight),
  };
}

function text(node: Element | null): string {
  if (!node) return '';
  // textContent rather than innerText: innerText forces layout for every
  // label on the form, and the difference in what it returns does not matter
  // once the result is collapsed to single spaces.
  return (node.textContent ?? '').replace(/\s+/g, ' ').trim();
}

/**
 * The visible question this control is asking.
 *
 * Six strategies, most explicit first. The last two exist because Lever and
 * Greenhouse both render the label as a sibling rather than with `for`, which
 * is valid HTML and invisible to the obvious lookup.
 */
export function labelFor(el: Control): string {
  const doc = el.ownerDocument;

  const byId = el.id ? doc.querySelector(`label[for="${CSS.escape(el.id)}"]`) : null;
  if (byId) return text(byId);

  const labelledBy = el.getAttribute('aria-labelledby');
  if (labelledBy) {
    const parts = labelledBy
      .split(/\s+/)
      .map((id) => text(doc.getElementById(id)))
      .filter(Boolean);
    if (parts.length) return parts.join(' ');
  }

  const wrapping = el.closest('label');
  if (wrapping) {
    // The control's own value would otherwise be read back as its label, which
    // is how a select's first option ends up looking like the question.
    const clone = wrapping.cloneNode(true) as HTMLElement;
    for (const control of clone.querySelectorAll(SELECTOR)) control.remove();
    const label = text(clone);
    if (label) return label;
  }

  const aria = el.getAttribute('aria-label');
  if (aria?.trim()) return aria.trim();

  // A sibling label, which is the shape both boards actually emit.
  let node: Element | null = el.previousElementSibling;
  for (let i = 0; node && i < 4; i++) {
    if (node.tagName === 'LABEL' || node.tagName === 'LEGEND') {
      const label = text(node);
      if (label) return label;
    }
    node = node.previousElementSibling;
  }

  // Finally the enclosing field group, where the label may be a heading or a
  // span. Bounded, and only the first label-ish descendant, because a whole
  // fieldset's text is not a label.
  const group = el.closest('[class*="field" i], [class*="question" i], fieldset, li, p, div');
  const inGroup = group?.querySelector('label, legend, .label, [class*="label" i]');
  if (inGroup && !inGroup.contains(el)) return text(inGroup);

  return '';
}

function controlType(el: Control): string {
  if (el instanceof HTMLSelectElement) return el.multiple ? 'select-multiple' : 'select-one';
  if (el instanceof HTMLTextAreaElement) return 'textarea';
  return (el.getAttribute('type') ?? 'text').toLowerCase();
}

function optionsOf(el: Control): { value: string; text: string }[] {
  if (!(el instanceof HTMLSelectElement)) return [];
  return Array.from(el.options).map((o) => ({ value: o.value, text: text(o) }));
}

function tagOf(el: Control): FieldDescriptor['tag'] {
  if (el instanceof HTMLSelectElement) return 'select';
  if (el instanceof HTMLTextAreaElement) return 'textarea';
  return 'input';
}

/**
 * Everything on the page we might write to, paired with its element.
 *
 * Returns the elements alongside the descriptors rather than a lookup the
 * caller has to keep in sync, because a plan applied to the wrong element is
 * the worst bug this code could have.
 */
export function describeForm(doc: Document = document): {
  fields: FieldDescriptor[];
  elements: Map<string, Control>;
} {
  const fields: FieldDescriptor[] = [];
  const elements = new Map<string, Control>();

  const all = Array.from(doc.querySelectorAll<Control>(SELECTOR));
  all.forEach((el, index) => {
    const ref = `f${index}`;
    elements.set(ref, el);
    const value = el instanceof HTMLSelectElement ? el.value : el.value;
    fields.push({
      ref,
      tag: tagOf(el),
      type: controlType(el),
      name: el.getAttribute('name') ?? '',
      id: el.id ?? '',
      autocomplete: (el.getAttribute('autocomplete') ?? '').toLowerCase().trim(),
      label: labelFor(el),
      placeholder: el.getAttribute('placeholder') ?? '',
      ariaLabel: el.getAttribute('aria-label') ?? '',
      automationId: el.getAttribute('data-automation-id') ?? '',
      required: el.hasAttribute('required') || el.getAttribute('aria-required') === 'true',
      // A select's first option is its value before anyone touches it, so an
      // unchosen select is not "already filled". Only a non-empty value that
      // is not the placeholder option counts.
      hasValue:
        el instanceof HTMLSelectElement
          ? el.selectedIndex > 0 && value.trim() !== ''
          : value.trim() !== '',
      disabled: isDisabled(el),
      readOnly: el instanceof HTMLSelectElement ? false : el.readOnly,
      options: optionsOf(el),
      metrics: measure(el, doc),
    });
  });

  return { fields, elements };
}
