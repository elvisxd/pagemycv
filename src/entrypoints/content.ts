// The only code that runs inside a job board's page.
//
// It reads the form and it writes the plan it is handed. It does not decide
// what to write, it holds no profile data between calls, and it has no path
// to the vault: the whole of its authority is the three keys in
// src/messaging/fill.ts.
//
// Registered for the two Phase 2 hosts only, declared from the same list the
// ATS registry uses, so adding a board cannot quietly widen the extension's
// reach without also changing the registry the classifier reads.
import { defineContentScript } from 'wxt/utils/define-content-script';
import { CONTENT_MATCHES } from '../ats/registry';
import type { Control } from '../fill/descriptor';
import { describeForm } from '../fill/descriptor';
import { applyPlan, clearHighlights } from '../fill/write';
import { onFill } from '../messaging/fill';

export default defineContentScript({
  matches: [...CONTENT_MATCHES],
  // The boards render their form with client-side script, so waiting for the
  // parse to finish is not enough on the newer Greenhouse board.
  runAt: 'document_idle',
  main() {
    /**
     * The elements behind the last description, keyed by ref.
     *
     * Held here rather than marked on the page: a `data-*` attribute on every
     * control would announce the scan itself, including for the fields that
     * are then refused. The values that ARE written are visible to the page
     * either way; the list of what was considered does not have to be.
     */
    let elements = new Map<string, Control>();
    /**
     * Bumped on every describe. A plan carries the number it was built from,
     * and a plan from an older pass is refused rather than applied to the
     * newer pass's elements: two panels, or one panel clicked twice, would
     * otherwise interleave a describe between the other's describe and apply.
     */
    let generation = 0;

    onFill('fill:describe', () => {
      const survey = describeForm(document);
      elements = survey.elements;
      generation++;
      return { url: location.href, fields: survey.fields, generation };
    });

    onFill('fill:apply', ({ data }) => {
      if (data.generation !== generation) {
        throw new Error(
          'the page was read again before this fill could run, so nothing was written. Try again.',
        );
      }
      return applyPlan(data.plan.fields, elements, data.resume, location.href, data.plan.ats);
    });

    onFill('fill:clear', () => {
      clearHighlights(elements.values());
      return { cleared: true } as const;
    });
  },
});
