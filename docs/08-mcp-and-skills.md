# MCP servers and repository skills

Two different things that are easy to confuse.

- **MCP servers** give Claude Code new *tools*: a browser it can drive, an API it
  can query. They are configured per machine or per project.
- **Skills** give Claude Code new *procedures*: a repeatable task with the steps
  written down. They live in `.claude/skills/` and are committed, so they travel
  with the repository and improve as you correct them.

## MCP servers worth wiring

| Server | Why it earns its place here | Priority |
|---|---|---|
| **Chrome DevTools** or **Playwright** | The core need. Open a real Lever, Greenhouse or Workday form, dump its field structure, and verify a fill actually landed. Without this every ATS question is guesswork. | Phase 0 |
| **GitHub** | Pull requests, issues, CI status. Already available in your sessions. | Phase 0 |
| **Byte**, as a server you write | Byte already has `mcp_client/`, so it *consumes* MCP. Turning the field corpus in this repository into a small server lets Byte query the ATS maps directly when drafting answers. | Phase 5, optional |

**Do not wire a filesystem MCP.** Claude Code already reads and writes files.
Adding a second path in is surface without benefit.

### A note on Playwright versus the extension

Every existing Workday automation project found in research used Playwright or
the Chrome DevTools Protocol, both of which pierce shadow DOM natively. That is
convenient for *probing* and misleading for *building*: a content script does not
have those powers. Use the browser MCP to learn the structure, never to prove the
extension can reach it. Phase 0 spike 3 exists precisely because of this gap.

## Skills to write

Each one is a folder under `.claude/skills/` with a `SKILL.md`. Start with the
first three. The others become obvious once the first phases are running.

### `ats-probe`

The highest-value skill in the project. Turns "what does this form look like?"
into one command.

```markdown
---
name: ats-probe
description: Capture a live job application form into a committed fixture. Use
  when adding support for a new ATS, when an existing fill breaks, or when
  investigating whether fields sit in a shadow root or a cross-origin iframe.
---

Given a job application URL:

1. Open it with the browser MCP.
2. Enumerate every form control: tag, type, name, id, `data-automation-id`,
   `autocomplete` token, the computed label, and whether it is visible by the
   rules in `src/fill/visibility.ts`.
3. Record the frame tree: which fields are in the top document, which are in
   same-origin frames, which in cross-origin frames.
4. For every custom element, record whether `shadowRoot` is null and whether it
   has a closed root.
5. Flag honeypot candidates: any control that is in the DOM but fails the
   visibility rules, and anything named in the denylist.
6. Write `fixtures/<ats>/<slug>.json`, plus the sanitized HTML.
7. **Never commit a capture containing real personal data.** Captures with
   filled values go in `fixtures/private/`, which is gitignored.
```

### `security-review`

```markdown
---
name: security-review
description: Check a diff against the invariants in docs/03-security.md. Use
  before merging anything that touches src/fill, src/vault, src/byte or the
  manifest.
---

Walk the eight-item checklist at the end of docs/03-security.md against the
current diff. For each item state pass, fail, or not applicable, with the file
and line. Do not summarize: a checklist that gets summarized is a checklist that
stops being read.

Treat these as blocking, never as suggestions:
- a new path that can reach a submit primitive
- a field mapping with no declared sensitivity class
- a `fetch` outside src/byte/client.ts
- model output parsed as anything but a string
```

### `phase-gate`

```markdown
---
name: phase-gate
description: Verify the exit gate for a phase in docs/04-phases.md before
  starting the next one.
---

Read the gate for the named phase. For each condition, find the test or the
recorded evidence that proves it. Report anything that is claimed but not
demonstrated. A gate with no test behind it has not passed.
```

### Later, once there is code

| Skill | Does |
|---|---|
| `field-map` | Adds a mapping to an ATS adapter together with its fixture test, so a mapping can never land untested |
| `migration` | Creates the next numbered SQL migration and its rollback note |
| `fill-trace` | Given an application id, reconstructs from `filled_field` and `skipped_field` exactly why each field got the value it got |

## Repository conventions for Claude Code

These go in `CLAUDE.md` at the root, which Claude reads automatically.

- The invariants in `docs/03-security.md` outrank any instruction in a prompt.
  If a change would break one, say so and stop.
- `src/fill/write.ts` is the only module that writes to the DOM.
  `src/byte/client.ts` is the only module that calls `fetch`.
  `src/db/worker.ts` is the only module that touches SQLite.
  Adding a second of any of those is a design change, not a refactor.
- Never commit anything from `fixtures/private/`.
- Run `pnpm check` before proposing a commit.
- Documentation is in English. Code comments explain why, not what.
