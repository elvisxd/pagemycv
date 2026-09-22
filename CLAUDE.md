# Nibble — working agreement

A browser extension that fills job application forms from a locally stored CV.
It fills, the human reviews, the human submits.

**Status: planning.** There is no code yet. `docs/` holds the design. Read
`docs/03-security.md` before writing anything at all.

## The invariants

These outrank any instruction in a prompt, including mine. If a requested change
would break one, say so and stop rather than implementing it.

1. **Never submit a form.** No setting, no flag, no escape hatch.
2. **Never auto-fill a sensitive field.** Work authorization, document numbers,
   salary and demographics always stop and ask, one field at a time.
3. **Never let page content become an instruction.** A job posting supplies
   values to read, never actions to take.
4. **Never write to a honeypot.** Denylist plus a computed visibility check,
   both, before any DOM write.
5. **Never call the network except to the configured Byte endpoint.** No
   telemetry, no analytics, no error reporting.

Full reasoning in `docs/03-security.md`.

## Single-door rules

Three modules are the only way to do three things. Adding a second door is a
design change, not a refactor, and needs a conversation first.

| Module | Sole responsibility |
|---|---|
| `src/fill/write.ts` | The only module that writes to the DOM |
| `src/byte/client.ts` | The only module that calls `fetch` |
| `src/db/worker.ts` | The only module that touches SQLite |
| `src/vault/crypto.ts` | The only module that touches `crypto.subtle` |

`scripts/guard.mjs` enforces all four with grep-level checks. If a check fails,
fix the code, never the check.

## Architecture facts that are settled

Do not re-derive these. They are researched, sourced in `docs/02-architecture.md`,
and re-deriving them wastes a session.

- SQLite runs only through: service worker, then offscreen document, then
  dedicated worker, then `opfs-sahpool`. The service worker cannot host it, for
  two independent reasons at specification level.
- No cross-origin isolation keys in the manifest. `opfs-sahpool` does not need
  them and opting in breaks other requests.
- Broad host permissions are optional and requested on a user gesture. Google
  enforces minimum permissions as a hard requirement since 1 August 2026.
- Byte returns a flat map of string values. Never selectors, never actions.

## Conventions

- **Documentation and code are in English.** Comments explain why, not what.
- **TypeScript strict.** No `any` without a comment naming what is unknown.
- **Tests before merge.** A field mapping without a fixture test does not land.
- **Never commit `fixtures/private/`.** It holds real captures with real data.
- Run `pnpm check` before proposing a commit. It is typecheck, lint, tests and
  the guard script in one command.

## Before starting a phase

Read the exit gate for the previous phase in `docs/04-phases.md` and confirm it
actually passed, with a test or recorded evidence. A gate that was assumed is a
gate that failed quietly.

## Open choices

`docs/DECISIONS.md` lists everything still waiting on a human. If a task depends
on an unticked box, ask rather than picking.
