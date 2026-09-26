# Environment

## Stack

Every row below was re-checked against the current registry on 26 September
2026. Two picks changed as a result, and they are marked.

| Layer | Pick | Note |
|---|---|---|
| Runtime | Node 22 LTS | — |
| Package manager | pnpm | — |
| Extension framework | **WXT** | Still the leading choice. Plasmo has shipped nothing since May 2025. |
| Language | TypeScript, `strict: true` | — |
| UI | **Preact 10** ← changed | Was React 19. The built side panel is 19.9 KB. |
| Styling | Tailwind v4 | Radix Colors mapped through `@theme` |
| Colour | `@radix-ui/colors` ← added | See `07-design.md` |
| Database | `@sqlite.org/sqlite-wasm`, `opfs-sahpool` VFS, driven directly | Do not use a wrapper. See below. |
| Passphrase KDF | `hash-wasm` ← added | Argon2id, about 11 KB. `@openpgp/argon2id` does not exist on npm. |
| Messaging | `@webext-core/messaging` v4 ← added | Typed messages. No namespace option for the extension messenger, so channels are separated by key prefix. |
| Lint and format | Biome | One package, one binary set, lint and format together |
| Unit tests | Vitest, with WXT's bundled `@webext-core/fake-browser` | An in-memory `chrome.*`, so most logic needs no browser |
| End-to-end | Playwright | With one real limitation, below |
| CI | GitHub Actions | — |

### Changed: React 19 becomes Preact 10

Measured, same counter app, Vite 8, minified and gzipped:

| | gzipped |
|---|---|
| SolidJS | 4.3 KB |
| **Preact 10** | **5.7 KB** |
| Svelte 5 | 10.1 KB |
| React 19 with react-dom | 67.7 KB |

**The reason is the side panel's lifecycle, not ideology.** A side panel is torn
down and re-instantiated every time the user opens it, unlike a page application
that boots once. React's roughly 215 KB of parse and execute is paid on every
single open, and a 360 pixel list of chips uses none of what that weight buys.

`preact/compat` keeps the React API and the React ecosystem, and WXT supports it.

**Verify before aliasing:** Preact's React 19 surface is incomplete. `use()` and
`useActionState` have open issues. If the panel ends up using React 19 Actions,
check them first. Target Preact 10.29.x, not the 11 release candidate.

### Kept, after checking the alternative: SQLite driven directly

**SQLocal looked like it would save the worker plumbing. It would have broken
the architecture.** Its source has zero occurrences of `sahpool`; it uses the
`opfs` VFS, which needs `SharedArrayBuffer`, which needs cross-origin isolation.

Three consequences, any one of which is disqualifying:

- Cross-origin isolation keys apply to **every** extension page, so the side
  panel would have to serve a policy header for every cross-origin image it
  loads.
- The service worker cannot be cross-origin isolated even with the keys set.
- It pins an older SQLite than the current release.

`wa-sqlite` is lower level, not higher. `sqlite-wasm-http` solves a different
problem and is dead. Drizzle has no sqlite-wasm driver at all; if an ORM is ever
wanted, `drizzle-orm/sqlite-proxy` layers over the existing worker without
touching the VFS.

The hundred lines of message plumbing is the right price.

### Kept, after checking the alternative: Biome

oxlint is genuinely faster and its type-aware rules are ahead, now covering 59 of
typescript-eslint's 61. But replacing Biome means three packages instead of one,
44 platform binaries instead of 8, and `oxfmt` is still alpha, so Prettier would
have to stay. Dependency surface is part of the threat model here. Revisit when
`oxfmt` reaches 1.0.

### Two limitations to design around

**WXT does not treat offscreen documents as first class.** The word does not
appear anywhere in the package. Side panels are first class and get their
permission and manifest entry generated; the offscreen document is created as an
unlisted page, with the permission added by hand and `chrome.offscreen.
createDocument()` called by hand. Since the entire database layer lives there,
budget for writing that glue. WXT is also still pre-1.0, so minor versions can
break.

**Playwright cannot drive the real side panel.** The feature request has been
open since 2023. The workaround costs almost nothing: navigate an ordinary page
to `chrome-extension://<id>/sidepanel.html`, which is the same document with the
same component tree and the same messaging, just not hosted in the browser's
panel chrome.

One more Playwright trap worth knowing before it wastes an afternoon: when Chrome
suspends the service worker after 30 seconds and restarts it, Playwright keeps
the same worker object and emits no new event. Any in-memory global silently
vanishes. **Assert service-worker state through `chrome.storage`, never through
globals.**

## Folder layout

The shape below is the plan through Phase 6. What Phases 1 and 2 actually
built is marked **·built**; the rest is still a sketch and will move.

```
pagemycv/
├── docs/                      # this planning set
├── src/
│   ├── entrypoints/           # WXT convention, one file per extension context
│   │   ├── background.ts      # the service worker. Owns no state.
│   │   ├── content.ts         # injected into pages and frames
│   │   ├── offscreen/         # the persistent host that spawns the worker
│   │   │   ├── index.html
│   │   │   └── main.ts
│   │   └── sidepanel/         # the only user interface
│   │       ├── index.html
│   │       └── App.tsx
│   ├── db/
│   │   ├── worker.ts          # the ONLY place SQLite is touched
│   │   ├── schema.ts          # typed row definitions
│   │   ├── queries/           # one file per table
│   │   └── migrations/        # 001_initial.sql, numbered, transactional
│   ├── vault/
│   │   ├── crypto.ts          # AES-GCM and PBKDF2. No other file imports WebCrypto.
│   │   └── lock.ts            # unlock, auto-lock, session state
│   ├── fill/                  # ·built, except as noted
│   │   ├── types.ts           # the vocabulary; no DOM, no vault
│   │   ├── descriptor.ts      # the ONLY module that READS the page
│   │   ├── write.ts           # the ONLY module that WRITES to the page
│   │   ├── text.ts            # one normalisation, shared by every pass
│   │   ├── detect.ts          # the four passes, in evidence order
│   │   ├── sensitive-match.ts # pass 0: spotting a sensitive question
│   │   ├── plan.ts            # what gets written, and why the rest does not
│   │   ├── visibility.ts      # the computed visibility gate
│   │   ├── honeypot.ts        # the denylist
│   │   └── chromium-patterns.generated.ts   # from vendor/, by pnpm patterns
│   ├── ats/
│   │   ├── registry.ts        # ·built. url to ATS, and the per-board maps
│   │   ├── ashby.ts           # Phase 3, it lives in an iframe
│   │   └── workday.ts         # Phase 4
│   ├── byte/
│   │   └── client.ts          # the ONLY fetch call site in the codebase
│   ├── frames/
│   │   └── inject.ts          # per-frame injection driven by webNavigation
│   └── ui/                    # components, following 07-design.md
├── fixtures/
│   ├── lever/                 # captured HTML, committed
│   ├── greenhouse/
│   ├── workday/
│   ├── honeypots/             # six hidden-field techniques, for the gate test
│   └── private/               # gitignored, real captures with real data
├── tests/
│   ├── unit/                  # vitest; dom.test.ts runs under jsdom
│   ├── fixtures/              # the job-board pages the gate serves from disk
│   └── e2e/                   # the gate, against a real browser
├── .claude/
│   ├── skills/                # see 08-mcp-and-skills.md
│   └── settings.json
└── .github/workflows/ci.yml
```

Three rules that the layout exists to enforce:

- **`src/fill/write.ts` is the only module that writes to the DOM.** Every write
  passes the honeypot denylist, the visibility gate and the sensitive class.
  One door means one place to audit. `scripts/guard.mjs` fails the build if
  any other file in the fill path assigns `.value`, `.files` or `.checked`.
- **`src/byte/client.ts` is the only module that calls `fetch`.** A CI check
  fails the build if a `fetch` appears anywhere else.
- **`src/db/worker.ts` is the only module that touches SQLite.** Everything else
  goes through messages, because nothing else runs in a context where the
  database exists.
- **Every cross-context message is routed through a `Record` over its protocol
  type**, in `src/entrypoints/offscreen/main.ts` and `src/entrypoints/background.ts`.
  Registering a handler is optional by design, so a list of registrations let
  a message be added everywhere except the one place that routes it: it
  compiled cleanly and failed at runtime as *"the message port closed before a
  response was received"*, naming neither the message nor the layer. Leaving a
  key out of either Record is now a type error.

### Testing the DOM boundary

`descriptor.ts` and `write.ts` are the two modules that touch the page, which
makes them the two that most need tests and the two hardest to test. They run
under **jsdom**, in `tests/unit/dom.test.ts`: attributes, structure, prototype
setters, events and `isConnected` are all real there. Layout and
`DataTransfer` are not, and those stay the browser gate's job. Everything else
in `src/fill/` is pure by construction and needs neither.

## Scripts

```jsonc
{
  "dev":          "wxt",                       // hot reload, loads unpacked
  "build":        "wxt build",
  "zip":          "wxt zip",                   // a store-ready package
  "typecheck":    "tsc --noEmit",
  "lint":         "biome check .",
  "fix":          "biome check --write .",
  "test":         "vitest run",
  "test:e2e":     "playwright test",
  "check":        "pnpm typecheck && pnpm lint && pnpm test && pnpm guard",
  "guard":        "node scripts/guard.mjs"     // the invariant checks below
}
```

`pnpm check` is what runs before every commit and in CI. One command.

## The guard script

Cheap static checks that enforce the invariants from `03-security.md`. Grep-level,
deliberately, so they are impossible to misread.

It strips comments before matching, so prose explaining an invariant cannot trip
that invariant's own check, and it **fails when it cannot parse** rather than
reporting success. It also prints which invariants it does and does not cover:
claiming more than it enforces is worse than enforcing nothing.

| Check | Fails when |
|---|---|
| One network door | Any transport appears outside `src/byte/client.ts`: fetch, XHR, WebSocket, EventSource, sendBeacon, importScripts, RTCPeerConnection |
| Never submit | `.submit()`, `.requestSubmit()`, a synthesized submit event, or a synthesized key press |
| No dynamic code | `eval`, `new Function`, `import()`, a string given to a timer, `innerHTML` |
| No sync storage | `chrome.storage.sync` appears anywhere |
| The key never persists | Any persistent store is written outside the worker, or a key is made extractable |
| One door each | `crypto.subtle` outside the vault, SQLite outside the worker |
| No telemetry | A known analytics package appears in `package.json` **or transitively in the lockfile** |
| The manifest | A permission outside the allowlist, any `host_permissions`, or a CSP that allows a remote or unsafe script source |

## Environment variables

There are almost none, on purpose. Configuration that matters lives in the vault
where it is encrypted, not in a dotfile.

```bash
# .env.example
VITE_BYTE_URL=http://127.0.0.1:8000    # overridable in the UI; never a secret
```

The Byte API key is entered in the side panel and stored encrypted. It never
appears in a file, an environment variable or a build artifact.

## Running Byte during development

```bash
# on the Mac, once per session
gh codespace ports forward 8000:8000 -c <codespace-name>
```

Not a public forwarded port. A public Codespaces port is reachable by anyone on
the internet with no authentication at all, and a private one needs a browser
auth cookie that expires every three hours.

## CI

One job, in `.github/workflows/ci.yml`: install, `pnpm check`, `pnpm build`,
then the phase gate against a real browser.

The gate is in CI rather than only on a laptop because a gate that runs in one
place rots. It reads a fixture CV at `tests/e2e/fixture-cv.md`, never anyone's
real one, and takes the real file only when `PAGEMYCV_CV` points at it.

Keep it to one job. A pipeline you do not read is a pipeline that goes red and
stays red.

## What is deliberately absent

- No Docker. A browser extension builds to static files.
- No hosted database. That is the entire point.
- No error reporting service. See invariant 5.
- No dependency that loads code at runtime. The content security policy forbids
  it and the guard script checks for it.
