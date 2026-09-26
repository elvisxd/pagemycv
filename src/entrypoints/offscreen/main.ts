// The offscreen document exists for one reason: it is the only background
// context that can spawn a dedicated worker, and a dedicated worker is the only
// context where SQLite's OPFS backend can open a synchronous file handle.
//
// It also outlives the service worker, which is terminated after 30 seconds of
// idle. That is why the vault key lives down here rather than up there.

import type { ProfileView, VaultState } from '../../db/schema';
import { onDb } from '../../messaging/db';

let worker: Worker | null = null;
let seq = 0;
const pending = new Map<number, { resolve: (v: unknown) => void; reject: (e: Error) => void }>();

function ensureWorker(): Worker {
  if (worker) return worker;
  worker = new Worker(new URL('../../db/worker.ts', import.meta.url), { type: 'module' });
  worker.onmessage = (event: MessageEvent) => {
    const { id, ok, value, error } = event.data ?? {};
    const waiting = pending.get(id);
    if (!waiting) return;
    pending.delete(id);
    if (ok) waiting.resolve(value);
    else waiting.reject(new Error(error));
  };
  worker.onerror = (event) => {
    for (const [, waiting] of pending) waiting.reject(new Error(event.message || 'worker failed'));
    pending.clear();
    worker = null;
  };
  return worker;
}

function call<T>(cmd: string, payload?: Record<string, string>): Promise<T> {
  const w = ensureWorker();
  const id = ++seq;
  return new Promise<T>((resolve, reject) => {
    pending.set(id, { resolve: resolve as (v: unknown) => void, reject });
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
