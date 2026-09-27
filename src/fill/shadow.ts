// The one door into shadow roots.
//
// Chromium gives content scripts `chrome.dom.openOrClosedShadowRoot`, which
// reaches a root the page itself cannot see. Nothing else in the extension
// calls it: a second caller is a second place that can forget the closed
// case, and the closed case is the one that fails silently — a flat query
// simply returns nothing and the form looks empty rather than unreadable.
//
// The Phase 4 spike measured that gap on a page with three closed roots:
// `querySelectorAll` found 0 controls where the walk below found 4, one of
// them nested two roots deep. See spikes/phase-4/README.md.

/** Deeper than this is a cycle or a page built to exhaust us. */
const MAX_DEPTH = 20;

/**
 * The shadow root of an element, open or closed, or null.
 *
 * Falls back to `element.shadowRoot` where `chrome.dom` is absent — unit
 * tests under jsdom, and any context that is not a content script. The
 * fallback sees open roots only, which is why the closed case is covered by
 * the browser gate as well as by tests.
 */
export function shadowRootOf(el: Element): ShadowRoot | null {
  const dom = (
    globalThis as { chrome?: { dom?: { openOrClosedShadowRoot?(e: Element): ShadowRoot | null } } }
  ).chrome?.dom;
  if (typeof dom?.openOrClosedShadowRoot === 'function') {
    try {
      return dom.openOrClosedShadowRoot(el);
    } catch {
      // Chromium throws rather than returning null for a node it will not
      // open. An element we cannot look inside is one without a root here.
      return null;
    }
  }
  return el.shadowRoot;
}

/**
 * Every element matching `selector`, in this root and in every shadow root
 * below it.
 *
 * Document order within each root, roots in the order their hosts appear.
 * The order matters because `describeForm` numbers fields by it and the
 * review list is read top to bottom.
 */
export function deepQueryAll<T extends Element>(
  root: Document | ShadowRoot | Element,
  selector: string,
): T[] {
  const out: T[] = [];
  walk(root, selector, out, 0);
  return out;
}

function walk<T extends Element>(
  root: Document | ShadowRoot | Element,
  selector: string,
  out: T[],
  depth: number,
): void {
  if (depth > MAX_DEPTH) return;
  for (const el of root.querySelectorAll('*')) {
    if (el.matches(selector)) out.push(el as unknown as T);
    const shadow = shadowRootOf(el);
    if (shadow) walk(shadow, selector, out, depth + 1);
  }
}

/**
 * The node's own root: the document, or the shadow root that contains it.
 *
 * This is what label lookups have to be scoped to. `id` is scoped per root,
 * so `document.getElementById` and `document.querySelector('label[for=…]')`
 * both return nothing for a control inside a shadow root — not an error, just
 * a field that silently arrives unlabelled. Both were doing exactly that
 * until the Phase 4 spike measured it.
 */
export function scopeOf(node: Node): Document | ShadowRoot {
  const root = node.getRootNode();
  return root instanceof ShadowRoot ? root : (node.ownerDocument ?? document);
}

/**
 * `closest`, but crossing shadow boundaries by hopping to each host.
 *
 * The built-in stops at the root, so a control inside one looks like it has
 * no form, no fieldset and no labelled wrapper around it.
 */
export function deepClosest(el: Element, selector: string): Element | null {
  let node: Element | null = el;
  for (let hop = 0; node && hop <= MAX_DEPTH; hop++) {
    const found = node.closest(selector);
    if (found) return found;
    const root = node.getRootNode();
    node = root instanceof ShadowRoot ? root.host : null;
  }
  return null;
}

/**
 * Whether anything on the page uses a shadow root at all.
 *
 * Only for the review note, so somebody reading "0 fields" on a Workday page
 * can tell an empty form from a form we could not open.
 */
export function usesShadowDom(doc: Document = document): boolean {
  for (const el of doc.querySelectorAll('*')) if (shadowRootOf(el)) return true;
  return false;
}
