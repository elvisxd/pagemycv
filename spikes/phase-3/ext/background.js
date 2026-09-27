const seen = [];

chrome.runtime.onMessage.addListener((msg, sender, reply) => {
  if (msg?.kind === 'here') {
    seen.push({
      tabId: sender.tab?.id ?? null,
      frameId: sender.frameId,
      url: msg.url,
      isTop: msg.isTop,
      fields: msg.fields,
    });
    return false;
  }
  if (msg?.kind === 'drain') {
    reply(seen.splice(0));
    return true;
  }
  return false;
});

// Exposed for the runner to call through the service worker.
globalThis.__spike = {
  seen: () => seen,
  // Can we address one frame by id, with no webNavigation and no host
  // permission over the parent page?
  read: (tabId, frameId) => chrome.tabs.sendMessage(tabId, { kind: 'read' }, { frameId }),
  // And what does a broadcast with no frameId actually return when several
  // frames have a listener?
  broadcast: (tabId) => chrome.tabs.sendMessage(tabId, { kind: 'read' }),
  rollCall: (tabId) => chrome.tabs.sendMessage(tabId, { kind: 'roll-call' }).catch((e) => String(e)),
  hasWebNavigation: () => typeof chrome.webNavigation !== 'undefined',
  manifestPermissions: () => chrome.runtime.getManifest().permissions ?? [],
  manifestHosts: () => chrome.runtime.getManifest().host_permissions ?? [],
};
