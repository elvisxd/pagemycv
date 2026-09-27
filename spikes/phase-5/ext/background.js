(async () => {
  const have = await chrome.offscreen.hasDocument();
  if (!have) {
    await chrome.offscreen.createDocument({
      url: 'offscreen.html',
      reasons: ['WORKERS'],
      justification: 'spike',
    });
  }
})();
