// Getting a content script in front of a form, on a site we may never have
// heard of.
//
// Two ways in. The manifest declares the script for the boards we know, so
// on those — and inside their embeds — the roll call finds it listening at
// once. Anywhere else nothing answers, and the only remaining way is to
// inject the same script into the active tab, which Chrome permits exactly
// when the person has just invoked the extension on that tab.
//
// This file holds the decision and nothing Chrome-specific, so the decision
// can be tested. The injection itself is src/fill/inject.ts, which CI cannot
// drive (spikes/phase-6); what CI can drive is everything around it,
// including Chrome's refusal, which is real in the gate.
import type { RollCallResult } from './roll-call';

export interface ReachDeps {
  rollCall(): Promise<RollCallResult>;
  inject(): Promise<void>;
  isAccessRefused(err: unknown): boolean;
}

export interface ReachOutcome {
  result: RollCallResult;
  /** True when the script had to be injected to get an answer. */
  injected: boolean;
}

/**
 * What the person reads when Chrome refuses the injection. It names the one
 * action that grants it, and says why the known boards do not need it, so
 * it does not read as "this site is unsupported" — it is not.
 */
export function needsIconClick(boards: string): string {
  return (
    `PageMyCV cannot read this page yet. Click the PageMyCV icon in the toolbar while ` +
    `this tab is open — that lets it read this one page, and nothing else — then press ` +
    `Fill again. On ${boards} it works without that.`
  );
}

export async function reachForm(deps: ReachDeps, boards: string): Promise<ReachOutcome> {
  const first = await deps.rollCall();
  if (first.reachable) return { result: first, injected: false };

  // Nothing listening. Inject, or learn that Chrome will not let us.
  try {
    await deps.inject();
  } catch (err) {
    if (deps.isAccessRefused(err)) throw new Error(needsIconClick(boards));
    throw err;
  }

  // Injected, so this roll call is answered by code that just started.
  return { result: await deps.rollCall(), injected: true };
}
