# Documentation

Read in this order. Each one assumes the ones above it.

| | | |
|---|---|---|
| 1 | [`01-vision.md`](01-vision.md) | What it is, who it is for, and the four things it refuses to do |
| 2 | [`02-architecture.md`](02-architecture.md) | Manifest V3, the offscreen chain, and why the service worker cannot hold the database |
| 3 | [`03-security.md`](03-security.md) | **The spine.** Threat model, invariants, encryption, store policy, third-party terms |
| 4 | [`04-phases.md`](04-phases.md) | Phases 0 to 6, each with an exit gate |
| 5 | [`05-data.md`](05-data.md) | The SQLite schema and what is encrypted |
| 6 | [`06-environment.md`](06-environment.md) | Stack, folder layout, scripts, CI, the guard checks |
| 7 | [`07-design.md`](07-design.md) | Palette, typography, components, accessibility floor |
| 8 | [`08-mcp-and-skills.md`](08-mcp-and-skills.md) | MCP servers and the skills to write |
| 9 | [`09-ats.md`](09-ats.md) | Per-ATS field maps, selectors and honeypots |

Two shortcuts:

- [`DECISIONS.md`](DECISIONS.md) — every open choice in one list, with a
  recommendation for each
- [`00-name.md`](00-name.md) — the name shortlist and the rename command

## How to read this

Nothing here is code, and everything here is meant to be argued with. Where a
claim came from research it says so, and where something could not be verified
it says that too. The sections marked unverified in `04-phases.md` are the ones
that could still change the shape of the project.

The order above is also the build order, with one exception: read
`03-security.md` before writing any code at all, whichever phase you are on.
