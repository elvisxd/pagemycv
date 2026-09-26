// @vitest-environment jsdom
//
// The two modules that touch the page. Everything else in src/fill is pure and
// tested without a DOM, but these two ARE the DOM boundary, and the review
// found real bugs in both that no amount of reading caught. jsdom is enough
// for the parts that matter here: attributes, structure, prototype setters,
// events and isConnected. Layout and DataTransfer are not, which is what
// tests/e2e/gate.cjs exists for.
import { beforeEach, describe, expect, it } from 'vitest';
import type { Control } from '../../src/fill/descriptor';
import { describeForm, fingerprintOf, labelFor } from '../../src/fill/descriptor';
import type { FillValues, PlannedField } from '../../src/fill/types';
import { applyPlan, clearHighlights } from '../../src/fill/write';

function render(html: string): Document {
  document.body.innerHTML = html;
  return document;
}

function control(selector: string): Control {
  const el = document.querySelector<Control>(selector);
  if (!el) throw new Error(`no element for ${selector}`);
  return el;
}

beforeEach(() => {
  document.body.innerHTML = '';
});

// ── labelFor ────────────────────────────────────────────────────────────────

describe('labelFor', () => {
  it('prefers an explicit label[for]', () => {
    render('<label for="a">Email address</label><input id="a" name="x">');
    expect(labelFor(control('#a'))).toBe('Email address');
  });

  it('reads aria-labelledby, joining the parts', () => {
    render(
      '<span id="l1">Current</span><span id="l2">employer</span><input aria-labelledby="l1 l2">',
    );
    expect(labelFor(control('input'))).toBe('Current employer');
  });

  it('reads a wrapping label without swallowing the control value', () => {
    render('<label>Full name <input value="typed"></label>');
    expect(labelFor(control('input'))).toBe('Full name');
  });

  it('reads a sibling label, which is what both boards actually emit', () => {
    render('<div class="field"><label>LinkedIn Profile</label><input name="q1"></div>');
    expect(labelFor(control('input'))).toBe('LinkedIn Profile');
  });

  it('reads a span in the field group when there is no <label> at all', () => {
    render('<div class="field"><span class="label">Portfolio</span><input name="q2"></div>');
    expect(labelFor(control('input'))).toBe('Portfolio');
  });

  it('does NOT borrow the label of a sibling field from a shared container', () => {
    // The bug this test exists for. `closest(…, 'div')` matches almost
    // anything, so taking the first label-ish descendant of a container that
    // holds several fields hands the second field the first field's label —
    // which is how a value ends up in the right-looking wrong box.
    render(`
      <div class="fields">
        <label for="email">Email</label>
        <input id="email" name="email">
        <input name="salary_expected">
      </div>
    `);
    expect(labelFor(control('#email'))).toBe('Email');
    expect(labelFor(control('[name="salary_expected"]'))).toBe('');
  });

  it('refuses a consent paragraph as a label, because prose is not a question', () => {
    const prose = `I agree that my salary information and email address may be
      processed in accordance with the policy, and I confirm that everything
      stated above is accurate to the best of my knowledge, and I understand
      that this consent may be withdrawn at any time by contacting the team.`;
    render(`<label>${prose}<input name="consent_ack"></label>`);
    expect(labelFor(control('input'))).toBe('');
  });
});

// ── fingerprintOf ───────────────────────────────────────────────────────────

describe('fingerprintOf', () => {
  it('changes when the attributes that say what a field IS change', () => {
    render('<input id="a" name="email" type="email">');
    const el = control('#a');
    const before = fingerprintOf(el);
    el.setAttribute('name', 'salary_expected');
    expect(fingerprintOf(el)).not.toBe(before);
  });

  it('does not change when only the surrounding label does', () => {
    render('<div class="field"><label>Email</label><input name="email" type="email"></div>');
    const before = fingerprintOf(control('input'));
    const label = document.querySelector('label');
    if (label) label.textContent = 'Email address *';
    expect(fingerprintOf(control('input'))).toBe(before);
  });
});

// ── describeForm ────────────────────────────────────────────────────────────

describe('describeForm', () => {
  it('pairs every descriptor with its element and its own fingerprint', () => {
    render(
      '<input name="a"><select name="b"><option>x</option></select><textarea name="c"></textarea>',
    );
    const { fields, elements } = describeForm(document);
    expect(fields).toHaveLength(3);
    for (const f of fields) {
      const el = elements.get(f.ref);
      expect(el, f.ref).toBeTruthy();
      expect(fingerprintOf(el as Control)).toBe(f.fingerprint);
    }
  });

  it('treats an untouched select as empty, since its first option is its value', () => {
    render(
      '<select name="country"><option value="">Pick…</option><option value="US">US</option></select>',
    );
    const { fields } = describeForm(document);
    expect(fields[0]?.hasValue).toBe(false);
  });

  it('sees a value somebody already typed', () => {
    render('<input name="email" value="someone@example.test">');
    expect(describeForm(document).fields[0]?.hasValue).toBe(true);
  });
});

// ── applyPlan ───────────────────────────────────────────────────────────────

function fillAction(over: Partial<Extract<PlannedField, { action: 'fill' }>> = {}) {
  return {
    action: 'fill' as const,
    ref: 'f0',
    fingerprint: 'input|text|email|',
    label: 'Email',
    kind: 'email' as keyof FillValues,
    strategy: 'ats' as const,
    confidence: 0.9,
    value: 'ada@lovelace.test',
    ...over,
  };
}

describe('applyPlan', () => {
  it('writes the value and announces it the way a paste does', () => {
    render('<input name="email">');
    const el = control('input');
    const seen: string[] = [];
    for (const type of ['input', 'change', 'keydown', 'keyup', 'submit']) {
      el.addEventListener(type, (e) => seen.push(e.type));
    }
    const report = applyPlan([fillAction()], new Map([['f0', el]]), null, 'u', 'lever');
    expect(el.value).toBe('ada@lovelace.test');
    expect(report.filled).toBe(1);
    expect(seen).toEqual(['input', 'change']);
  });

  it('goes through the prototype setter, so a framework notices', () => {
    // A framework installs its own value setter on the instance to track
    // edits. Assigning el.value would go through that and leave the DOM and
    // the framework's record disagreeing, so the next render puts the old
    // value back.
    render('<input name="email">');
    const el = control('input') as HTMLInputElement;
    let throughInstance = false;
    Object.defineProperty(el, 'value', {
      configurable: true,
      get: () => 'intercepted',
      set: () => {
        throughInstance = true;
      },
    });
    applyPlan([fillAction()], new Map([['f0', el]]), null, 'u', 'lever');
    expect(throughInstance).toBe(false);
  });

  it('refuses to write through a reference the page has detached', () => {
    render('<input name="email">');
    const el = control('input');
    el.remove();
    const report = applyPlan([fillAction()], new Map([['f0', el]]), null, 'u', 'lever');
    expect(report.filled).toBe(0);
    expect(report.failures[0]?.detail).toMatch(/removed from the page/);
  });

  it('refuses to write when the element became a DIFFERENT field', () => {
    // The worst bug this code could have: a framework reuses the node and
    // changes its name, so the reference is still live and no longer the same
    // question. Writing through it puts the email in the salary box and
    // reports a success.
    render('<input name="email" type="text">');
    const el = control('input');
    el.setAttribute('name', 'salary_expected');
    const report = applyPlan([fillAction()], new Map([['f0', el]]), null, 'u', 'lever');
    expect(report.filled).toBe(0);
    expect(el.value).toBe('');
    expect(report.failures[0]?.detail).toMatch(/changed while the plan was being built/);
  });

  it('writes the chosen option value rather than the display text', () => {
    render(
      '<select name="country"><option value="">Pick…</option><option value="US">United States</option></select>',
    );
    const el = control('select');
    const report = applyPlan(
      [
        fillAction({
          fingerprint: 'select|select-one|country|',
          value: 'United States',
          optionValue: 'US',
        }),
      ],
      new Map([['f0', el]]),
      null,
      'u',
      'lever',
    );
    expect((el as HTMLSelectElement).value).toBe('US');
    expect(report.filled).toBe(1);
  });

  it('counts skips without touching anything', () => {
    render('<input name="gender">');
    const el = control('input');
    const report = applyPlan(
      [
        {
          action: 'skip',
          ref: 'f0',
          label: 'Gender',
          reason: 'sensitive',
          detail: 'yours to answer',
          sensitiveKey: 'gender',
        },
      ],
      new Map([['f0', el]]),
      null,
      'u',
      'lever',
    );
    expect(el.value).toBe('');
    expect(report.skipped).toBe(1);
    expect(report.filled).toBe(0);
  });

  it("restores the page's own outline styling exactly", () => {
    render('<input name="email" style="outline: 1px dashed red; outline-offset: 4px">');
    const el = control('input');
    applyPlan([fillAction()], new Map([['f0', el]]), null, 'u', 'lever');
    expect(el.style.outline).not.toBe('1px dashed red');
    clearHighlights([el]);
    expect(el.style.outline).toBe('1px dashed red');
    expect(el.style.outlineOffset).toBe('4px');
  });
});
