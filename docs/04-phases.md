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

Four throwaway tests. Every later phase rests on these, and each one is cheap
now and expensive to discover later. Write them in a scratch directory and
delete them afterwards.

1. **Does `chrome.offscreen` accept the reason `WORKERS`?** There is an
   unconfirmed report of it being rejected at some point. If it is, fall back to
   `BLOBS` or `DOM_SCRAPING` and note which.
2. **Does `opfs-sahpool` survive a browser restart?** Write a row, quit Chrome
   completely, reopen, read it back. Also kill the offscreen document mid-write
   and confirm `forceReinitIfPreviouslyFailed` recovers the stale handles.
3. **Can a content script reach Workday's fields?** Open a real
   `*.myworkdayjobs.com` application. Check that
   `document.querySelectorAll('[data-automation-id]')` returns nodes, and
   whether any custom elements have a `shadowRoot` that is null while
   `chrome.dom.openOrClosedShadowRoot` returns one. This is the single biggest
   unknown in the project. No source answered it, because every existing
   automation used Playwright, which sidesteps the question entirely.
4. **Can the extension reach Byte on loopback?** Chrome 142 enforces Local
   Network Access. Extensions are reported to be exempt. Confirm it with a real
   fetch from the service worker to `http://127.0.0.1:8000/health`.

**Gate.** All four answered in writing, in this document, with the answer and
the date. If spike 3 shows closed shadow roots that `chrome.dom` cannot pierce,
Phase 4 changes shape and you need to know that now.

---

## Phase 1 — The vault

Security first, as designed. No network code exists in the extension at the end
of this phase, not even unused.

- SQLite running through the offscreen chain, with migrations
- The schema from `05-data.md`
- Column-level AES-GCM, key derived from a passphrase, never persisted
- Lock and unlock, with an idle auto-lock
- Import from `perfil/cv.md`, parsed into structured rows
- The sensitive field registry, seeded
- Side panel showing the profile, read-only

**Gate.** Quit Chrome, reopen, unlock with the passphrase, see the profile. Then
inspect the OPFS file with the extension locked and confirm the sensitive
columns are ciphertext. Plus: a test asserting zero network calls in the whole
bundle.

---

## Phase 2 — Fill Lever and Greenhouse, direct URLs only

The easy case, deliberately. Plain HTML, stable ids like `#first_name`, open job
APIs, no anti-automation clause found.

- Field detection in three passes: the `autocomplete` token first, then label
  text heuristics, then give up and mark the field unresolved
- The honeypot denylist and the computed visibility check, from day one, even
  though these two ATS do not need them
- Fill, highlight every value written, show a review list
- Never submit
- The CV file attached to the file input, via a main-world `DataTransfer`

The `autocomplete` standard gives you about ten fields of a forty-field
application. There is no standard token for work history, education, visa status
or demographics. Do not plan around it carrying more than it does.

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
