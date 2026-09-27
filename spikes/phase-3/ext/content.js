// Announces itself to the background the moment it runs, in whatever frame
// that is. The background learns the frame id from `sender.frameId`, which is
// the whole point: it can then address this frame without ever being granted
// a permission over the page that embeds it.
chrome.runtime.sendMessage({
  kind: 'here',
  url: location.href,
  isTop: window.top === window.self,
  fields: document.querySelectorAll('input, select, textarea').length,
});

chrome.runtime.onMessage.addListener((msg, _sender, reply) => {
  if (msg?.kind === 'roll-call') {
    // A second message TO the background, so it carries this frame's id.
    chrome.runtime.sendMessage({
      kind: 'here',
      url: location.href,
      isTop: window.top === window.self,
      fields: document.querySelectorAll('input, select, textarea').length,
    });
    reply({ ok: true });
    return true;
  }
  if (msg?.kind === 'read') {
    reply({ url: location.href, fields: document.querySelectorAll('input, select, textarea').length });
    return true;
  }
  return false;
});
