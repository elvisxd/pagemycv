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
import { atsForUrl, CONTENT_MATCHES } from '../ats/registry';
import type { Control } from '../fill/descriptor';
import { countFillable, describeForm, describeListboxes } from '../fill/descriptor';
import { applyListboxes, applyPlan, clearHighlights } from '../fill/write';
import { onFill, sendFill } from '../messaging/fill';

export default defineContentScript({
  matches: [...CONTENT_MATCHES],
  /**
   * The whole of Phase 3, as it turned out.
   *
   * A company careers page embeds the board in a cross-origin iframe. Chrome
   * injects this script into that iframe because ITS origin is on the match
   * list, and it does so without any permission over the page that embeds it:
   * spikes/phase-3 confirms the parent is never injected and the background
   * cannot reach it. The plan expected to need a broad host permission
   * requested at runtime; it does not need one at all.
   *
   * `matchAboutBlank` covers an about:blank or srcdoc frame, which inherits
   * its PARENT's origin. That is a security question rather than a feature,
   * and the spike answers it: such a frame under an origin we do not match is
   * not injected, so this cannot become a way into the company's own page.
   */
  allFrames: true,
  matchAboutBlank: true,
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
    /** The same, for custom dropdowns, which are containers rather than controls. */
    let listboxes = new Map<string, Element>();
    /**
     * Bumped on every describe. A plan carries the number it was built from,
     * and a plan from an older pass is refused rather than applied to the
     * newer pass's elements: two panels, or one panel clicked twice, would
     * otherwise interleave a describe between the other's describe and apply.
     */
    let generation = 0;

    /**
     * What this frame is, for the background's roll call.
     *
     * The count comes from descriptor.ts rather than from a selector written
     * out again here. The two had already drifted: this counted every
     * control, hidden inputs and submit buttons included, and that count is
     * what ranks frames against each other when a careers page embeds more
     * than one form.
     */
    const self = () => ({ url: location.href, fields: countFillable(document) });

    // Sent TO the background, so it arrives carrying this frame's id. A reply
    // to a broadcast cannot do that: the broadcast resolves with whichever
    // frame answers first and the rest are lost.
    onFill('fill:rollCall', () => {
      sendFill('fill:here', self()).catch(() => {});
      return { ack: true } as const;
    });

    onFill('fill:describe', () => {
      const survey = describeForm(document);
      elements = survey.elements;
      // Only where the ATS says it has custom dropdowns. Running the pass on
      // Lever or Greenhouse would be looking for a mechanism they do not use
      // and reporting whatever happened to match.
      const selectors = atsForUrl(location.href).listbox;
      const boxes = selectors
        ? describeListboxes(document, selectors)
        : { boxes: [], elements: new Map<string, Element>() };
      listboxes = boxes.elements;
      generation++;
      return { url: location.href, fields: survey.fields, listboxes: boxes.boxes, generation };
    });

    onFill('fill:apply', ({ data }) => {
      if (data.generation !== generation) {
        throw new Error(
          'the page was read again before this fill could run, so nothing was written. Try again.',
        );
      }
      const report = applyPlan(
        data.plan.fields,
        elements,
        data.documents,
        location.href,
        data.plan.ats,
      );
      const dropdowns = applyListboxes(
        data.plan.listboxes,
        listboxes,
        atsForUrl(location.href).listbox,
      );
      return {
        ...report,
        selected: dropdowns.selected,
        skipped: report.skipped + dropdowns.skipped,
        failures: [...report.failures, ...dropdowns.failures],
        declined: dropdowns.declined,
      };
    });

    onFill('fill:clear', () => {
      clearHighlights(elements.values());
      return { cleared: true } as const;
    });
  },
});
