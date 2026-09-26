# PageMyCV

**A local-first browser bot that fills job application forms from your own CV.
It fills. You review. You submit.**

> The name is a placeholder. See [`docs/00-name.md`](docs/00-name.md) for the
> shortlist and how to change it in one command.

PageMyCV is the browser half of [Byte](https://github.com/elvisxd/byte). Byte finds
the job, scores it against your profile and writes the text. PageMyCV is the hand
that types it into the form and then stops.

**Status: Phase 2 done.** It fills Lever and Greenhouse applications from an
encrypted local vault, attaches your résumé, highlights everything it wrote,
and refuses to touch a sensitive field or a honeypot. It still has no network
code at all. Next is Phase 3: the same forms embedded in an iframe on a
company's own careers page, which is where most applications actually live.

| | |
|---|---|
| Sensitive fields filled automatically | **zero**, by construction |
| Hidden fields written, across nine techniques | **zero** |
| Forms submitted | **zero**, and there is no code that could |
| Requests leaving your machine | **zero** |
| Host permissions requested | **none** |

<img src="docs/media/filled-form.png" alt="A Lever application form with seven fields filled and outlined in blue, the resume attached, and the Gender select still untouched" width="620">

*A Lever application, filled. Everything it wrote is outlined. The search box
at the top, the cover letter and every voluntary self-identification question
below are untouched, and the Submit button was never pressed.*

<img src="docs/media/fill-review.png" alt="The side panel review list: eight filled, nine left to you, two honeypots refused, twenty skipped, with a row per field saying why" width="360">

*The review, field by field. Every refusal says which guard refused it and
why.*

---

## Why another autofill extension

There are five serious ones already. Every single one of them keeps your
résumé on their servers.

| | The incumbents | PageMyCV |
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

**Working today**, because they are plain HTML with stable ids and publish
open job APIs:

`Lever` · `Greenhouse`

The extension runs on `jobs.lever.co`, `boards.greenhouse.io` and
`job-boards.greenhouse.io`, and nowhere else. There are no host permissions:
the content script's own match list is the entire grant, so the extension
cannot read the address of a tab it is not running in.

Ashby moved out of the first batch. It renders inside its own iframe, which
makes it the same problem as an embedded Greenhouse form on a company's
careers page — Phase 3, not Phase 2.

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
| [`DECISIONS.md`](docs/DECISIONS.md) | Every choice made, why, and the one still open |
| [`spikes/phase-0/`](spikes/phase-0/) | The verification harness and its results |

## Running it

```bash
pnpm install
pnpm build            # then load .output/chrome-mv3 as an unpacked extension
pnpm check            # typecheck, lint, 198 unit tests, and the invariant guard
node tests/e2e/gate.cjs   # the Phase 1 and 2 gates, against a real browser
```

## License

MIT. See [LICENSE](LICENSE).
