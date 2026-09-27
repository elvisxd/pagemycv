// Paste this into the DevTools console on a real Workday application page.
//
// It answers the one thing spikes/phase-4 could not: whether the selectors
// and the data-automation-id map in src/ats/registry.ts match a real tenant.
// Those are the only part of Phase 4 that is a hypothesis — the shadow-root
// question is settled, and this does not need to re-ask it.
//
// WHAT IT COLLECTS: attribute names, tag names, roles, and label text.
// WHAT IT NEVER COLLECTS: the value of any field. Every `value` is dropped
// before the report is built, not filtered out of it afterwards, so a half
// filled application cannot leak through a copy-paste. Check the code below
// rather than taking this comment's word for it.
//
// IT WRITES NOTHING. `report()` only reads. `probeDropdown()` is separate and
// opt-in because it clicks a menu open, and that is your page, not mine.
(() => {
  const SELECTOR = 'input, select, textarea';

  /** Light DOM plus every OPEN shadow root. A closed one is invisible here —
   *  which is itself a useful answer, and is counted below. */
  const deepAll = (root, sel, out = [], depth = 0) => {
    if (depth > 20) return out;
    for (const el of root.querySelectorAll('*')) {
      if (el.matches?.(sel)) out.push(el);
      if (el.shadowRoot) deepAll(el.shadowRoot, sel, out, depth + 1);
    }
    return out;
  };

  const labelOf = (el) => {
    const root = el.getRootNode();
    const byFor = el.id ? root.querySelector(`label[for="${CSS.escape(el.id)}"]`) : null;
    const text = (byFor ?? el.closest('label'))?.textContent ?? el.getAttribute('aria-label') ?? '';
    return text.replace(/\s+/g, ' ').trim().slice(0, 120);
  };

  const report = () => {
    const controls = deepAll(document, SELECTOR).map((el) => ({
      tag: el.tagName.toLowerCase(),
      type: el.getAttribute('type') ?? '',
      automationId: el.getAttribute('data-automation-id') ?? '',
      name: el.getAttribute('name') ?? '',
      // Deliberately no `value`. See the header.
      label: labelOf(el),
      required: el.required === true,
    }));

    const dropdowns = deepAll(document, '[data-automation-id]')
      .filter((el) => el.querySelector('button[aria-haspopup], [role="combobox"]'))
      .map((el) => ({
        automationId: el.getAttribute('data-automation-id') ?? '',
        label: labelOf(el) || (el.querySelector('label')?.textContent ?? '').trim().slice(0, 80),
        trigger: (() => {
          const t = el.querySelector('button[aria-haspopup], [role="combobox"]');
          return t
            ? { tag: t.tagName.toLowerCase(), role: t.getAttribute('role') ?? '',
                haspopup: t.getAttribute('aria-haspopup') ?? '' }
            : null;
        })(),
      }));

    // Custom elements the page world cannot see into. If this is non-zero the
    // fields are behind closed roots, which is exactly the case the extension
    // already handles and this console cannot.
    const customElements = [...document.querySelectorAll('*')].filter((el) =>
      el.tagName.includes('-'),
    );
    const opaque = customElements.filter((el) => el.shadowRoot === null && !el.children.length);

    return {
      url: location.origin + location.pathname,
      controlsVisibleFromThePage: controls.length,
      customElements: customElements.length,
      customElementsWeCannotSeeInto: opaque.length,
      automationIds: [...new Set(controls.map((c) => c.automationId).filter(Boolean))].sort(),
      controls,
      dropdowns,
      progressList: [...document.querySelectorAll('[data-automation-id*="progress" i]')].map(
        (el) => ({
          automationId: el.getAttribute('data-automation-id'),
          steps: (el.textContent ?? '').replace(/\s+/g, ' ').trim().slice(0, 300),
        }),
      ),
    };
  };

  /**
   * Opt-in, and it clicks. Run it with the automation id of one dropdown to
   * find out whether its menu really is gone by the next task — the claim the
   * whole synchronous design rests on, which spikes/phase-4 could only model.
   */
  const probeDropdown = (automationId) => {
    const box = document.querySelector(`[data-automation-id="${automationId}"]`);
    if (!box) return { found: false };
    const trigger = box.querySelector('button[aria-haspopup], [role="combobox"]');
    if (!trigger) return { found: true, trigger: false };
    trigger.dispatchEvent(new MouseEvent('click', { bubbles: true, composed: true }));
    const sameTask = document.querySelectorAll('[role="option"]').length;
    return new Promise((r) =>
      setTimeout(
        () =>
          r({
            found: true,
            optionsInTheOpeningTask: sameTask,
            optionsOneTaskLater: document.querySelectorAll('[role="option"]').length,
            optionsRenderedInsideTheField: box.querySelectorAll('[role="option"]').length,
            note: 'If the two counts differ, the synchronous open-and-pick is required.',
          }),
        0,
      ),
    );
  };

  globalThis.pagemycv = { report, probeDropdown };
  const out = report();
  console.log(JSON.stringify(out, null, 2));
  copy?.(JSON.stringify(out, null, 2));
  console.log(
    '%cCopied. Nothing above contains a field value — check the source if you want to be sure.',
    'font-weight:bold',
  );
  console.log('Then: await pagemycv.probeDropdown("formField-countryRegion")');
  return out;
})();
