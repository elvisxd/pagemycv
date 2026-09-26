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
     * control would be a fingerprint the page could read back, and a page that
     * can tell it is being autofilled is a page that can behave differently
     * while it is.
     */
    let elements = new Map<string, Control>();

    onFill('fill:describe', () => {
      const survey = describeForm(document);
      elements = survey.elements;
      return { url: location.href, fields: survey.fields };
    });

    onFill('fill:apply', ({ data }) =>
      applyPlan(data.plan.fields, elements, data.resume, location.href, data.plan.ats),
    );

    onFill('fill:clear', () => {
      clearHighlights(elements.values());
      return { cleared: true } as const;
    });
  },
});
