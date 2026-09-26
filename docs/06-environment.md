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
| UI | **Preact 10 via `preact/compat`** ← changed | Was React 19. See below. |
| Styling | Tailwind v4 | Radix Colors mapped through `@theme` |
| Colour | `@radix-ui/colors` ← added | See `07-design.md` |
| Database | `@sqlite.org/sqlite-wasm`, `opfs-sahpool` VFS, driven directly | Do not use a wrapper. See below. |
| Passphrase KDF | `@openpgp/argon2id` ← added | Under 7 KB, WASM inlined. See `03-security.md`. |
| Messaging | `@webext-core/messaging` v4 ← added | Typed messages across all four contexts |
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
│   ├── fill/
│   │   ├── detect.ts          # find fields: autocomplete, then label, then give up
│   │   ├── visibility.ts      # the computed visibility gate
│   │   ├── honeypot.ts        # the denylist
│   │   ├── write.ts           # the ONLY module that writes to the DOM
│   │   └── sensitive.ts       # the field class, and the confirmation flow
│   ├── ats/
│   │   ├── registry.ts        # url pattern to adapter
│   │   ├── lever.ts
│   │   ├── greenhouse.ts
│   │   ├── ashby.ts
│   │   └── workday.ts
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
│   ├── unit/
│   └── e2e/
├── .claude/
│   ├── skills/                # see 08-mcp-and-skills.md
│   └── settings.json
└── .github/workflows/ci.yml
```

Three rules that the layout exists to enforce:

- **`src/fill/write.ts` is the only module that writes to the DOM.** Every write
  passes the honeypot denylist, the visibility gate and the sensitive class.
  One door means one place to audit.
- **`src/byte/client.ts` is the only module that calls `fetch`.** A CI check
  fails the build if a `fetch` appears anywhere else.
- **`src/db/worker.ts` is the only module that touches SQLite.** Everything else
  goes through messages, because nothing else runs in a context where the
  database exists.

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

| Check | Fails when |
|---|---|
| Single fetch site | `fetch(` appears outside `src/byte/client.ts` |
| No submit | `.submit()`, `type="submit"` clicks, or a synthetic Enter appears in `src/fill/` |
| No sync storage | `chrome.storage.sync` appears anywhere |
| No telemetry | Any known analytics package appears in the lockfile |
| Permission drift | Required `host_permissions` differ from a committed allowlist |
| Crypto containment | `crypto.subtle` appears outside `src/vault/crypto.ts` |

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

```yaml
# .github/workflows/ci.yml
on: [push, pull_request]
jobs:
  check:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: pnpm/action-setup@v4
      - uses: actions/setup-node@v4
        with: { node-version: 22, cache: pnpm }
      - run: pnpm install --frozen-lockfile
      - run: pnpm check
```

Keep it to one job. A pipeline you do not read is a pipeline that goes red and
stays red.

## What is deliberately absent

- No Docker. A browser extension builds to static files.
- No hosted database. That is the entire point.
- No error reporting service. See invariant 5.
- No dependency that loads code at runtime. The content security policy forbids
  it and the guard script checks for it.
