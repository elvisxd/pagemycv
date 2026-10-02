import { describe, expect, it } from 'vitest';
import type { FrameReport } from '../../src/fill/frames';
import { chooseFrame, describeFrame } from '../../src/fill/frames';

const lever = (over: Partial<FrameReport> = {}): FrameReport => ({
  frameId: 0,
  url: 'https://jobs.lever.co/acme/1234/apply',
  fields: 8,
  ...over,
});
const greenhouse = (over: Partial<FrameReport> = {}): FrameReport => ({
  frameId: 3,
  url: 'https://boards.greenhouse.io/embed/job_app?for=acme&token=1',
  fields: 12,
  ...over,
});

describe('chooseFrame', () => {
  it('takes the top frame on a board page', () => {
    const choice = chooseFrame([lever()]);
    expect(choice?.frame.frameId).toBe(0);
    expect(choice?.alternatives).toHaveLength(0);
  });

  it('takes the embedded board frame on a company careers page', () => {
    // The whole of Phase 3: the click happens on careers.acme.com and the
    // form lives in an iframe served by the board.
    const choice = chooseFrame([greenhouse()]);
    expect(choice?.frame.frameId).toBe(3);
  });

  it('refuses a page with no board frame at all', () => {
    expect(chooseFrame([])).toBeNull();
  });

  it('ignores a frame that answered but holds no form', () => {
    // A board's own cookie banner or a tracking pixel served from the same
    // origin would answer the roll call and has nothing to fill.
    expect(chooseFrame([greenhouse({ fields: 0 })])).toBeNull();
  });

  it('takes a frame on an origin no board names, when it holds a form', () => {
    // This used to be refused as defence in depth: the script should never be
    // in such a frame. It can be now — on-demand injection puts it into
    // whichever tab the person pointed at — and an unknown origin is a
    // definition with an empty map, not a stranger. What a frame says about
    // its URL still decides only which map applies; the values it receives
    // go into its own form, which it could read anyway.
    const unknown: FrameReport = {
      frameId: 2,
      url: 'https://careers.some-company.test/apply',
      fields: 5,
    };
    expect(chooseFrame([unknown])?.frame).toBe(unknown);
  });

  it('still ignores such a frame when it holds no form', () => {
    expect(
      chooseFrame([{ frameId: 2, url: 'https://ads.example.test/pixel', fields: 0 }]),
    ).toBeNull();
  });

  it('prefers the frame with the most fields when a page embeds two', () => {
    const choice = chooseFrame([greenhouse({ frameId: 1, fields: 3 }), greenhouse({ fields: 12 })]);
    expect(choice?.frame.frameId).toBe(3);
    expect(choice?.alternatives).toHaveLength(1);
  });

  it('is deterministic on a tie, because the same page must answer twice the same', () => {
    // A fill that lands somewhere different on the second run is worse than
    // one that refuses.
    const frames = [greenhouse({ frameId: 7 }), greenhouse({ frameId: 2 })];
    expect(chooseFrame(frames)?.frame.frameId).toBe(2);
    expect(chooseFrame([...frames].reverse())?.frame.frameId).toBe(2);
  });

  it('prefers the top frame on a tie, which is the board page itself', () => {
    const choice = chooseFrame([greenhouse({ frameId: 4 }), lever({ frameId: 0, fields: 12 })]);
    expect(choice?.frame.frameId).toBe(0);
  });
});

describe('describeFrame', () => {
  it('says nothing when the form was the page itself', () => {
    const choice = chooseFrame([lever()]);
    if (!choice) throw new Error('expected a choice');
    expect(describeFrame(choice)).toBeNull();
  });

  it('names the board when the form was embedded, because the click was elsewhere', () => {
    const choice = chooseFrame([greenhouse()]);
    if (!choice) throw new Error('expected a choice');
    expect(describeFrame(choice)).toBe('Filled the Greenhouse form embedded on this page.');
  });

  it('says how many it chose between when the page embeds more than one', () => {
    const choice = chooseFrame([greenhouse(), greenhouse({ frameId: 5, fields: 4 })]);
    if (!choice) throw new Error('expected a choice');
    expect(describeFrame(choice)).toMatch(/of 2 embedded forms/);
  });
});
