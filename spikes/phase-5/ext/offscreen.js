chrome.storage.local.set({ offscreenAlive: true });
try {
  const w = new Worker('worker.js', { type: 'module' });
  w.onmessage = (e) => chrome.storage.local.set({ spikeAnswer: e.data });
  w.onerror = (e) =>
    chrome.storage.local.set({ spikeAnswer: { workerError: String(e.message || e.type) } });
  w.postMessage('go');
  chrome.storage.local.set({ workerSpawned: true });
} catch (e) {
  chrome.storage.local.set({ spawnThrew: String(e && e.message) });
}
