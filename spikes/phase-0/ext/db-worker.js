import sqlite3InitModule from './index.mjs';

let db = null;
let pool = null;
let vfsName = null;

async function open() {
  if (db) return { already: true, vfs: vfsName };
  const sqlite3 = await sqlite3InitModule({ print: () => {}, printErr: () => {} });
  const api = {
    version: sqlite3.version.libVersion,
    hasSahPool: typeof sqlite3.installOpfsSAHPoolVfs === 'function',
    hasOpfs: !!(sqlite3.oo1 && sqlite3.oo1.OpfsDb),
    hasSyncAccessHandle:
      typeof FileSystemFileHandle !== 'undefined' &&
      typeof FileSystemFileHandle.prototype.createSyncAccessHandle === 'function',
    crossOriginIsolated: globalThis.crossOriginIsolated === true,
    hasSharedArrayBuffer: typeof SharedArrayBuffer !== 'undefined',
  };
  if (!api.hasSahPool) throw new Error('installOpfsSAHPoolVfs missing: ' + JSON.stringify(api));
  pool = await sqlite3.installOpfsSAHPoolVfs({ name: 'pagemycv-spike' });
  vfsName = 'opfs-sahpool';
  db = new pool.OpfsSAHPoolDb('/vault.sqlite3');
  return { ...api, vfs: vfsName };
}

const handlers = {
  async probe() {
    return await open();
  },
  async write({ note }) {
    await open();
    db.exec('CREATE TABLE IF NOT EXISTS t (id INTEGER PRIMARY KEY, note TEXT, at INTEGER)');
    db.exec({ sql: 'INSERT INTO t (note, at) VALUES (?, ?)', bind: [note, Date.now()] });
    const rows = [];
    db.exec({ sql: 'SELECT count(*) AS n FROM t', rowMode: 'object', callback: (r) => rows.push(r) });
    return { inserted: note, count: rows[0].n };
  },
  async read() {
    await open();
    const rows = [];
    try {
      db.exec({ sql: 'SELECT note, at FROM t ORDER BY id', rowMode: 'object', callback: (r) => rows.push(r) });
    } catch (e) {
      return { tableMissing: true, error: String(e.message || e) };
    }
    return { rows, count: rows.length };
  },
  // AES-GCM with AAD bound to row, column and schema version.
  async aad() {
    const key = await crypto.subtle.generateKey({ name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']);
    const iv = crypto.getRandomValues(new Uint8Array(12));
    const enc = new TextEncoder();
    const aadGood = enc.encode('row-1.visa_status.1');
    const aadMoved = enc.encode('row-2.visa_status.1');
    const ct = await crypto.subtle.encrypt({ name: 'AES-GCM', iv, additionalData: aadGood }, key, enc.encode('valid until 2029'));
    let sameRow = false, movedRow = false;
    try { await crypto.subtle.decrypt({ name: 'AES-GCM', iv, additionalData: aadGood }, key, ct); sameRow = true; } catch {}
    try { await crypto.subtle.decrypt({ name: 'AES-GCM', iv, additionalData: aadMoved }, key, ct); movedRow = true; } catch {}
    return { decryptsInOwnPosition: sameRow, decryptsWhenMoved: movedRow };
  },
};

self.onmessage = async (e) => {
  const { id, cmd, payload } = e.data || {};
  try {
    const fn = handlers[cmd];
    if (!fn) throw new Error('unknown cmd: ' + cmd);
    self.postMessage({ id, ok: true, value: await fn(payload || {}) });
  } catch (err) {
    self.postMessage({ id, ok: false, error: String(err && err.stack || err) });
  }
};
