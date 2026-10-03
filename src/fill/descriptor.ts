// The only module that reads the page. Everything downstream works on the
// plain records this produces, which is what lets the classifier and the
// planner be tested exhaustively without a browser.
//
// It reads and never writes. The elements themselves stay in the caller's
// closure, keyed by the `ref` field, so nothing here marks up the page: a
// `data-*` attribute on every control would be a flag the page could read
// back, and a page that can tell it is being autofilled is a page that can
// behave differently while it is.
//
// That is a narrow claim, not a broad one. The highlight src/fill/write.ts
// draws IS an inline style the page can read, and a page watching for `input`
// events can see the writes as they happen. Marking every control before
// anything is decided would be worse than either: it would announce the scan
// itself, including for the fields we then refuse.
import { deepClosest, deepQueryAll, scopeOf } from './shadow';
import type {
  FieldDescriptor,
  ListboxDescriptor,
  ListboxSelectors,
  VisibilityMetrics,
} from './types';

export type Control = HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement;

export const SELECTOR = 'input, select, textarea';

/**
 * Input types nobody fills from a CV, for the roll call's field count.
 *
 * The count decides which frame holds the form when a careers page embeds
 * more than one, so counting a hidden input or a submit button is not a
 * rounding error: a frame with two real fields and five hidden ones would
 * beat a frame with three real ones, and the wrong form gets filled.
 */
const UNCOUNTED_TYPES = new Set([
  'hidden',
  'submit',
  'button',
  'reset',
  'image',
  'password',
  'search',
]);

/**
 * How many controls in this document are plausibly part of an application.
 *
 * Deliberately cheap and deliberately not the same as what `describeForm`
 * returns: this runs in every frame on every roll call, before anything is
 * decided, and it only has to rank frames against each other.
 */
export function countFillable(doc: Document = document): number {
  let n = 0;
  for (const el of deepQueryAll<Element>(doc, SELECTOR)) {
    if (el instanceof HTMLInputElement && UNCOUNTED_TYPES.has(el.type.toLowerCase())) continue;
    if (el.hasAttribute('disabled')) continue;
    n++;
  }
  return n;
}

/**
 * Past this, it is prose rather than a field name.
 *
 * A label is a question, and a question fits. The limit matters because the
 * classifier matches patterns against this text: a paragraph of terms that
 * mentions "salary" would otherwise make the field it wraps look sensitive,
 * and one that mentions "email" would make it look fillable.
 */
const MAX_LABEL = 200;

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
  return deepClosest(el, 'fieldset[disabled]') !== null;
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
function clippedByAncestor(el: Element, memo: Map<Element, boolean>): boolean {
  const view = el.ownerDocument.defaultView;
  if (!view) return false;
  let node: Element | null = el.parentElement;
  for (let i = 0; node && i < MAX_ANCESTORS; i++) {
    // Fields on a form share almost all of their ancestors, so without this
    // a hundred-control application costs a few thousand getComputedStyle
    // calls on the same forty elements. Each one flushes layout.
    const cached = memo.get(node);
    if (cached !== undefined) {
      if (cached) return true;
      node = node.parentElement;
      continue;
    }
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
      if (
        rect.width < MIN_VISIBLE_EDGE ||
        rect.height < MIN_VISIBLE_EDGE ||
        /^inset\((?:100%|50%|[5-9]\d(?:\.\d+)?%)/.test(style.clipPath)
      ) {
        memo.set(node, true);
        return true;
      }
    }
    memo.set(node, false);
    node = node.parentElement;
  }
  return false;
}

/** Kept in step with MIN_EDGE in visibility.ts, which owns the rule. */
const MIN_VISIBLE_EDGE = 4;

interface PageMetrics {
  documentWidth: number;
  documentHeight: number;
}

function measure(
  el: HTMLElement,
  clipMemo: Map<Element, boolean>,
  page: PageMetrics,
): VisibilityMetrics {
  const rect = el.getBoundingClientRect();
  const style = el.ownerDocument.defaultView?.getComputedStyle(el);
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
    clipped: clippedByAncestor(el, clipMemo),
    ...page,
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
  // The node's OWN root, not the document. `id` is scoped per shadow root,
  // so `document.getElementById` and `document.querySelector('label[for=…]')`
  // both return nothing for a control inside one — no error, just a field
  // that silently arrives unlabelled and is then refused as unrecognised.
  // Worse than nothing when the document happens to hold the same id: the
  // field is then labelled with a stranger's text. Measured in
  // spikes/phase-4, and the test for it reverts to exactly that.
  const doc = scopeOf(el);

  const byId = el.id ? doc.querySelector(`label[for="${CSS.escape(el.id)}"]`) : null;
  if (byId) return text(byId);

  const labelledBy = el.getAttribute('aria-labelledby');
  if (labelledBy) {
    const parts = labelledBy
      .split(/\s+/)
      .map((id) => text(doc.getElementById?.(id) ?? doc.querySelector(`#${CSS.escape(id)}`)))
      .filter(Boolean);
    if (parts.length) return parts.join(' ');
  }

  const wrapping = deepClosest(el, 'label');
  if (wrapping) {
    // The control's own value would otherwise be read back as its label, which
    // is how a select's first option ends up looking like the question.
    const clone = wrapping.cloneNode(true) as HTMLElement;
    for (const control of clone.querySelectorAll(SELECTOR)) control.remove();
    const label = text(clone);
    // A consent paragraph wrapped in a <label> is not a field name. Anything
    // this long is prose, and prose that happens to contain "email" or
    // "salary" would steer the classifier for a field it does not describe.
    if (label && label.length <= MAX_LABEL) return label;
  }

  const aria = el.getAttribute('aria-label');
  if (aria?.trim()) return aria.trim();

  // A sibling label, which is the shape both boards actually emit.
  //
  // The walk stops at the first other control. A label that sits before
  // ANOTHER field belongs to that field, and taking it here is how the second
  // input in a flat container inherits the first one's question — the exact
  // shape that puts an email address into a salary box.
  let node: Element | null = el.previousElementSibling;
  for (let i = 0; node && i < 4; i++) {
    if (node.matches(SELECTOR) || node.querySelector(SELECTOR)) break;
    if (node.tagName === 'LABEL' || node.tagName === 'LEGEND') {
      const label = text(node);
      if (label) return label;
    }
    node = node.previousElementSibling;
  }

  // Finally the enclosing field group, where the label may be a heading or a
  // span rather than a <label>.
  //
  // Only when that group holds exactly ONE control. `closest(… , 'div')`
  // almost always matches something, and taking the first label-ish
  // descendant of a container that holds several fields hands this field the
  // label of the first one — which is how a value ends up in the right-looking
  // wrong box. One control in the group is the evidence that the label can
  // only be describing this field.
  //
  // Walking outward through nested groups, because the nearest one is often
  // a wrapper that holds the control and nothing else. Ashby's Location box
  // is `<div class="fieldEntry"><label for="…">Location</label><div
  // class="inputContainer"><input role="combobox"></div></div>` with no id on
  // the input, so the `for` never matches and the innermost div has no label
  // in it. Stopping there reported the field as "Start typing...", its
  // placeholder, and nothing recognised it. The one-control rule holds at
  // every step: a wider group that still holds only this control can only be
  // describing it. Capped, because a form with a single field would otherwise
  // be labelled by the page's first heading.
  let group: Element | null = deepClosest(el, GROUP);
  for (let i = 0; group && i < MAX_GROUP_WALK; i++) {
    if (group.querySelectorAll(SELECTOR).length !== 1) break;
    const inGroup = group.querySelector('label, legend, .label, [class*="label" i]');
    if (inGroup && !inGroup.contains(el)) return text(inGroup);
    group = group.parentElement ? deepClosest(group.parentElement, GROUP) : null;
  }

  return '';
}

const GROUP = '[class*="field" i], [class*="question" i], fieldset, li, p, div';
const MAX_GROUP_WALK = 4;

/**
 * What a person clicks to open the file picker, for a file input that is
 * not itself that thing.
 *
 * Only two shapes count, and both put a human in the loop: the input's own
 * label, which the browser activates on click, or a dropzone — the parent
 * element, when it holds a button or a label of its own. A bare parent with
 * nothing clickable in it is not a dropzone and does not count; nor does
 * anything for a control that is not a file input, so a 1x1 text box stays
 * refused however visible its surroundings are.
 */
export function triggerFor(el: Control): HTMLElement | null {
  if (!(el instanceof HTMLInputElement) || el.type !== 'file') return null;
  const doc = scopeOf(el);
  const byId = el.id ? doc.querySelector(`label[for="${CSS.escape(el.id)}"]`) : null;
  if (byId instanceof HTMLElement) return byId;
  const wrapping = deepClosest(el, 'label');
  if (wrapping instanceof HTMLElement) return wrapping;
  const parent = el.parentElement;
  if (parent?.querySelector('button, [role="button"], label')) return parent;
  return null;
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

/**
 * What identifies this control, for the writer to re-check before it writes.
 *
 * Deliberately the four attributes a form uses to say what a field IS, and
 * deliberately not the label, which is read from the surrounding DOM and can
 * legitimately change while the field stays the same.
 */
export function fingerprintOf(el: Control): string {
  return [tagOf(el), controlType(el), el.getAttribute('name') ?? '', el.id ?? ''].join('|');
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

  const clipMemo = new Map<Element, boolean>();
  // Once per pass, not once per field: scrollWidth forces layout, and a long
  // application has a hundred controls.
  const root = doc.documentElement;
  const page: PageMetrics = {
    documentWidth: Math.max(root.scrollWidth, root.clientWidth),
    documentHeight: Math.max(root.scrollHeight, root.clientHeight),
  };
  // Pierces shadow roots, open and closed. A flat query on a Workday page
  // returns nothing at all, so the form reads as empty rather than as
  // unreadable — the worst kind of failure, because the panel then says the
  // page has no fields and that sounds like an answer.
  const all = deepQueryAll<Control>(doc, SELECTOR);
  all.forEach((el, index) => {
    const ref = `f${index}`;
    elements.set(ref, el);
    const value = el.value;
    fields.push({
      ref,
      fingerprint: fingerprintOf(el),
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
      metrics: measure(el, clipMemo, page),
      trigger: (() => {
        const trigger = triggerFor(el);
        return trigger ? measure(trigger, clipMemo, page) : null;
      })(),
    });
  });

  return { fields, elements };
}

/**
 * The custom listboxes on this page, which `SELECTOR` cannot see.
 *
 * A Workday dropdown is a button and a menu, not a `<select>`, so nothing in
 * `describeForm` reaches it. This is a separate pass rather than a wider
 * selector because `Control` means an element with a `.value`, and widening
 * it would put a button through every code path that assumes one.
 *
 * Reading only. The menu is not opened here: opening it is a write, it has to
 * happen in the same task as the choice, and both belong to write.ts.
 */
export function describeListboxes(
  doc: Document,
  selectors: ListboxSelectors,
): { boxes: ListboxDescriptor[]; elements: Map<string, Element> } {
  const boxes: ListboxDescriptor[] = [];
  const elements = new Map<string, Element>();

  deepQueryAll<Element>(doc, selectors.container).forEach((container, index) => {
    // A container that holds a real control is that control's wrapper, not a
    // listbox. Workday names both `formField-…`, so the presence of a
    // trigger and the absence of a control is what tells them apart.
    if (deepQueryAll(container, SELECTOR).length > 0) return;
    const trigger = container.querySelector(selectors.trigger);
    if (!trigger) return;

    const ref = `lb${index}`;
    elements.set(ref, container);
    const display = container.querySelector(selectors.display);
    const shown = text(display);
    boxes.push({
      ref,
      automationId: container.getAttribute('data-automation-id') ?? '',
      label: labelForContainer(container),
      // A trigger still showing its own placeholder has not been answered.
      // Comparing against the label is what tells "Country" the prompt from
      // "Country" the chosen value.
      current: shown === text(container.querySelector('label')) ? '' : shown,
    });
  });

  return { boxes, elements };
}

function labelForContainer(container: Element): string {
  const own = container.querySelector('label, legend, [class*="label" i]');
  const label = text(own) || container.getAttribute('aria-label')?.trim() || '';
  return label.length <= MAX_LABEL ? label : '';
}
