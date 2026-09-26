# Phases

Each phase has an **exit gate**. The gate is a demonstrable fact, not a feeling.
Do not start the next phase until the gate passes, because every phase after it
assumes the gate held.

Estimates assume evenings and weekends, not full days. They are ranges because
Phase 0 can invalidate them.

| Phase | What it proves | Rough size |
|---|---|---|
| 0 | The architecture is real | 1 evening |
| 1 | The vault holds and locks | 1 to 2 weeks |
| 2 | Filling works on the easy ATS | 1 to 2 weeks |
| 3 | Filling works where forms actually live | 1 week |
| 4 | The hard ATS is solved | 2 to 3 weeks |
| 5 | Byte writes the prose | 1 week |
| 6 | Someone else can install it | 2 to 3 days |

---

## Phase 0 — Spikes

**Four of the five are done.** Run on Chromium 141.0.7390.37 on 26 September
2026. The harness is committed at [`spikes/phase-0/`](../spikes/phase-0/) so
every answer is one command away from being re-checked.

| # | Question | Answer |
|---|---|---|
| 1 | Does `chrome.offscreen` accept the reason `WORKERS`? | **Yes.** No fallback needed. |
| 2 | Does `opfs-sahpool` survive a full browser restart? | **Yes.** Written in one run, read back in the next against the same profile. |
| 3 | Are Workday's shadow roots open or closed? | **Open question.** Not runnable without a real application page. |
| 4 | Can the extension fetch loopback? | **Yes on 141.** Local Network Access is enforced from 142, so re-run before relying on it. |
| 5 | Does `chrome.storage.session` round-trip a `CryptoKey`? | **No.** It returns a plain object, silently. |

**The architecture is confirmed empirically, not just from specifications.**
Inside the service worker, the `Worker` constructor is absent and
`createSyncAccessHandle` is absent, while `navigator.storage.getDirectory` is
present. The service worker can see the file system but can neither open a
synchronous handle nor spawn a worker that could. The offscreen hop is
mandatory.

**Spike 5's failure changed a decision.** The vault key lives in a module
variable in the offscreen document. `chrome.storage.session` accepts a
`CryptoKey` without error and hands back a useless plain object, which is the
worst kind of failure because nothing tells you.

**Spike 3 is the one that still matters.** Every existing Workday automation
used Playwright or the DevTools protocol, both of which pierce shadow DOM
natively, so none of them ever had to answer it. A content script does not have
that power. It needs a real `*.myworkdayjobs.com` page and it is the only
remaining unknown that could change the shape of Phase 4.

**Gate: passed for 1, 2, 4 and 5.** Phase 1 can start. Phase 4 cannot be
planned in detail until spike 3 is answered.

## Phase 1 — The vault · done

Security first, as designed. **There is no network code in the extension at the
end of this phase, not even unused**, and a build-time check fails the build if
any appears.

Built:

- SQLite through the offscreen chain, with numbered SQL migrations
- The eleven-table schema from `05-data.md`
- Column-level AES-GCM with AAD binding each ciphertext to its row, column and
  schema version
- Argon2id at the OWASP configuration, derived with `extractable: false`, held
  only in the offscreen document
- Lock, unlock, and a fifteen minute idle auto-lock
- Import from `perfil/cv.md`, parsed into structured rows
- The sensitive field registry, fourteen fields, seeded empty
- A read-only side panel, light and dark, following the system

**Gate: passed.** `node tests/e2e/gate.cjs`, eleven checks, against a real
browser launched twice over the same profile.

| Check | Result |
|---|---|
| Vault created from a passphrase | pass |
| The real `cv.md` imported | 5 roles, 2 degrees, 2 links |
| Experience visible after import | pass |
| Sensitive fields listed, all empty | pass |
| A database file exists on disk | pass |
| **An encrypted column never appears in plaintext** | pass |
| An unencrypted column does appear, so the scan really reads the file | pass |
| Locked again after a full browser restart | pass |
| A wrong passphrase is refused | pass |
| The profile survived the restart | pass |
| **No request left the extension origin** | pass |

Plus 32 unit tests, including the one the AAD design exists for: a ciphertext
moved to another row or column fails to decrypt.

Two corrections to the plan, found by building it:

- **The Argon2 package name in the research was wrong.** `@openpgp/argon2id` is
  not published to npm. The build uses `hash-wasm`, which is maintained, ships
  Argon2id, and costs about 11 KB.
- **`@webext-core/messaging` has no namespace option** for the extension
  messenger, only for the page messenger. The two channels are kept apart by
  key prefixes instead, which the gate confirms works.

## Phase 2 — Fill Lever and Greenhouse, direct URLs only

**Both, not Lever alone.** They are similar enough that the second is nearly
free, and two data points stop the first adapter from hard-coding one ATS's
habits into the shared code.

The easy case, deliberately. Plain HTML, stable ids like `#first_name`, open job
APIs, no anti-automation clause found.

- Field detection in four passes: the `autocomplete` token, then Chromium's
  vendored patterns, then the per-ATS map, then our own label heuristics for the
  job-specific fields nobody else covers. Anything unresolved is marked, not
  guessed.
- The honeypot denylist and the computed visibility check, from day one, even
  though these two ATS do not need them
- Fill, highlight every value written, show a review list
- Never submit
- The CV file attached to the file input, via a main-world `DataTransfer`

The first two passes cover identity, address and phone well. Neither covers work
history, education, visa status or demographics, which is most of a job
application. Do not plan around them carrying more than they do.

**Gate.** A real Lever application and a real Greenhouse application, both
filled, both reviewed, both submitted by hand. Zero sensitive fields filled
automatically. Zero hidden fields written.

---

## Phase 3 — Iframes and company career pages

The case that is actually most of your applications: the same Greenhouse or
Ashby form embedded in an iframe on the company's own careers domain.

- `all_frames: true` plus `match_about_blank`
- Per-frame injection driven by `chrome.webNavigation`, because the declarative
  flag only covers frames present at load and these embeds are script-injected
  after the Apply button
- Cross-frame messaging through the service worker
- The broad host permission requested at runtime, on a user gesture
- Fallback: offer to open the standalone ATS URL in a new tab

**Gate.** Fill a Greenhouse form embedded on a third-party careers domain
without granting a permanent broad permission.

---

## Phase 4 — Workday

Its own phase because it is its own problem.

- The `data-automation-id` map from `09-ats.md`
- **Hard denylist for `beecatcher` and `website`**
- Custom listboxes opened and selected in a single synchronous pass, because the
  menu closes between round trips
- Synthetic events rather than naive clicks, because of the intercepting overlay
- Read the live Application Progress list rather than hardcoding a step count,
  which varies per employer
- Account creation stays manual. The extension never creates an account.

**Gate.** A complete Workday application filled across every wizard step, with a
DOM assertion proving `beecatcher` was never written to, then submitted by hand.

---

## Phase 5 — Byte in the loop

Free text only. Everything structured was already solved in Phases 2 to 4.

- The flat value-map contract from `03-security.md`
- Transport over `gh codespace ports forward` to loopback, never a public port
- Graceful degradation: when Byte is unreachable the extension keeps filling
  everything else and says the text is unavailable. Byte already has this pattern
  in its Gemini client.
- Every generated answer lands in a review queue. Nothing is written to the form
  until you accept it.
- Answers you accept are stored and offered next time the same question
  fingerprint appears

**Gate.** Generate a cover letter for a real posting, edit it, accept it, and
confirm a posting containing injection text changes nothing beyond producing a
draft you can discard.

---

## Phase 6 — Distribution

- Unpacked in developer mode. No fee, no review, no policy surface.
- A `README` with a real screenshot and an honest scope section
- A release build and a versioning scheme

Publishing to the Chrome Web Store is a separate decision with its own cost:
privacy policy, data disclosures, identity verification, two-step verification,
trader declaration, and a review that takes longer for anything requesting broad
hosts. Do not start it until Phase 4's gate has passed.

**Gate.** A fresh Chrome profile installs the unpacked build and completes a
Lever application.

---

## Deliberately not planned

Ranking, scoring, feed ingestion and application tracking. All four already work
in Byte's `empleo/` module. Rebuilding them in a browser extension would be the
scope creep that costs you the single-purpose requirement.
