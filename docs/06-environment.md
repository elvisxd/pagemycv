# Environment

## Stack

Options are listed where a real choice exists. A star marks my recommendation.

| Layer | Recommendation | Alternatives considered |
|---|---|---|
| Runtime | Node 22 LTS | — |
| Package manager | **pnpm** ★ | npm is fine, slower and heavier on disk |
| Extension framework | **WXT** ★ | Plasmo, still on Parcel; CRXJS, Chromium only |
| Language | TypeScript, `strict: true` | — |
| UI | **React 19** ★, the stack you already work in | Preact cuts about 30 KB, at the cost of a different mental model |
| Styling | **Tailwind v4** ★ | CSS modules, more typing and no design tokens for free |
| Database | `@sqlite.org/sqlite-wasm`, `opfs-sahpool` VFS | See `02-architecture.md` |
| Lint and format | **Biome** ★, one tool, one config, very fast | ESLint plus Prettier, two tools and more configuration |
| Unit tests | Vitest | — |
| End-to-end | Playwright, against local fixtures | — |
| CI | GitHub Actions | — |

**Why Biome over ESLint here specifically.** The dependency surface is part of
the threat model. One tool with no plugin ecosystem is fewer packages that can
run code at install time.

## Folder layout

```
nibble/
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
