import { describe, expect, it } from 'vitest';
import { needsIconClick, type ReachDeps, reachForm } from '../../src/fill/on-demand';
import type { RollCallResult } from '../../src/fill/roll-call';

const BOARDS = 'Lever, Greenhouse and Ashby';
const heard: RollCallResult = {
  frames: [{ frameId: 0, url: 'https://x.test/apply', fields: 5 }],
  reachable: true,
  passes: 1,
};
const silent: RollCallResult = { frames: [], reachable: false, passes: 3 };

function deps(answers: RollCallResult[], inject: () => Promise<void>) {
  const calls: string[] = [];
  const d: ReachDeps = {
    rollCall: async () => {
      calls.push('rollCall');
      return answers.shift() ?? silent;
    },
    inject: async () => {
      calls.push('inject');
      await inject();
    },
    isAccessRefused: (err) => /cannot access/i.test(String((err as Error).message)),
  };
  return { d, calls };
}

describe('reaching a form', () => {
  it('on a declared board, never injects', async () => {
    const { d, calls } = deps([heard], async () => {});
    const out = await reachForm(d, BOARDS);
    expect(out).toEqual({ result: heard, injected: false });
    expect(calls).toEqual(['rollCall']);
  });

  it('on an unknown site the person pointed at, injects once and asks again', async () => {
    const { d, calls } = deps([silent, heard], async () => {});
    const out = await reachForm(d, BOARDS);
    expect(out.injected).toBe(true);
    expect(out.result).toBe(heard);
    expect(calls).toEqual(['rollCall', 'inject', 'rollCall']);
  });

  it('turns Chrome refusing the tab into the one instruction that fixes it', async () => {
    // The gate reaches exactly this branch: it cannot grant activeTab, so
    // Chrome refuses, and this is the message the person sees.
    const { d, calls } = deps([silent], async () => {
      throw new Error(
        'Cannot access contents of the page. Extension manifest must request permission to access the respective host.',
      );
    });
    await expect(reachForm(d, BOARDS)).rejects.toThrow(needsIconClick(BOARDS));
    expect(calls).toEqual(['rollCall', 'inject']);
  });

  it('names the boards in that message, so it does not read as unsupported', () => {
    expect(needsIconClick(BOARDS)).toContain(`On ${BOARDS} it works without that`);
    expect(needsIconClick(BOARDS)).toMatch(/icon in the toolbar/);
  });

  it('passes any other injection failure through as itself', async () => {
    // A bug in our script, or a chrome:// page, is not a missing grant.
    const boom = new Error('Script execution failed: TypeError at content.js:1');
    const { d } = deps([silent], async () => {
      throw boom;
    });
    await expect(reachForm(d, BOARDS)).rejects.toBe(boom);
  });

  it('reports a silent tab after a successful injection as silent, not as an error', async () => {
    const { d } = deps([silent, silent], async () => {});
    const out = await reachForm(d, BOARDS);
    expect(out).toEqual({ result: silent, injected: true });
  });
});
