// A thin relay. Every question is answered inside the content script, because
// `chrome.dom` exists only there — which is itself one of the things being
// checked.
const frames = [];

chrome.runtime.onMessage.addListener((msg, sender) => {
  if (msg?.kind === 'here') {
    frames.push({ tabId: sender.tab?.id ?? null, frameId: sender.frameId, url: msg.url, isTop: msg.isTop });
  }
});

globalThis.__spike = {
  seen: () => frames,
  ask: (tabId, frameId, question) =>
    chrome.tabs.sendMessage(tabId, { kind: 'probe', question }, { frameId }),
};
