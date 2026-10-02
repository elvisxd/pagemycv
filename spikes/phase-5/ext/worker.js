// Does a dedicated worker, spawned from an offscreen document, have chrome.storage?
self.onmessage = async () => {
  const seen = {
    chrome: typeof chrome,
    storage: typeof chrome === 'undefined' ? 'no chrome' : typeof chrome.storage,
    local: typeof chrome === 'undefined' || !chrome.storage ? 'n/a' : typeof chrome.storage.local,
  };
  let roundTrip = null;
  try {
    await chrome.storage.local.set({ spikeKey: 'abc123' });
    const got = await chrome.storage.local.get('spikeKey');
    roundTrip = got.spikeKey === 'abc123' ? 'ok' : `wrong: ${JSON.stringify(got)}`;
  } catch (e) {
    roundTrip = `threw: ${e && e.message}`;
  }
  self.postMessage({ seen, roundTrip });
};
