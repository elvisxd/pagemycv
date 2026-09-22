# Nibble

**A local-first browser bot that fills job application forms from your own CV.
It fills. You review. You submit.**

> The name is a placeholder. See [`docs/00-name.md`](docs/00-name.md) for the
> shortlist and how to change it in one command.

Nibble is the browser half of [Byte](https://github.com/elvisxd/byte). Byte finds
the job, scores it against your profile and writes the text. Nibble is the hand
that types it into the form and then stops.

**Status: planning.** No code yet. This repository currently holds the design,
the security model and the phase plan. Everything here is meant to be argued
with before a line is written.

---

## Why another autofill extension

There are five serious ones already. Every single one of them keeps your
résumé on their servers.

| | The incumbents | Nibble |
|---|---|---|
| Where your CV lives | Their cloud | Your machine |
| Who can read it | Them, and anyone who breaches them | You |
| What writes your free text | Their model, their prompt | Your model, on your hardware |
| Who presses submit | You, mostly | You, always |

That is the entire pitch. A job application contains your address, your phone
number, your employment history and often your work authorization status. That
is a dossier. It should not need a round trip to a startup's database to be
typed into a form.

## What it will never do

These are invariants, not preferences. Each one is enforced in code and has a
test.

1. **It never presses submit.** Not as an option, not behind a setting.
2. **It never fills a sensitive field on its own.** Work authorization dates,
   document numbers, salary expectations and demographic questions always stop
   and ask, field by field.
3. **It never lets the page decide what it does.** A job posting is untrusted
   input. It supplies values to read, never instructions to follow.
4. **It never touches a honeypot.** Workday ships a hidden field named
   `beecatcher` labelled *"This input is for robots only."* Filling it flags
   your application as automated. There is a hard denylist.
5. **It never phones home.** No telemetry, no analytics, no crash reporting.

## How it works

```
  job application page
          │
          │  content script reads the form
          ▼
  service worker  ──messages──▶  offscreen document  ──spawns──▶  worker
   (ephemeral)                    (persistent)                     SQLite (WASM)
          │                                                        OPFS, encrypted
          │
          │  free-text questions only
          ▼
  Byte on your own hardware
   returns values, never instructions
```

The unusual part is the database. SQLite genuinely runs inside a Chrome
extension, but only through that exact chain: the synchronous file API it needs
is exposed to dedicated workers alone, and a service worker cannot spawn one.
[`docs/02-architecture.md`](docs/02-architecture.md) has the evidence.

## Scope

Supported first, because they are plain HTML with stable ids and publish open
job APIs:

`Lever` · `Greenhouse` · `Ashby`

Then, as its own phase, because it is a shadow-heavy single-page app with a bot
honeypot, a click-intercepting overlay and a wizard whose length changes per
employer:

`Workday`

**Deliberately unsupported: LinkedIn and Indeed.** Both prohibit browser
extensions that automate activity on their sites, whatever the extension does.
The risk lands on your account, not on this project. See
[`docs/03-security.md`](docs/03-security.md).

## Documentation

| | |
|---|---|
| [`00-name.md`](docs/00-name.md) | Name shortlist and the rename command |
| [`01-vision.md`](docs/01-vision.md) | What it is, who it is for, what it refuses |
| [`02-architecture.md`](docs/02-architecture.md) | Manifest V3, the offscreen chain, why the service worker cannot hold the database |
| [`03-security.md`](docs/03-security.md) | Threat model, the sensitive-field class, prompt injection, store policy |
| [`04-phases.md`](docs/04-phases.md) | Phases 0 to 6, each with an exit gate |
| [`05-data.md`](docs/05-data.md) | SQLite schema and the encryption scheme |
| [`06-environment.md`](docs/06-environment.md) | Stack, folder layout, scripts, CI |
| [`07-design.md`](docs/07-design.md) | Palette, typography, components |
| [`08-mcp-and-skills.md`](docs/08-mcp-and-skills.md) | MCP servers and repository skills |
| [`09-ats.md`](docs/09-ats.md) | Per-ATS field maps, selectors and honeypots |
| [`DECISIONS.md`](docs/DECISIONS.md) | Every open choice, in one list |

## License

MIT. See [LICENSE](LICENSE).
