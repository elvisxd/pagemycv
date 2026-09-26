// Layer two of two, and the one that actually holds. See docs/03-security.md,
// invariant 3.
//
// The rule is a pure function over measurements rather than over an element,
// for two reasons. It can be tested exhaustively without a browser, and the
// measurements are taken once per field instead of once per check, which
// matters because getComputedStyle and getBoundingClientRect both force
// layout and a long application form has a hundred controls.
import type { VisibilityMetrics } from './types';

/**
 * Smaller than this in either direction and no human is typing into it. A 1x1
 * input is the oldest hidden-field trick there is; a few spam libraries use
 * 2x2 or 3x3 to dodge exactly this check, so the threshold is not 1.
 */
const MIN_EDGE = 4;

/**
 * How far outside the document a field may sit before it counts as parked
 * off-screen rather than merely scrolled out of view.
 *
 * The distinction matters: a field below the fold is a normal field on a long
 * form and must be filled, while `left: -9999px` is a field nobody can reach.
 * Measuring against the document rather than the viewport is what tells them
 * apart, plus a margin for layouts that legitimately overhang slightly.
 */
const OFFSCREEN_MARGIN = 200;

/** The reason this field is not writable, or null when it is. */
export function visibilityProblem(m: VisibilityMetrics): string | null {
  if (m.detached) return 'no layout box: display:none on it or an ancestor';
  if (m.display === 'none') return 'display:none';
  if (m.visibility === 'hidden' || m.visibility === 'collapse') return `visibility:${m.visibility}`;
  if (m.hiddenAttribute) return 'hidden, inert or aria-hidden';
  // The browser's own answer, which accounts for every ancestor. An ancestor
  // with `opacity: 0` is invisible to the per-element checks below, because
  // opacity does not inherit: the field's own computed opacity is still 1.
  if (!m.browserVisible) return 'an ancestor makes it invisible';
  if (m.clipped) return 'clipped to nothing by an ancestor';

  const opacity = Number.parseFloat(m.opacity);
  // Not `=== 0`: 0.01 is as unreadable as 0 and is what a form that knows
  // about this check uses. NaN means the property was unreadable, which is
  // not evidence of visibility either way, so it does not trip the rule.
  if (Number.isFinite(opacity) && opacity < 0.05) return `opacity:${m.opacity}`;

  if (m.width < MIN_EDGE || m.height < MIN_EDGE) {
    return `${Math.round(m.width)}x${Math.round(m.height)} is too small to be a real field`;
  }

  // Off the left or top edge is always parked; nothing lays out at -9999px.
  if (m.left + m.width < -OFFSCREEN_MARGIN || m.top + m.height < -OFFSCREEN_MARGIN) {
    return `positioned off-screen at ${Math.round(m.left)},${Math.round(m.top)}`;
  }
  // Off the right or bottom has to be measured against the whole document,
  // because the viewport is only a window onto it and a long form is mostly
  // below the fold. Guard against a zero document size, which means the
  // measurement failed rather than that everything is off-screen.
  if (m.documentWidth > 0 && m.left > m.documentWidth + OFFSCREEN_MARGIN) {
    return `positioned past the right edge of the document at ${Math.round(m.left)}`;
  }
  if (m.documentHeight > 0 && m.top > m.documentHeight + OFFSCREEN_MARGIN) {
    return `positioned past the bottom of the document at ${Math.round(m.top)}`;
  }
  return null;
}

export function isVisible(m: VisibilityMetrics): boolean {
  return visibilityProblem(m) === null;
}
