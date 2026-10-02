// Every way an extension can get code into a page it has no host permission
// for, tried from the service worker and recorded. The harness reads
// globalThis.spike afterwards.
globalThis.spike = { log: [] };
const log = (k, v) => { globalThis.spike.log.push([k, v]); globalThis.spike[k] = v; };

globalThis.tryInject = async (tabId, allFrames) => {
  try {
    const r = await chrome.scripting.executeScript({
      target: { tabId, allFrames },
      func: () => ({ href: location.href, inputs: document.querySelectorAll('input').length }),
    });
    return { ok: true, frames: r.map((x) => x.result) };
  } catch (e) {
    return { ok: false, error: String(e && e.message) };
  }
};

globalThis.tryRequest = async (origin) => {
  try {
    const granted = await chrome.permissions.request({ origins: [origin] });
    return { ok: true, granted };
  } catch (e) {
    return { ok: false, error: String(e && e.message) };
  }
};

chrome.action.onClicked.addListener(async (tab) => {
  log('actionClicked', { tabId: tab.id, url: tab.url });
  log('afterActionClick', await globalThis.tryInject(tab.id, true));
});
chrome.commands.onCommand.addListener(async (cmd, tab) => {
  log('command', { cmd, tabId: tab && tab.id });
  if (tab) log('afterCommand', await globalThis.tryInject(tab.id, true));
});
