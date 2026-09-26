# Phase 0 spikes

Four of the five unknowns in `docs/04-phases.md`, answered by running them in a
real browser rather than by reading about them.

```bash
cd spikes/phase-0
npm install          # fetches @sqlite.org/sqlite-wasm
npm run spike        # or: node run.cjs
```

The runner launches Chromium twice against the **same profile directory**, which
is what makes the persistence answer meaningful. Run 1 writes a row, run 2 reads
it back after a full browser restart.

## Results, Chromium 141.0.7390.37, 26 September 2026

| # | Question | Answer |
|---|---|---|
| 1 | Does `chrome.offscreen` accept the reason `WORKERS`? | **Yes.** No fallback to `BLOBS` needed. |
| 2 | Does `opfs-sahpool` survive a full browser restart? | **Yes.** Row written in run 1, read back in run 2. |
| 4 | Can the extension fetch loopback? | **Yes on 141**, but see the caveat below. |
| 5 | Does `chrome.storage.session` round-trip a `CryptoKey`? | **No.** See below. |

### The architecture check, confirmed empirically

Evaluated inside the extension's service worker:

| | |
|---|---|
| `Worker` constructor present | **false** |
| `FileSystemFileHandle.prototype.createSyncAccessHandle` present | **false** |
| `navigator.storage.getDirectory` present | true |

Both blocks described in `docs/02-architecture.md` are real, in this browser, at
this version. The service worker can see the origin private file system but can
neither open a synchronous handle nor spawn a worker that could. The offscreen
document hop is mandatory, not stylistic.

### Spike 5 failed, and that is useful

`chrome.storage.session` accepts a non-extractable `CryptoKey` without throwing
and returns a **plain object** on read. It does not round-trip. No error, no
warning, just a silently useless value, which is the worst kind of failure.

**Consequence:** the vault key lives in a module variable inside the offscreen
document, which has no lifetime limit and already hosts the database. Storing
the raw derived bytes in `chrome.storage.session` as a workaround is not an
option: it would forfeit non-extractability.

### Spike 4 is answered only for 141

Chrome enforces Local Network Access from **142**. This ran on **141**, so a
successful loopback fetch here does not prove the behaviour after enforcement.
Re-run on 142 or later before relying on it. The harness is committed so that
is one command.

### Spike 3 is not runnable here

Whether Workday's shadow roots are open or closed needs a real
`*.myworkdayjobs.com` application page. It remains the one unknown that could
still change the shape of Phase 4.

## Bonus: the AAD mitigation, proved

`docs/03-security.md` claims that binding each ciphertext to its row, column and
schema version stops an attacker relocating encrypted fields. The harness tests
it rather than asserting it:

| | |
|---|---|
| Decrypts in its own position | **true** |
| Decrypts when moved to another row | **false** |

That is the test the Phase 1 gate requires, written early.
