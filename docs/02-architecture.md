# Architecture

## The language question, settled

A browser extension runs JavaScript. That is the only option. Everything else
reaches the browser compiled to WebAssembly.

The consequence that shapes this whole project: **Byte is Python, so Byte can
never run inside the extension.** It stays a service the extension calls over
HTTP.

- **Language:** TypeScript, compiled to JavaScript
- **Framework:** [WXT](https://wxt.dev), which is Vite-based, actively
  maintained, and builds Chrome, Firefox, Safari and Edge from one source
- **Rejected:** Plasmo, still on Parcel and carrying the technical debt that
  comes with it; CRXJS, Chromium only

## The four contexts

| Context | Lives for | Can touch the page | Can spawn a worker |
|---|---|---|---|
| Service worker | 30 seconds of idle, 5 minutes per task | No | **No** |
| Content script | The page's lifetime | Yes | Yes |
| Offscreen document | No limit | No | **Yes** |
| Side panel | While open | No | Yes |

Chrome terminates the service worker after 30 seconds of inactivity, or when a
single request takes longer than 5 minutes, or when a fetch takes more than 30
seconds to respond. Any global you set is lost. Design every handler to be
resumable.

## Why the database cannot live in the service worker

This is the single most important constraint in the project, and it is not a
matter of taste. Two independent blocks at specification level:

**Block one.** `FileSystemFileHandle.createSyncAccessHandle()`, which every
SQLite OPFS backend requires, carries `[Exposed=DedicatedWorker]` in both the
WHATWG File System specification and Chromium's own Blink IDL. It does not exist
on a Window and it does not exist in a `ServiceWorkerGlobalScope`.

**Block two.** The `Worker` constructor is
`[Exposed=(Window,DedicatedWorker,SharedWorker)]`. `ServiceWorkerGlobalScope` is
deliberately absent. So the service worker cannot delegate to a dedicated worker
that could do the job.

Both blocks together mean there is no workaround today. If Chromium ever allows
service workers to spawn dedicated workers, the offscreen hop below becomes
unnecessary.

## The chain that works

```
  service worker                 offscreen document              dedicated worker
  ──────────────                 ──────────────────              ────────────────
  ephemeral                      no lifetime limit               spawned by the
  owns no state                  one per extension               offscreen page
  routes messages   ─────────▶   spawns the worker   ─────────▶  sqlite-wasm
  ensureOffscreen()              relays messages                 VFS: opfs-sahpool
  on every handler                                               the only context
                                                                 where the sync
                                                                 file API exists
```

The service worker must call `ensureOffscreenDocument()` at the top of **every**
event handler. It gets killed and revived constantly while the offscreen
document persists independently.

## Why the `opfs-sahpool` VFS specifically

SQLite's WASM build ships four backends. Only one fits an extension.

| VFS | Needs SharedArrayBuffer | Needs COOP and COEP headers | Verdict |
|---|---|---|---|
| `opfs` | Yes | Yes | Rejected |
| `opfs-wl` | Yes | Yes | Rejected, new in Feb 2026 but no escape hatch |
| **`opfs-sahpool`** | **No** | **No** | **Chosen** |
| `kvvfs` | No | No | Rejected, main thread only, text-encoded, about 5 MB |

From SQLite's own source comments, `opfs-sahpool` "does not require the
SharedArrayBuffer, so can function without the COOP/COEP HTTP response headers"
and is "much faster, and the performance gap increases as the job sizes
increase."

Its cost is that it "lacks all library-level concurrency support": it opens a
fixed pool of files at init and holds exclusive handles. Exactly one connection
at a time. That is not a problem here, because Chrome already permits only one
offscreen document per extension.

**Deliberately no cross-origin isolation keys in the manifest.** Opting in would
force every cross-origin resource the extension loads to carry CORP or CORS
headers, and Chrome's own documentation notes isolation "is not fully
implemented for service and shared workers" anyway.

## Manifest shape

```json
{
  "manifest_version": 3,
  "permissions": ["offscreen", "storage", "unlimitedStorage", "scripting", "webNavigation", "sidePanel"],
  "host_permissions": [
    "https://jobs.lever.co/*",
    "https://boards.greenhouse.io/*",
    "https://job-boards.greenhouse.io/*",
    "https://jobs.ashbyhq.com/*",
    "https://*.myworkdayjobs.com/*"
  ],
  "optional_host_permissions": ["https://*/*"],
  "content_scripts": [{
    "matches": ["<all_urls>"],
    "all_frames": true,
    "match_about_blank": true,
    "run_at": "document_idle",
    "js": ["content.js"]
  }],
  "content_security_policy": {
    "extension_pages": "script-src 'self' 'wasm-unsafe-eval'; object-src 'self';"
  }
}
```

Three notes on that shape.

**`wasm-unsafe-eval` is already the Manifest V3 default** and the Chrome Web
Store accepts it without a user-facing permission warning. You only need to
write it out because overriding `extension_pages` at all replaces the default.

**Broad hosts go in `optional_host_permissions`, never in the required list.**
Since 1 August 2026 Google enforces minimum permissions as a hard requirement.
The broad grant is requested at runtime, on a user gesture, when you land on a
career page that embeds an ATS on a domain we do not know.

**`unlimitedStorage` covers OPFS**, which Chrome's documentation lists
explicitly, and exempts the extension from quota eviction. Call
`navigator.storage.persist()` as well.

## Reaching into the page

| Obstacle | Solution |
|---|---|
| Open shadow roots | `element.shadowRoot`, recursing manually since `querySelectorAll` does not pierce boundaries |
| **Closed** shadow roots | `chrome.dom.openOrClosedShadowRoot(el)`, available to content scripts only. Verified in spikes/phase-4 against roots the page itself sees as `null`. Both cases go through one door, `src/fill/shadow.ts`, which the guard enforces. |
| Labels inside any shadow root | `getRootNode()`, never the document: `id` is scoped per root, so a document lookup returns nothing — or, worse, another element's text where the same `id` exists outside. |
| Events into any shadow root | `composed: true`. A bubbling event stops at the boundary, so a document-level listener never hears the fill and the form submits without it. |
| Same-origin iframes | `iframe.contentDocument` from the parent |
| Cross-origin iframes | A second content script instance in the child frame, messaging through the service worker |
| Frames created after load | `chrome.scripting.executeScript` targeted by `frameId`, driven from `chrome.webNavigation.onCommitted` |
| Frames inside a shadow root | **Reachable, and no fallback is needed.** ~~Unreachable, fall back to opening the ATS URL directly.~~ Corrected by spikes/phase-4: such a frame is not *enumerable*, but it is injected into like any other and announces itself with its own `frameId`. Phase 3 builds its roster from those announcements rather than from enumeration, so the fallback this row asked for was dead code that was never written. |

The declarative `all_frames: true` flag only covers frames present at page load.
Greenhouse and Ashby embeds are script-injected, often after the Apply button is
clicked, so per-frame injection driven by `webNavigation` is mandatory, not an
optimisation.

## Attaching the CV file

Setting `input.files` requires a `DataTransfer`. A content script runs in an
isolated world, so a `File` constructed there can fail the page's own
`instanceof File` check. Build the transfer in the main world, via
`chrome.scripting.executeScript({ world: 'MAIN' })`, and verify per ATS. Some
frameworks intercept the change event differently from a real user selection.

## Talking to Byte

```
extension  ──HTTPS──▶  127.0.0.1:8000  ──gh codespace ports forward──▶  Byte
```

Use `gh codespace ports forward 8000:8000` rather than a public forwarded port.
A public Codespaces port is reachable by anyone on the internet with no
authentication, and a private one expires its auth cookie every three hours.
Neither is acceptable for a service that sees CV data.

Byte's API already has what is needed: JWT auth, `BYTE_CORS_ORIGINS` for the
`chrome-extension://` origin, and an OpenAI-compatible endpoint. For the
lightweight path, `empleo/servidor.py` already runs standalone with only the
standard library and refuses to start without `OFERTAS_CLAVE`.

**One thing to verify in Phase 0:** browser extensions are reported to be exempt
from Chrome's Local Network Access permission prompt, which since Chrome 142
blocks HTTPS pages from reaching HTTP localhost. Reported, not confirmed from
primary documentation. Test it before building on it.

## The remote code line

Manifest V3 forbids remotely hosted code. It permits fetching data. The clause
that decides the architecture, verbatim from Chrome's migration guide, forbids
"building an interpreter to run complex commands fetched from a remote source,
**even if those commands are fetched as data**."

| | |
|---|---|
| **Allowed** | Byte returns `{"field_7": "Elvis R. Pino", "field_9": "+1 555 0100"}` and packaged code decides where each value goes |
| **Violation** | Byte returns selectors, actions or any instruction sequence the extension executes to decide what to do |

The test a reviewer applies is whether the full functionality is discernible
from the submitted package. If the model's response can change what the
extension does rather than what it types, the answer is no.

## Reaching a form inside somebody else's page

Most applications are not filled on the board's own domain. They are filled on
a company careers page that embeds the board's form in a cross-origin iframe.

```
  careers.acme.com                     ← never injected, never reachable
  └── <iframe src="boards.greenhouse.io/embed/…">
        └── content script             ← injected, because THIS origin matches
```

Chrome decides to inject by looking at the frame's own origin, so
`all_frames: true` is the entire mechanism. No permission over the company's
domain is needed, at runtime or otherwise, and
[`spikes/phase-3/`](../spikes/phase-3/) demonstrates both halves in a real
browser: the parent is not injected, and a message addressed to it fails with
*"Could not establish connection"*.

Knowing *which* frame to talk to is the part that needed designing.
`chrome.tabs.sendMessage(tabId, msg)` with no `frameId` reaches every frame but
resolves with whichever answers first, so a broadcast cannot enumerate. The
roll call inverts it:

| | |
|---|---|
| `fill:rollCall` | background → every frame. The reply is discarded. |
| `fill:here` | each frame → background. **Carries `sender.frameId`.** |
| `fill:describe` / `fill:apply` | background → the chosen frame, addressed by id |

A message travelling towards the background is the only way to learn a frame's
id without `chrome.webNavigation`, which would hand us the URL of every frame
of every tab for no gain.

The roster lives in a module variable in the service worker, which is
terminated after 30 seconds of idle. That is correct rather than unfortunate: a
frame list older than the page it describes is worse than no list, and the roll
call that rebuilds it costs a quarter of a second.
