let worker = null;
let seq = 0;
const pending = new Map();

function ensureWorker() {
  if (worker) return worker;
  worker = new Worker(new URL('./db-worker.js', import.meta.url), { type: 'module' });
  worker.onmessage = (e) => {
    const { id, ok, value, error } = e.data || {};
    const r = pending.get(id);
    if (!r) return;
    pending.delete(id);
    ok ? r.resolve(value) : r.reject(new Error(error));
  };
  return worker;
}

function callWorker(cmd, payload) {
  const w = ensureWorker();
  const id = ++seq;
  return new Promise((resolve, reject) => {
    pending.set(id, { resolve, reject });
    w.postMessage({ id, cmd, payload });
  });
}

chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (msg?.target !== 'offscreen') return;
  callWorker(msg.cmd, msg.payload)
    .then((value) => sendResponse({ ok: true, value }))
    .catch((err) => sendResponse({ ok: false, error: String(err && err.message || err) }));
  return true; // async
});
