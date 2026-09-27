// The roll call, as a decision rather than as plumbing.
//
// It lived inside src/entrypoints/background.ts, which nothing can import, so
// it had no tests at all — the same shape of defect that left descriptor.ts
// and write.ts reachable only through the browser gate until Phase 2's
// review. The Chrome calls are injected, so the rule itself is pure and its
// timing is testable without waiting for it.
import type { FrameReport } from './frames';

export interface RollCallDeps {
  /**
   * Ask every frame of the tab to report itself.
   *
   * Resolves **true when some frame listened** and false when none did. The
   * translation from whatever the messaging layer threw lives in the adapter,
   * because only the adapter knows which layer it is talking to — see
   * `isNoListener`, which is what caught this being wrong.
   */
  broadcast: () => Promise<boolean>;
  /** Everything that has answered since the last `reset`. */
  collected: () => FrameReport[];
  reset: () => void;
  wait: (ms: number) => Promise<void>;
  now: () => number;
}

export interface RollCallResult {
  frames: FrameReport[];
  /**
   * Whether any frame of this tab is running our content script.
   *
   * False means the page is not a job board, and the answer is immediate.
   * Without this the retry below spent its whole budget on every ordinary
   * page: two seconds of a button reading "Filling…" before saying it does
   * not know the site. That is a worse answer than Phase 2 gave, arrived at
   * by fixing something else.
   */
  reachable: boolean;
  /** How many passes it took. Reported so the gate can assert the shape. */
  passes: number;
}

export interface RollCallTiming {
  /** How long to let answers land after each broadcast. */
  perPass: number;
  /** Total time to keep asking once at least one frame has answered. */
  budget: number;
  /**
   * How long to keep asking while NOTHING has answered yet.
   *
   * Two budgets, because silence means different things at different times.
   * Early it is weak evidence: a careers page mounts its embed with script,
   * and until that iframe exists no frame in the tab is running our content
   * script — the page looks exactly like an unrelated site. Later it is
   * strong evidence: a page that has stayed silent this long has no content
   * script and will not grow one.
   *
   * One budget cannot serve both. Stopping at the first silence called every
   * careers page unsupported; spending the full budget on silence made every
   * ordinary page take two seconds to say the same thing. Both were seen in
   * the gate, one after the other.
   */
  silenceBudget: number;
}

/**
 * Ask until something usable answers, the budget runs out, or the page turns
 * out to have no content script at all.
 *
 * `accept` decides what usable means, so a caller looking for a form and a
 * caller looking for anything at all spend the budget on their own question.
 */
export async function rollCall(
  deps: RollCallDeps,
  timing: RollCallTiming,
  accept: (frames: FrameReport[]) => boolean,
): Promise<RollCallResult> {
  const started = deps.now();
  let passes = 0;
  let reachable = false;

  while (true) {
    passes++;
    deps.reset();
    // A failure the adapter could not classify counts as delivered, so a real
    // bug in a content script keeps the retry running rather than being
    // reported as an unsupported site.
    const delivered = await deps.broadcast().catch(() => true);
    if (delivered) reachable = true;

    if (!reachable) {
      // Still silent. Keep asking only while silence is weak evidence.
      if (deps.now() - started >= timing.silenceBudget) {
        return { frames: [], reachable: false, passes };
      }
      await deps.wait(timing.perPass);
      continue;
    }

    await deps.wait(timing.perPass);
    const frames = deps.collected();
    if (accept(frames)) return { frames, reachable, passes };
    if (deps.now() - started >= timing.budget) return { frames, reachable, passes };
  }
}

/**
 * Nothing was listening.
 *
 * Two wordings, and the second one is the point. Chrome says *"Could not
 * establish connection. Receiving end does not exist."* — but
 * `@webext-core/messaging` catches that and throws its own `Error: No
 * response` instead, so matching only Chrome's wording matched nothing at
 * all. The first version of this did exactly that: its unit tests passed
 * against Chrome's text, and in a real browser every ordinary page still
 * spent the whole retry budget. Found by probing what the call actually
 * threw rather than by reasoning about what it should throw.
 *
 * `No response` is safe to read this way because the content script always
 * answers `fill:rollCall` with an ack. No answer means no listener.
 *
 * Anything else — a real failure inside a content script, say — is NOT a
 * missing listener, so the retry still runs.
 */
export function isNoListener(err: unknown): boolean {
  const message = err instanceof Error ? err.message : String(err);
  return /could not establish connection|receiving end does not exist|no response/i.test(message);
}
