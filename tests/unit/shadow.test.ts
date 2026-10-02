// @vitest-environment jsdom
//
// The shadow-root door, and the three things it fixes.
//
// jsdom has no `chrome.dom`, so the closed case is driven through a stub: the
// test attaches a closed root, keeps the handle jsdom hands back, and serves
// it the way Chromium would. That is honest about what it proves — the
// TRAVERSAL is tested here, the browser API is tested in tests/e2e/gate.cjs
// against a page that really does hide its fields this way. Neither is
// enough alone: a stub that lies would pass here, and a browser check alone
// could not cover twenty branches.
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { Control } from '../../src/fill/descriptor';
import { countFillable, describeForm, labelFor } from '../../src/fill/descriptor';
import { deepClosest, deepQueryAll, scopeOf, shadowRootOf } from '../../src/fill/shadow';

/** Roots jsdom gave us, served back the way `chrome.dom` would. */
const CLOSED = new WeakMap<Element, ShadowRoot>();

function attachClosed(host: Element, html: string): ShadowRoot {
  const root = host.attachShadow({ mode: 'closed' });
  root.innerHTML = html;
  CLOSED.set(host, root);
  return root;
}

function withChromeDom(): void {
  (globalThis as unknown as { chrome: unknown }).chrome = {
    dom: {
      openOrClosedShadowRoot: (el: Element) => CLOSED.get(el) ?? el.shadowRoot ?? null,
    },
  };
}

beforeEach(() => {
  document.body.innerHTML = '';
  withChromeDom();
});

afterEach(() => {
  (globalThis as unknown as { chrome?: unknown }).chrome = undefined;
});

describe('shadowRootOf', () => {
  it('opens a closed root the page itself cannot see', () => {
    document.body.innerHTML = '<my-info></my-info>';
    const host = document.querySelector('my-info') as Element;
    attachClosed(host, '<input name="firstName">');

    // What "closed" means, asserted rather than assumed. Without this the
    // tests below could be passing against an open root.
    expect(host.shadowRoot).toBeNull();
    expect(shadowRootOf(host)).not.toBeNull();
  });

  it('falls back to the open root where chrome.dom is absent', () => {
    (globalThis as unknown as { chrome?: unknown }).chrome = undefined;
    document.body.innerHTML = '<my-info></my-info>';
    const host = document.querySelector('my-info') as Element;
    host.attachShadow({ mode: 'open' }).innerHTML = '<input name="a">';
    expect(shadowRootOf(host)).not.toBeNull();
  });

  it('returns null rather than throwing when the browser refuses', () => {
    (globalThis as unknown as { chrome: unknown }).chrome = {
      dom: {
        openOrClosedShadowRoot: () => {
          throw new Error('not a shadow host');
        },
      },
    };
    document.body.innerHTML = '<div id="x"></div>';
    expect(shadowRootOf(document.querySelector('#x') as Element)).toBeNull();
  });
});

describe('deepQueryAll', () => {
  it('finds what a flat query cannot', () => {
    document.body.innerHTML = '<my-info></my-info>';
    attachClosed(
      document.querySelector('my-info') as Element,
      '<input name="firstName"><input name="lastName">',
    );
    expect(document.querySelectorAll('input')).toHaveLength(0);
    expect(deepQueryAll(document, 'input')).toHaveLength(2);
  });

  it('descends through a root nested inside a root', () => {
    document.body.innerHTML = '<my-info></my-info>';
    const outer = attachClosed(
      document.querySelector('my-info') as Element,
      '<input name="firstName"><nested-block></nested-block>',
    );
    attachClosed(outer.querySelector('nested-block') as Element, '<input name="deep">');
    expect(deepQueryAll<HTMLInputElement>(document, 'input').map((e) => e.name)).toEqual([
      'firstName',
      'deep',
    ]);
  });

  it('keeps light-DOM and shadow controls in host order', () => {
    document.body.innerHTML = '<input name="before"><my-info></my-info><input name="after">';
    attachClosed(document.querySelector('my-info') as Element, '<input name="inside">');
    expect(deepQueryAll<HTMLInputElement>(document, 'input').map((e) => e.name)).toEqual([
      'before',
      'inside',
      'after',
    ]);
  });

  it('stops rather than recursing forever', () => {
    // A host whose root contains another host, thirty deep. The cap is 20,
    // so this must terminate and must not return everything.
    document.body.innerHTML = '<d-0></d-0>';
    let host = document.querySelector('d-0') as Element;
    for (let i = 1; i < 30; i++) {
      const root = attachClosed(host, `<input name="i${i}"><d-${i}></d-${i}>`);
      host = root.querySelector(`d-${i}`) as Element;
    }
    const found = deepQueryAll(document, 'input');
    expect(found.length).toBeGreaterThan(0);
    expect(found.length).toBeLessThan(29);
  });
});

describe('scopeOf', () => {
  it('gives the shadow root for a node inside one, and the document otherwise', () => {
    document.body.innerHTML = '<input id="light"><my-info></my-info>';
    const root = attachClosed(document.querySelector('my-info') as Element, '<input id="dark">');
    expect(scopeOf(document.querySelector('#light') as Node)).toBe(document);
    expect(scopeOf(root.querySelector('#dark') as Node)).toBe(root);
  });
});

describe('deepClosest', () => {
  it('crosses the boundary by hopping to the host', () => {
    document.body.innerHTML = '<fieldset id="outer"><my-info></my-info></fieldset>';
    const root = attachClosed(document.querySelector('my-info') as Element, '<input name="a">');
    const input = root.querySelector('input') as Element;
    // The built-in stops at the root. That is the bug.
    expect(input.closest('fieldset')).toBeNull();
    expect(deepClosest(input, 'fieldset')?.id).toBe('outer');
  });

  it('still prefers the nearest match inside the root', () => {
    // A fieldset rather than a form: jsdom's parser DROPS a <form> from a
    // shadow root's innerHTML, so the first version of this test asserted
    // against an element that was not there. Changing the expectation to
    // match would have made it pass while testing nothing.
    document.body.innerHTML = '<fieldset id="outer"><my-info></my-info></fieldset>';
    const root = attachClosed(
      document.querySelector('my-info') as Element,
      '<fieldset id="inner"><input name="a"></fieldset>',
    );
    expect(deepClosest(root.querySelector('input') as Element, 'fieldset')?.id).toBe('inner');
  });

  it('returns null when nothing matches anywhere up the chain', () => {
    document.body.innerHTML = '<my-info></my-info>';
    const root = attachClosed(document.querySelector('my-info') as Element, '<input name="a">');
    expect(deepClosest(root.querySelector('input') as Element, 'table')).toBeNull();
  });
});

// ── What the three fixes mean for the modules that had the bug ─────────────

describe('descriptor, inside a closed root', () => {
  it('labels a field whose label the document cannot see', () => {
    document.body.innerHTML = '<my-info></my-info>';
    const root = attachClosed(
      document.querySelector('my-info') as Element,
      '<label for="fn">First Name</label><input id="fn" name="firstName">',
    );
    const input = root.querySelector('input') as Control;
    // ids are scoped per root: both document lookups come back empty, which
    // is why this failed silently rather than loudly.
    expect(document.getElementById('fn')).toBeNull();
    expect(labelFor(input)).toBe('First Name');
  });

  it('resolves aria-labelledby within the root that owns the id', () => {
    document.body.innerHTML = '<span id="q">Outside</span><my-info></my-info>';
    const root = attachClosed(
      document.querySelector('my-info') as Element,
      '<span id="q">Postal Code</span><input aria-labelledby="q" name="zip">',
    );
    // The same id exists in the document. Taking that one would label this
    // field with another element's text.
    expect(labelFor(root.querySelector('input') as Control)).toBe('Postal Code');
  });

  it('counts and describes controls a flat query misses', () => {
    document.body.innerHTML = '<my-info></my-info>';
    attachClosed(
      document.querySelector('my-info') as Element,
      '<input name="a"><input name="b"><input type="hidden" name="c">',
    );
    expect(countFillable(document)).toBe(2);
    expect(describeForm(document).fields.map((f) => f.name)).toEqual(['a', 'b', 'c']);
  });
});
