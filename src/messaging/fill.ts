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
import type { FieldDescriptor, FillReport, FillRequest } from '../fill/types';

export interface PageSurvey {
  url: string;
  /** Every control on the page, flattened. Page text, treated as data. */
  fields: FieldDescriptor[];
}

interface FillProtocol {
  /** Read the page. Writes nothing. */
  'fill:describe'(): PageSurvey;
  /** Execute a plan the background built. Returns what actually happened. */
  'fill:apply'(data: FillRequest): FillReport;
  /** Remove the outlines this extension drew. */
  'fill:clear'(): { cleared: true };
}

export const { sendMessage: sendFill, onMessage: onFill } =
  defineExtensionMessaging<FillProtocol>();
