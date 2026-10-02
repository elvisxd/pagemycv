// The offscreen document exists for one reason: it is the only background
// context that can spawn a dedicated worker, and a dedicated worker is the only
// context where SQLite's OPFS backend can open a synchronous file handle.
//
// It also outlives the service worker, which is terminated after 30 seconds of
// idle, so the worker it owns — and the open vault inside it — survives that.
//
// It is a relay and nothing more. The vault key is NOT here: an offscreen
// document has `chrome.runtime` and no `chrome.storage` (found by the gate when
// a first design put the key store here and every open failed), so the service
// worker loads the key and sends it down through this document to the worker.
// The dead imports that used to sit below were left over from that first
// design.

import type { DbProtocol } from '../../messaging/db';
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

/**
 * Every message key, mapped to the worker command that answers it.
 *
 * A `Record` over the protocol rather than a list of `onDb` calls, because
 * the list let a message be added to the protocol, implemented in the worker,
 * routed by the background, and silently never registered here. TypeScript
 * could not see it: registering a handler is optional by design, so the
 * missing one compiled cleanly and failed at runtime as "the message port
 * closed before a response was received", which names neither the message nor
 * the layer. The Record makes leaving one out a type error.
 *
 * 'db:ping' is excluded by name rather than forgotten: it is answered here,
 * below, and relaying it to the worker would make it mean something else.
 */
const COMMANDS: Record<Exclude<keyof DbProtocol, 'db:ping'>, string> = {
  'db:screeningAnswers': 'screeningAnswers',
  'db:setScreeningAnswer': 'setScreeningAnswer',
  'db:state': 'state',
  'db:create': 'create',
  'db:open': 'open',
  'db:salt': 'salt',
  'db:markConverted': 'markConverted',
  'db:profile': 'profile',
  'db:importCv': 'importCv',
  'db:fillValues': 'fillValues',
  'db:setDocument': 'setDocument',
  'db:documents': 'documents',
  'db:exportBackup': 'exportBackup',
  'db:importBackup': 'importBackup',
};

for (const [key, cmd] of Object.entries(COMMANDS) as [keyof DbProtocol, string][]) {
  // The payload is passed through whole. Every worker handler destructures
  // what it needs and ignores the rest, so there is nothing per-message to
  // get wrong here.
  onDb(key, ({ data }) => call(cmd, data as Record<string, string> | undefined));
}

// Registered LAST, on purpose. A ping that answered before the commands were
// registered would report a document that cannot yet be asked anything, which
// is the exact race it exists to close.
onDb('db:ping', () => ({ ready: true }) as const);
