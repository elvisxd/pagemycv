import { describe, expect, it } from 'vitest';
import type { FrameReport } from '../../src/fill/frames';
import type { RollCallDeps } from '../../src/fill/roll-call';
import { isNoListener, rollCall } from '../../src/fill/roll-call';

const TIMING = { perPass: 250, budget: 2000, silenceBudget: 900 };

const board = (over: Partial<FrameReport> = {}): FrameReport => ({
  frameId: 3,
  url: 'https://boards.greenhouse.io/embed/job_app?for=acme&token=1',
  fields: 9,
  ...over,
});

/** What `@webext-core/messaging` actually throws. See isNoListener. */
const NO_LISTENER = new Error('No response');

/**
 * A fake tab. Time is a counter rather than a clock, so a two-second budget
 * costs nothing to test and the number of passes is exact rather than
 * approximate.
 */
function harness(script: (pass: number) => FrameReport[] | Error | 'unreachable') {
  let clock = 0;
  let pass = 0;
  let answered: FrameReport[] = [];
  const broadcasts: number[] = [];
  const resets: number[] = [];

  const deps: RollCallDeps = {
    broadcast: async () => {
      pass++;
      broadcasts.push(clock);
      const outcome = script(pass);
      // The adapter's job: true when some frame listened, false when none
      // did, and a throw for a failure it could not classify.
      if (outcome === 'unreachable') return false;
      if (outcome instanceof Error) throw outcome;
      answered = outcome;
      return true;
    },
    collected: () => answered,
    reset: () => {
      resets.push(clock);
      answered = [];
    },
    wait: async (ms) => {
      clock += ms;
    },
    now: () => clock,
  };
  return { deps, broadcasts, resets, elapsed: () => clock };
}

describe('rollCall', () => {
  it('answers on the first pass when a frame is already there', async () => {
    const h = harness(() => [board()]);
    const result = await rollCall(h.deps, TIMING, (f) => f.length > 0);
    expect(result.frames).toHaveLength(1);
    expect(result.passes).toBe(1);
    expect(result.reachable).toBe(true);
    expect(h.elapsed()).toBe(250);
  });

  it('keeps asking while an embed is still mounting', async () => {
    // The case the retry exists for: a careers page builds its iframe with
    // script, so the first pass sees an empty page.
    const h = harness((pass) => (pass < 3 ? [] : [board()]));
    const result = await rollCall(h.deps, TIMING, (f) => f.length > 0);
    expect(result.passes).toBe(3);
    expect(result.frames).toHaveLength(1);
  });

  it('gives up at the budget rather than forever', async () => {
    const h = harness(() => []);
    const result = await rollCall(h.deps, TIMING, (f) => f.length > 0);
    expect(result.frames).toHaveLength(0);
    expect(result.reachable).toBe(true);
    // 2000ms of budget at 250ms a pass, checked after the wait.
    expect(result.passes).toBe(8);
    expect(h.elapsed()).toBe(2000);
  });

  it('gives up on silence quickly, well inside the full budget', async () => {
    // The regression this exists for: spending the whole budget on a page
    // with no content script made an ordinary page take two seconds to say
    // "not a job board", a worse answer than Phase 2 gave.
    const h = harness(() => 'unreachable');
    const result = await rollCall(h.deps, TIMING, (f) => f.length > 0);
    expect(result.reachable).toBe(false);
    expect(result.frames).toEqual([]);
    expect(h.elapsed()).toBeLessThan(TIMING.budget);
    // A budget checked once per pass is overshot by at most one pass. The
    // number that matters is that it is nowhere near the full budget.
    expect(h.elapsed()).toBeLessThanOrEqual(TIMING.silenceBudget + TIMING.perPass);
  });

  it('but NOT on the first silence, because an embed has not mounted yet', async () => {
    // The other half, and the one that stopping at the first silence broke.
    // A careers page has no content script anywhere in it until its iframe
    // exists, so early silence looks exactly like an unrelated site.
    const h = harness((pass) => (pass < 3 ? 'unreachable' : [board()]));
    const result = await rollCall(h.deps, TIMING, (f) => f.length > 0);
    expect(result.reachable).toBe(true);
    expect(result.frames).toHaveLength(1);
  });

  it('spends the LONG budget once something has answered, even if it goes quiet', async () => {
    // Having answered once is proof the page is a board. Silence after that
    // is a form still rendering, not an unsupported site.
    const h = harness((pass) => (pass === 1 ? [board({ fields: 0 })] : 'unreachable'));
    const result = await rollCall(h.deps, TIMING, (f) => f.some((x) => x.fields > 0));
    expect(result.reachable).toBe(true);
    expect(h.elapsed()).toBeGreaterThan(TIMING.silenceBudget);
  });

  it('keeps retrying when the broadcast fails for any OTHER reason', async () => {
    // A real failure inside a content script is not evidence that the page
    // is unsupported, so it must not short-circuit the way a missing
    // listener does.
    const h = harness((pass) => (pass < 2 ? new Error('boom') : [board()]));
    const result = await rollCall(h.deps, TIMING, (f) => f.length > 0);
    expect(result.passes).toBe(2);
    expect(result.reachable).toBe(true);
  });

  it('spends the budget on the caller’s own question, not on any frame', async () => {
    // A frame that answers with no form is not an answer to "which frame
    // holds the form".
    const h = harness((pass) => (pass < 4 ? [board({ fields: 0 })] : [board()]));
    const result = await rollCall(h.deps, TIMING, (f) => f.some((x) => x.fields > 0));
    expect(result.passes).toBe(4);
    expect(result.frames[0]?.fields).toBe(9);
  });

  it('clears what it collected before every pass', async () => {
    // Otherwise a frame that answered once and then went away would stay in
    // the roster and be addressed after it stopped existing.
    const h = harness((pass) => (pass < 2 ? [] : [board()]));
    await rollCall(h.deps, TIMING, (f) => f.length > 0);
    expect(h.resets).toHaveLength(2);
  });

  it('stops broadcasting once it has decided the page has no content script', async () => {
    const h = harness(() => 'unreachable');
    await rollCall(h.deps, TIMING, () => true);
    // Bounded by the silence budget, not by the long one.
    expect(h.broadcasts.length).toBeLessThanOrEqual(
      Math.ceil(TIMING.silenceBudget / TIMING.perPass) + 1,
    );
    expect(h.broadcasts[0]).toBe(0);
  });
});

describe('isNoListener', () => {
  it("recognises Chrome's wording, in both halves", () => {
    expect(isNoListener(new Error('Could not establish connection.'))).toBe(true);
    expect(isNoListener(new Error('The receiving end does not exist.'))).toBe(true);
  });

  it("recognises the messaging LIBRARY's wording, which is what actually arrives", () => {
    // The bug this test exists for. @webext-core/messaging catches Chrome's
    // error and throws its own `Error: No response`, so matching only
    // Chrome's text matched nothing: the unit tests passed and every
    // ordinary page still spent the full retry budget in a real browser.
    // Confirmed by probing what the call threw, not by reasoning about it.
    expect(isNoListener(new Error('No response'))).toBe(true);
  });

  it('does not mistake a real failure for an unsupported page', () => {
    expect(isNoListener(new Error('Cannot read properties of null'))).toBe(false);
    expect(isNoListener(new Error('the vault is locked'))).toBe(false);
  });

  it('survives something that is not an Error at all', () => {
    expect(isNoListener('Could not establish connection')).toBe(true);
    expect(isNoListener(undefined)).toBe(false);
  });
});
