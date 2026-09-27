// Background to content script, and nothing else.
//
// Keys are prefixed 'fill:' for the same reason the other two channels carry
// their own prefix: the extension messenger has no namespace option, so a
// context that has not registered a key simply does not answer it. This is
// the only channel a content script ever sees, so a page that somehow reached
// the messenger still cannot ask the background to unlock a vault.
//
// The split is deliberate. The content script describes the page and the
// background decides, which means the only values that ever cross into the
// tab's process are the ones the plan is actually going to write. Letting the
// content script hold the whole profile and choose for itself would be one
// less round trip and a great deal more data sitting in a page's isolated
// world.
import { defineExtensionMessaging } from '@webext-core/messaging';
import type { FrameReport } from '../fill/frames';
import type { FieldDescriptor, FillReport, FillRequest } from '../fill/types';

export interface PageSurvey {
  url: string;
  /** Every control on the page, flattened. Page text, treated as data. */
  fields: FieldDescriptor[];
  /**
   * Which describe pass produced this. The plan built from it carries the
   * same number back, and the content script refuses a plan from an older
   * pass: two panels filling the same tab would otherwise have the second
   * describe overwrite the element map the first plan was built against.
   */
  generation: number;
}

interface FillProtocol {
  /**
   * Broadcast to every frame of a tab. Each one answers by sending `fill:here`
   * BACK to the background, which is the point: a message travelling that
   * direction carries `sender.frameId`, and that is the only way to learn a
   * frame's id without the `webNavigation` permission. Proven in
   * spikes/phase-3.
   *
   * The reply to this message is deliberately useless. A broadcast with no
   * frameId resolves with whichever frame answers first, so the roll call is
   * collected from the `fill:here` messages instead.
   */
  'fill:rollCall'(): { ack: true };
  /** Content script to background. Read for its sender, not its payload. */
  'fill:here'(data: Omit<FrameReport, 'frameId'>): { ack: true };
  /** Read the page. Writes nothing. */
  'fill:describe'(): PageSurvey;
  /** Execute a plan the background built. Returns what actually happened. */
  'fill:apply'(data: FillRequest): FillReport;
  /** Remove the outlines this extension drew. */
  'fill:clear'(): { cleared: true };
}

export const { sendMessage: sendFill, onMessage: onFill } =
  defineExtensionMessaging<FillProtocol>();
