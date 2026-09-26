const { chromium } = require('/opt/node22/lib/node_modules/playwright');
const path = require('path');
const http = require('http');

const EXT = path.join(__dirname, 'ext');
const PROFILE = path.join(__dirname, 'profile');
const out = {};

async function launch() {
  const ctx = await chromium.launchPersistentContext(PROFILE, {
    executablePath: '/opt/pw-browsers/chromium',
    headless: true,
    args: [`--disable-extensions-except=${EXT}`, `--load-extension=${EXT}`, '--no-sandbox'],
  });
  let [sw] = ctx.serviceWorkers();
  if (!sw) sw = await ctx.waitForEvent('serviceworker', { timeout: 30000 });
  return { ctx, sw };
}

(async () => {
  // a loopback server for the Local Network Access probe
  const server = http.createServer((_q, r) => { r.writeHead(200, {'content-type':'application/json'}); r.end('{"ok":true}'); });
  await new Promise((res) => server.listen(8777, '127.0.0.1', res));

  // ─── RUN 1 ───────────────────────────────────────────────────────────
  let { ctx, sw } = await launch();
  out.extensionId = sw.url().split('/')[2];

  out.spike1_offscreenWORKERS = await sw.evaluate(async () => {
    try {
      await chrome.offscreen.createDocument({
        url: 'offscreen.html', reasons: ['WORKERS'],
        justification: 'Spawns a dedicated worker that owns the SQLite database.',
      });
      return { accepted: true, hasDocument: await chrome.offscreen.hasDocument() };
    } catch (e) { return { accepted: false, error: String(e.message || e) }; }
  });

  out.spike1b_serviceWorkerCannotSpawn = await sw.evaluate(() => ({
    WorkerConstructorPresent: typeof Worker !== 'undefined',
    createSyncAccessHandlePresent:
      typeof FileSystemFileHandle !== 'undefined' &&
      typeof FileSystemFileHandle.prototype?.createSyncAccessHandle === 'function',
    getDirectoryPresent: typeof navigator?.storage?.getDirectory === 'function',
  }));

  out.spike5_cryptoKeyInSession = await sw.evaluate(async () => {
    try {
      const bits = await crypto.subtle.importKey('raw', new Uint8Array(32), 'HKDF', false, ['deriveKey']);
      const key = await crypto.subtle.deriveKey(
        { name: 'HKDF', hash: 'SHA-256', salt: new Uint8Array(16), info: new Uint8Array() },
        bits, { name: 'AES-GCM', length: 256 }, /* extractable */ false, ['encrypt', 'decrypt']);
      await chrome.storage.session.set({ vaultKey: key });
      const got = (await chrome.storage.session.get('vaultKey')).vaultKey;
      const isKey = got instanceof CryptoKey;
      let usable = false;
      if (isKey) {
        const iv = crypto.getRandomValues(new Uint8Array(12));
        await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, got, new Uint8Array([1, 2, 3]));
        usable = true;
      }
      return { roundTrips: isKey, usable, typeSeen: got === null ? 'null' : typeof got,
               extractable: isKey ? got.extractable : null };
    } catch (e) { return { roundTrips: false, error: String(e.message || e) }; }
  });

  out.spike4_loopbackFetch = await sw.evaluate(async () => {
    try {
      const r = await fetch('http://127.0.0.1:8777/health');
      return { ok: r.ok, status: r.status, body: await r.text() };
    } catch (e) { return { ok: false, error: String(e.message || e) }; }
  });

  out.spike2a_probe = await sw.evaluate(() => globalThis.ask('probe'));
  out.spike2b_write = await sw.evaluate(() => globalThis.ask('write', { note: 'written-in-run-1' }));
  out.aad = await sw.evaluate(() => globalThis.ask('aad'));

  await ctx.close();

  // ─── RUN 2, same profile directory ───────────────────────────────────
  ({ ctx, sw } = await launch());
  out.spike2c_readAfterRestart = await sw.evaluate(() => globalThis.ask('read'));
  await ctx.close();

  server.close();
  console.log(JSON.stringify(out, null, 2));
})().catch((e) => { console.error('FATAL', e); process.exit(1); });
