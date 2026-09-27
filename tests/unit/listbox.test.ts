// @vitest-environment jsdom
//
// Custom dropdowns: the decision, and the one-task constraint.
//
// The constraint is the interesting part. 09-ats.md records that Workday's
// menu is gone by the next task, and spikes/phase-4 reproduces it: three
// options in the opening task, zero one task later. A fill path that awaits
// between opening and choosing would read an empty menu and report "your
// answer was not in the list" for a list that contained it. The fixture
// below empties itself on a `setTimeout(…, 0)` for exactly that reason, so
// the test fails if anybody makes the write path asynchronous.
import { beforeEach, describe, expect, it } from 'vitest';
import type { AtsDefinition } from '../../src/ats/registry';
import { chooseListboxOption, planListboxes } from '../../src/fill/listbox';
import type { ListboxDescriptor, ListboxSelectors } from '../../src/fill/types';
import { applyListboxes, selectFromListbox } from '../../src/fill/write';

const SELECTORS: ListboxSelectors = {
  container: '[data-automation-id^="formField-"]',
  trigger: 'button[aria-haspopup="listbox"]',
  option: '[role="option"]',
  display: '.display',
};

const ATS: AtsDefinition = {
  id: 'workday',
  label: 'Workday',
  hosts: ['*.myworkdayjobs.com'],
  fields: { 'formField-countryRegion': 'country', 'formField-city': 'city' },
  listbox: SELECTORS,
};

const box = (over: Partial<ListboxDescriptor> = {}): ListboxDescriptor => ({
  ref: 'lb0',
  automationId: 'formField-countryRegion',
  label: 'Country',
  current: '',
  ...over,
});

beforeEach(() => {
  document.body.innerHTML = '';
});

describe('planListboxes', () => {
  it('selects when the automation id is mapped and a value exists', () => {
    expect(planListboxes([box()], { country: 'Spain' }, ATS)).toEqual([
      { action: 'select', ref: 'lb0', label: 'Country', kind: 'country', value: 'Spain' },
    ]);
  });

  it('refuses a dropdown it cannot name rather than guessing', () => {
    // No label heuristics here on purpose. A listbox has no `name`, and a
    // wrong guess on a dropdown is a wrong answer submitted, not a gap.
    const [only] = planListboxes(
      [box({ automationId: 'formField-mystery' })],
      { country: 'Spain' },
      ATS,
    );
    expect(only).toMatchObject({ action: 'skip', reason: 'unrecognised' });
  });

  it('leaves an answered question alone', () => {
    const [only] = planListboxes([box({ current: 'Ireland' })], { country: 'Spain' }, ATS);
    expect(only).toMatchObject({ action: 'skip', reason: 'already-filled' });
  });

  it('skips when the vault has nothing for it', () => {
    expect(planListboxes([box()], {}, ATS)[0]).toMatchObject({
      action: 'skip',
      reason: 'no-value',
    });
  });

  it('reports every dropdown unsupported on an ATS with no listbox contract', () => {
    const plain: AtsDefinition = { ...ATS, listbox: undefined };
    expect(planListboxes([box()], { country: 'Spain' }, plain)[0]).toMatchObject({
      action: 'skip',
      reason: 'unsupported',
    });
  });
});

describe('chooseListboxOption', () => {
  it('matches exactly, ignoring case and surrounding space', () => {
    expect(chooseListboxOption(['Ireland', ' spain ', 'Portugal'], 'Spain')).toBe(1);
  });

  it('refuses a short prefix, which is a coincidence rather than a match', () => {
    expect(chooseListboxOption(['Usually', 'United States'], 'US')).toBeNull();
  });

  it('refuses an ambiguous match rather than picking the first', () => {
    expect(chooseListboxOption(['United States', 'United Kingdom'], 'United')).toBeNull();
  });

  it('returns null for an empty menu', () => {
    expect(chooseListboxOption([], 'Spain')).toBeNull();
  });
});

// ── The one-task constraint ────────────────────────────────────────────────

/**
 * A dropdown that behaves the way Workday is documented to: the menu is
 * built when the trigger is clicked and emptied on the next task.
 */
function renderDropdown(options: string[]): Element {
  document.body.innerHTML = `
    <div data-automation-id="formField-countryRegion">
      <span class="display"></span>
      <button aria-haspopup="listbox">Country</button>
      <div class="menu"></div>
    </div>`;
  const container = document.querySelector('[data-automation-id]') as Element;
  const menu = container.querySelector('.menu') as HTMLElement;
  container.querySelector('button')?.addEventListener('click', () => {
    menu.innerHTML = options.map((o) => `<div role="option">${o}</div>`).join('');
    setTimeout(() => {
      menu.innerHTML = '';
    }, 0);
  });
  menu.addEventListener('click', (e) => {
    const t = e.target as HTMLElement;
    if (t.getAttribute('role') === 'option') {
      (container.querySelector('.display') as HTMLElement).textContent = t.textContent;
    }
  });
  return container;
}

describe('selectFromListbox', () => {
  it('opens, reads and picks inside one task', () => {
    const container = renderDropdown(['Ireland', 'Spain', 'Portugal']);
    const result = selectFromListbox(container, 'Spain', SELECTORS);
    expect(result).toEqual({ ok: true, chosen: 'Spain' });
    expect(container.querySelector('.display')?.textContent).toBe('Spain');
  });

  it('a click the overlay would have swallowed still reaches the trigger', () => {
    // The spike measured a real click timing out under Workday's overlay
    // while a dispatched one landed. This asserts the dispatched shape:
    // pointerdown, mousedown, mouseup, click, all composed.
    const container = renderDropdown(['Spain']);
    const seen: string[] = [];
    const button = container.querySelector('button') as Element;
    for (const type of ['pointerdown', 'mousedown', 'mouseup', 'click']) {
      button.addEventListener(type, (e) => seen.push(`${e.type}:${(e as UIEvent).composed}`));
    }
    selectFromListbox(container, 'Spain', SELECTORS);
    expect(seen).toEqual(['pointerdown:true', 'mousedown:true', 'mouseup:true', 'click:true']);
  });

  it('leaves the field alone when the answer is not in the list', () => {
    const container = renderDropdown(['Ireland', 'Portugal']);
    expect(selectFromListbox(container, 'Spain', SELECTORS)).toEqual({
      ok: false,
      reason: 'no-match',
    });
    expect(container.querySelector('.display')?.textContent).toBe('');
  });

  it('reports an empty menu rather than claiming no match', () => {
    const container = renderDropdown([]);
    expect(selectFromListbox(container, 'Spain', SELECTORS)).toEqual({
      ok: false,
      reason: 'no-options',
    });
  });

  it('refuses a container detached since it was described', () => {
    const container = renderDropdown(['Spain']);
    container.remove();
    expect(selectFromListbox(container, 'Spain', SELECTORS)).toEqual({
      ok: false,
      reason: 'no-trigger',
    });
  });

  it('would fail if the menu were read one task later', async () => {
    // Not a test of our code — a test that the fixture really does close.
    // Without this, every check above could be passing against a menu that
    // simply never goes away, which is the assumption the whole synchronous
    // design exists to avoid.
    const container = renderDropdown(['Spain']);
    container.querySelector('button')?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    expect(container.querySelectorAll('[role="option"]')).toHaveLength(1);
    await new Promise((r) => setTimeout(r, 0));
    expect(container.querySelectorAll('[role="option"]')).toHaveLength(0);
  });
});

describe('applyListboxes', () => {
  it('counts a selection and passes a failure through with its reason', () => {
    const container = renderDropdown(['Ireland']);
    const elements = new Map<string, Element>([['lb0', container]]);
    const out = applyListboxes(
      [{ action: 'select', ref: 'lb0', label: 'Country', kind: 'country', value: 'Spain' }],
      elements,
      SELECTORS,
    );
    expect(out.selected).toBe(0);
    expect(out.failures[0]?.detail).toContain('"Spain" was not among the options');
  });

  it('counts skips without touching the page', () => {
    const out = applyListboxes(
      [{ action: 'skip', ref: 'lb0', label: 'Country', reason: 'no-value' }],
      new Map(),
      SELECTORS,
    );
    expect(out).toEqual({ selected: 0, skipped: 1, failures: [] });
  });

  it('treats every dropdown as skipped when the ATS has no contract for them', () => {
    const out = applyListboxes(
      [{ action: 'select', ref: 'lb0', label: 'Country', kind: 'country', value: 'Spain' }],
      new Map(),
      undefined,
    );
    expect(out).toEqual({ selected: 0, skipped: 1, failures: [] });
  });
});
