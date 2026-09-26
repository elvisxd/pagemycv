// The offscreen document exists for one reason: it is the only background
// context that can spawn a dedicated worker, and a dedicated worker is the only
// context where SQLite's OPFS backend can open a synchronous file handle.
//
// It also outlives the service worker, which is terminated after 30 seconds of
// idle. That is why the vault key lives down here rather than up there.

import type { ProfileView, VaultState } from '../../db/schema';
import { onDb } from '../../messaging/db';

/**
 * How long a single database command may take before the caller gives up.
 *
 * Nothing else can settle these promises. `worker.onerror` does not fire for an
 * out-of-memory kill, an explicit terminate, or a worker wedged inside a
 * synchronous SQLite call, so without a deadline the side panel waits forever:
 * the Import button stays disabled reading "Importing…" with no way out but
 * closing the panel. Argon2id at 19 MiB is the slowest legitimate operation and
 * takes well under a second, so this is generous.
 */
const CALL_TIMEOUT_MS = 30_000;

let worker: Worker | null = null;
let seq = 0;
const pending = new Map<
  number,
  {
    resolve: (v: unknown) => void;
    reject: (e: Error) => void;
    timer: ReturnType<typeof setTimeout>;
  }
>();

function settle(id: number): { resolve: (v: unknown) => void; reject: (e: Error) => void } | null {
  const waiting = pending.get(id);
  if (!waiting) return null;
  clearTimeout(waiting.timer);
  pending.delete(id);
  return waiting;
}

function rejectAll(message: string): void {
  for (const id of [...pending.keys()]) settle(id)?.reject(new Error(message));
}

function ensureWorker(): Worker {
  if (worker) return worker;
  worker = new Worker(new URL('../../db/worker.ts', import.meta.url), { type: 'module' });
  worker.onmessage = (event: MessageEvent) => {
    const { id, ok, value, error } = event.data ?? {};
    const waiting = settle(id);
    if (!waiting) return;
    if (ok) waiting.resolve(value);
    else waiting.reject(new Error(error));
  };
  worker.onerror = (event) => {
    // Terminate before dropping the reference. Nulling alone leaves the failed
    // worker running, still holding the OPFS pool's exclusive file handles and
    // still holding the vault key. The next call would spawn a second worker
    // that cannot open the database, and the orphan would keep the key alive
    // beyond the reach of any lock.
    dropWorker(event.message || 'the database worker failed');
  };
  worker.onmessageerror = () => {
    dropWorker('a reply from the database worker could not be read');
  };
  return worker;
}

/** Ids keep counting across generations, so a late reply from a dead worker
 *  carries a stale id and is ignored rather than resolving the wrong call. */
function dropWorker(reason: string): void {
  worker?.terminate();
  worker = null;
  rejectAll(reason);
}

function call<T>(cmd: string, payload?: Record<string, string>): Promise<T> {
  const w = ensureWorker();
  const id = ++seq;
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => {
      settle(id);
      // A wedged worker cannot be recovered by waiting, and leaving it running
      // would keep the database locked against its replacement.
      dropWorker(`the database did not answer "${cmd}" within 30 seconds`);
      reject(new Error(`the database did not answer "${cmd}" within 30 seconds`));
    }, CALL_TIMEOUT_MS);
    pending.set(id, { resolve: resolve as (v: unknown) => void, reject, timer });
    w.postMessage({ id, cmd, payload });
  });
}

onDb('db:state', () => call<VaultState>('state'));
onDb('db:create', ({ data }) => call<VaultState>('create', { passphrase: data.passphrase }));
onDb('db:unlock', ({ data }) => call<VaultState>('unlock', { passphrase: data.passphrase }));
onDb('db:lock', () => call<VaultState>('lock'));
onDb('db:profile', () => call<ProfileView>('profile'));
onDb('db:importCv', ({ data }) =>
  call<{ imported: true; counts: Record<string, number> }>('importCv', { markdown: data.markdown }),
);
onDb('db:touch', () => call<VaultState>('touch'));
