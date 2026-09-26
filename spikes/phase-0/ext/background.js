// Relays a command to the offscreen document and resolves with its reply.
globalThis.ask = async (cmd, payload) => {
  const has = await chrome.offscreen.hasDocument();
  if (!has) {
    await chrome.offscreen.createDocument({
      url: 'offscreen.html',
      reasons: ['WORKERS'],
      justification: 'Spawns a dedicated worker that owns the SQLite database.',
    });
  }
  return await chrome.runtime.sendMessage({ target: 'offscreen', cmd, payload });
};
