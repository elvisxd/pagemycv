// Choosing which frame holds the application form.
//
// A company careers page embeds the board in an iframe, and the page can have
// several: the form, a cookie banner, an analytics pixel, a video. Only frames
// running our content script ever answer the roll call, so the candidates are
// already limited to the two job boards — but "already limited" is not "one",
// and picking the wrong one would fill the wrong form.
//
// Pure, so the rule can be tested without a browser.
import { atsForUrl } from '../ats/registry';

export interface FrameReport {
  /** Chrome's per-tab frame id. 0 is the top frame. */
  frameId: number;
  url: string;
  /** How many form controls that frame can see. */
  fields: number;
}

export interface FrameChoice {
  frame: FrameReport;
  /** The others, kept so the panel can say a choice was made. */
  alternatives: FrameReport[];
}

/**
 * The frame to fill, or null when none of them holds a form.
 *
 * Most fields wins, and a tie is broken by taking the top frame first and then
 * the lowest frame id. Deterministic on purpose: the same page must produce
 * the same answer twice, because a fill that lands somewhere different on the
 * second run is worse than one that refuses.
 */
export function chooseFrame(frames: readonly FrameReport[]): FrameChoice | null {
  const candidates = frames.filter((f) => f.fields > 0 && atsForUrl(f.url).id !== 'unknown');
  if (candidates.length === 0) return null;

  const ranked = [...candidates].sort((a, b) => {
    if (b.fields !== a.fields) return b.fields - a.fields;
    if (a.frameId !== b.frameId) return a.frameId - b.frameId;
    return a.url.localeCompare(b.url);
  });
  const [best, ...alternatives] = ranked;
  // `ranked` is non-empty, which the filter above already established.
  return { frame: best as FrameReport, alternatives };
}

/**
 * How the panel describes where it filled, when that was not the page itself.
 *
 * Silence here would be wrong: the user clicked on a company careers page and
 * the values went into a form served by somebody else. Saying so is the
 * difference between a tool that is trusted and one that is merely convenient.
 */
export function describeFrame(choice: FrameChoice): string | null {
  if (choice.frame.frameId === 0) return null;
  const ats = atsForUrl(choice.frame.url);
  const extra =
    choice.alternatives.length > 0
      ? `, of ${choice.alternatives.length + 1} embedded forms on this page`
      : '';
  return `Filled the ${ats.label} form embedded on this page${extra}.`;
}
