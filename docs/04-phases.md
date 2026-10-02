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
- Lock, unlock, a twelve character minimum passphrase, and a fifteen minute
  idle auto-lock
- Import from `perfil/cv.md`, parsed into structured rows
- The sensitive field registry, fourteen fields, seeded empty
- A read-only side panel, light and dark, following the system

**Gate: passed.** `node tests/e2e/gate.cjs`, nineteen checks, against a real
browser launched twice over the same profile, run twenty times in a row without
a failure.

| Check | Result |
|---|---|
| Four panels opening at once reach the same state | pass |
| A passphrase under the minimum is refused **by the worker** | pass |
| A document that is not a CV is refused, and the profile survives | pass |
| Every imported role is stored and rendered, count for count | pass |
| Every sensitive field is listed and actually empty | pass |
| The plaintext region IS on disk, so the encrypted city was really stored | pass |
| Vault created from a passphrase of at least 12 characters | pass |
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

Plus 81 unit tests, including the one the AAD design exists for: a ciphertext
moved to another row or column fails to decrypt.

> **Six of those rows no longer describe the build.** The passphrase was
> removed on request after Phase 4 — see "The passphrase comes out" below. The
> table is left as it was because it records what Phase 1 shipped and passed,
> not what is true today; rewriting it would erase the fact that the property
> was once there and was given up deliberately.

Two corrections to the plan, found by building it:

- **The Argon2 package name in the research was wrong.** `@openpgp/argon2id` is
  not published to npm. The build uses `hash-wasm`, which is maintained, ships
  Argon2id, and costs about 11 KB.
- **`@webext-core/messaging` has no namespace option** for the extension
  messenger, only for the page messenger. The two channels are kept apart by
  key prefixes instead, which the gate confirms works.

## Phase 2 — Fill Lever and Greenhouse, direct URLs only · done

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

**Gate: passed.** `node tests/e2e/gate.cjs`, now forty-five checks, run several
times in a row without a failure. The two boards are served from disk by the
harness through Playwright's `context.route`, so the page commits at the real
`https://jobs.lever.co/...` and `https://boards.greenhouse.io/...` URL — which
is what the content script's `matches` are actually tested against — while
nothing is fetched from the network. **The extension is not modified for the
test in any way.**

| Check | Result |
|---|---|
| **Zero sensitive fields filled**, nine of them on one form | pass |
| A field beside a labelled one does **not** inherit its label | pass |
| Nothing is attached to a form with nowhere to attach it | pass |
| **Zero hidden fields written**, across nine techniques | pass |
| Each trap refused **by a named guard**, not merely left unrecognised | pass |
| It never submitted, on either board | pass |
| The fixture really contains those traps, so the two counts above are not counting nothing | pass |
| Every field it filled holds the value the CV actually says | pass |
| A visible, labelled `website` **is** filled, so the denylist is not blanket | pass |
| The résumé is attached as a `File`, byte for byte | pass |
| A label that is only a sibling still resolves | pass |
| A label that is only a `<span>` in the field group still resolves | pass |
| A disabled field is left alone | pass |
| A field the board prefilled is not overwritten | pass |
| No cover letter was written | pass |
| The refused honeypots are visible in the review, not silent | pass |
| Each sensitive field gets its own row saying it is yours to answer | pass |
| No request left the extension origin | pass |

Plus 226 unit tests, up from 81, including a jsdom suite for the two modules
that ARE the DOM boundary. `src/fill/descriptor.ts` and `src/fill/write.ts`
had been reachable only through the browser gate, which made them the least
tested and most dangerous code in the phase. The adversarial review found real
bugs in both.

### The review, after the phase passed its gate

Seven findings, five of them proven by reverting the fix and watching a test
go red.

| Finding | Why it mattered |
|---|---|
| **A held element reference can become a different field.** A plan crosses two message hops, and frameworks reuse DOM nodes while changing their attributes. | The right value written into the wrong box, reported as a success. Every write action now carries a fingerprint the writer re-derives from the live element before touching it. |
| **The sibling-label walk stepped over another control.** | The second input in a flat container inherited the first one's question. Reverting the fix makes the gate report `unlabelled_neighbour -> "ada@lovelace.test"`. |
| **`closest(…, 'div')` matched almost anything.** | The same bug from the other side: the first label-ish descendant of a container holding several fields. The group now has to hold exactly one control. |
| **The CV bytes were sent on every fill.** | Most application forms have no file input. The whole résumé was crossing into a page's process with nowhere to go, which is the opposite of why the plan is built in the background. |
| **A detached node counted as filled.** | A write nobody can see, reported as a success. |
| **A two-character prefix counted as an option match.** | `US` is a prefix of `Usually`. Exact matches still handle a two-letter code. |
| **`catch(() => UNSUPPORTED)` swallowed real errors.** | A bug inside the content script was reported as "this site is not supported", which is the kind of lie that costs an afternoon. |

Two smaller ones: the document size was being re-measured once per field, and
`clearHighlights` restored `outline` but not `outlineOffset`, leaving a page's
own styling half-restored.

One comment was overclaiming and is now narrower. Not marking up the page does
**not** mean the page cannot tell it is being filled: the highlight is an
inline style it can read, and a page watching `input` events sees every write.
What it buys is that the scan itself, including the fields that are then
refused, is not announced.

**No `host_permissions`, and not as a deferral.** The content script's own
`matches` are the whole grant. The background reads a tab id and nothing else,
and learns the URL from the content script that is already running there, so
the extension cannot see the address of any tab it is not injected into. That
is a stronger property than a promise not to look, and `scripts/guard.mjs`
fails the build if `host_permissions` ever appears.

Six things the building changed:

- **The CV parser never read an email or a phone number.** The vault held
  neither, so a filled Lever form had five fields written and the one box
  every board makes required still empty. Found by the gate, not by review.
- **A message could be added everywhere except the one place that routes it.**
  Registering a handler is optional by design, so the missing registration
  compiled cleanly and failed at runtime as *"the message port closed before a
  response was received"*, which names neither the message nor the layer. Both
  hops now route through a `Record` over the protocol type, so leaving one out
  is a type error. Proven by deleting a key and watching `tsc` fail.
- **Text normalisation was duplicated and each copy was broken differently.**
  One lowercased before splitting camelCase, so `name="dateOfBirth"` never
  reached the date-of-birth pattern and an unlabelled birth date would have
  been filled. The other kept accents, so `Résumé` did not match `résumé`,
  because `\b` needs a word character and `é` is not one. One function now.
- **The pass order in `09-ats.md` was wrong.** It put Chromium's patterns
  ahead of the per-ATS map, which would have let a 0.8 guess pre-empt a 0.9
  fact. Reversed, and the reasoning is in `src/fill/detect.ts`.
- **Two hidden-field techniques were passing for the wrong reason.** The gate
  said zero writes and it was true, but the review list showed `opacity: 0`
  and a `clip-path` on an **ancestor** reported as "not recognised" rather
  than "hidden": they were empty because nothing classified them, not because
  a guard refused them. `opacity` does not inherit and a field inside a
  clipped box has a full-size rect, so neither is visible to a per-element
  measurement. Found by looking at a screenshot, not by a failing assertion.
  The gate now asserts which guard refused each trap.
- **Two of Chromium's own IGNORED patterns cannot be used as written.**
  `REGION_IGNORED` is literally `province|region|other`, so promoting it to a
  global veto would have vetoed the `STATE` field it exists to disambiguate.
  The vetoes are scoped, and `patterns.test.ts` pins that.

---

## Phase 3 — Iframes and company career pages · done

The case that is actually most of your applications: the same Greenhouse form
embedded in an iframe on the company's own careers domain.

**Three of the five bullets planned here were wrong**, and a spike said so
before any of them was built. The harness is at
[`spikes/phase-3/`](../spikes/phase-3/).

| Planned | Actually |
|---|---|
| `all_frames: true` plus `match_about_blank` | **Correct**, and the whole of it |
| Per-frame injection driven by `chrome.webNavigation`, because the declarative flag only covers frames present at load | **Wrong.** A frame added two seconds after load is injected like any other. Chrome matches a frame when it navigates, not only at document start. The permission would have bought nothing and cost the URL of every frame of every tab. |
| Cross-frame messaging through the service worker | **Correct**, and it needed one idea: see below |
| The broad host permission requested at runtime, on a user gesture | **Wrong.** None is needed, at runtime or otherwise. |
| Fallback: offer to open the standalone ATS URL in a new tab | **Not needed.** It was for the case where a parent content script cannot reach the child. There is no parent content script, and the child needs no reaching. |

**Why no permission is needed.** The iframe's own origin is on the match list,
and that is the entire basis for Chrome injecting into it. The page that
embeds it is irrelevant to the decision. The spike confirms the parent is
never injected and the background cannot reach it at all — the message fails
with *"Could not establish connection"*.

**The one thing that did need designing** is knowing *which* frame to talk to.
`chrome.tabs.sendMessage(tabId, msg)` with no `frameId` reaches every frame but
resolves with whichever answers first, so a broadcast cannot enumerate. The
answer is to invert it:

```
background ──"roll call"──▶ every frame        (reply discarded)
background ◀──"here I am"── each frame          (carries sender.frameId)
background ──describe/apply──▶ the chosen frame (addressed by id)
```

A message travelling *towards* the background carries `sender.frameId`, and
that is the only way to learn a frame's id without `webNavigation`.

`src/fill/frames.ts` then picks between them: most fields wins, ties broken by
the top frame and then the lowest id, so the same page answers the same way
twice. A fill that lands somewhere different on the second run is worse than
one that refuses.

**Gate: passed.** Fill a Greenhouse form embedded on a third-party careers
domain without granting a permanent broad permission — satisfied by never
asking for one.

| Check | Result |
|---|---|
| The embedded board form is filled | pass |
| The panel says **where** it filled, because the click was on another page | pass |
| **The parent page's own fields were never touched** | pass |
| The parent form really has fields, so the check above counts something | pass |
| Zero sensitive fields filled in the embedded form | pass |
| Neither the embed nor the parent submitted | pass |
| The manifest still requests **no** host permissions, no `webNavigation`, no `tabs` | pass |
| The content script is declared for the two boards only, in all frames | pass |
| The panel reached the embedded form at all | pass |
| A board page with no form is refused, and says so | pass |
| A page with no content script is refused with a **different** reason | pass |
| And refused without spending the long retry budget | pass |

### The review, after the phase passed its gate

Four findings. The first two were mine, made while fixing something else,
which is the pattern these reviews exist to catch.

| Finding | Why it mattered |
|---|---|
| **The "no listener" check never fired.** It matched Chrome's wording, and `@webext-core/messaging` replaces that with its own `Error: No response`. | The retry budget was spent on every ordinary page: **2356 ms** to say "I do not know this site", where Phase 2 answered at once. The unit tests passed against Chrome's text the whole time. Found by probing what the call actually threw. |
| **Silence means two different things.** Stopping at the first silence then called every careers page unsupported: until its embed mounts, no frame in the tab runs our content script, and it looks exactly like an unrelated site. | Two budgets now: a short one while nothing has answered, a long one once something has. Both are pinned by tests, including the one that broke the first fix. |
| **The roll call counted fields nobody can fill** — hidden inputs, submit buttons, disabled controls. That count is what ranks frames when a page embeds more than one form, so a frame with two real fields and five hidden ones beat a frame with three real ones. | `countFillable` in descriptor.ts, shared with the selector it had been written out beside. The same duplication that broke text normalisation in Phase 2. |
| **Two different problems shared one message.** "I do not know this page" was also what you got on a board page while looking at the job description rather than the application form. | That is the commonest way a fill "does not work", and the message sent people hunting for a bug instead of clicking Apply. Two messages now, and the gate asserts each one against its own fixture. |

**The cause of all four is the same:** `rollCall` and the roster lived inside
`src/entrypoints/background.ts`, which nothing can import, so they had no
tests. `src/fill/roll-call.ts` now holds the decision with its Chrome calls
injected — the clock is a counter, so a two-second budget is tested in zero
milliseconds and the pass count is exact rather than approximate.

Ashby stays out. It is the same shape — its embed is its own iframe — so
adding it is a registry entry plus a probe, not a design change.

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

## The passphrase comes out

Not a phase. Asked for directly — *"que abra normal sin login ni nada"* — after
a Google sign-in was costed and set aside for later.

What it changes is written up in `03-security.md` under "What dropping the
passphrase cost", including the part that is a real loss: a copied browser
profile now reads the CV. The short version is that with no passphrase there
is no secret the machine does not also have, so no storage choice recovers
that property. What survives is the split between the two stores, which is
what makes a copy of the *database file alone* useless.

Three things were found building it, all by measuring rather than reasoning:

- **`chrome` is undefined inside a dedicated worker** (`spikes/phase-5`). The
  worker is where the key is used and would have been the natural owner. It
  cannot be, so the design changed before it was written.
- **An offscreen document has `chrome.runtime` and nothing else.** This one
  was not measured first, it was assumed — the key store went there, and every
  open failed. The gate caught it. The key store now lives in the service
  worker, which is the only context that can hold it.
- **`ensureOffscreen` waited for the document to exist, not to answer.** A
  latent race that predates this change: `createDocument` resolves before the
  document's scripts have run, and anything sent in that window comes back
  "Receiving end does not exist". One relayed message could absorb it; a
  sequence could not, so opening the vault made it visible. It now waits for
  a ping, which is the fix the original comment had already described without
  applying.

Existing vaults are converted rather than abandoned: the passphrase is asked
for once, the key it derives is stored, and nothing is re-encrypted, because
it is the same key. The ordering that makes that safe is in
`src/vault/convert.ts` and tested in `tests/unit/convert.test.ts`.

---

## Any site, not a list of sites

Not a phase either. Asked for: fill on the popular boards and on the ones
nobody has listed, faster, with the CV as it is and the rest typed in.

The classifier never cared which board it was on. Pass 0 (the sensitive
class), pass 1 (`autocomplete`), pass 3 (Chromium's patterns) and pass 4 (the
label rules) are standards and words; only pass 2 is a per-board map, and
three boards already shipped with a thin or empty one. So "any site" was
never a classification problem. It was two smaller ones:

- **Getting the script there.** Declared boards get it from the manifest.
  Anywhere else it is injected into the active tab under `activeTab`, after
  the person clicks the icon — one tab, until navigation, nothing stored.
  `src/fill/inject.ts` is the only module allowed to do it.
- **Stopping the refusal.** `chooseFrame` and `fillActiveTab` both threw
  "not a board" on an unknown origin. An unknown origin is a definition with
  an empty map now, chosen on what the frame holds.

Three boards were declared on the strength of the host table in
`09-ats.md` — Workable, SmartRecruiters, Jobvite — with empty maps, which is
a deliberate state: the host is documented, the form is not.

**What the gate cannot drive, measured.** Every route to the `activeTab`
grant was tried from Playwright (`spikes/phase-6`): keyboard commands never
reach the browser, the icon cannot be clicked, `permissions.request` needs a
gesture, and a grant written into the profile by hand is not honoured. So
the injection is one line CI never runs. Everything around it runs: the
decision in `src/fill/on-demand.ts` with fakes; a form with no recognisable
field names filling from labels alone, in unit tests and in the gate; and
Chrome's refusal on the page with no script, which is real in the gate and
is what becomes the message telling the person to click the icon.

**Gate.** `tests/fixtures/generic.html`: name, email, phone, employer, title
and links fill with no map; the résumé attaches; a screening question with
no stored answer, the work-authorisation question, the cover letter and the
off-screen `website` are all left alone. The page with no content script
says how to grant it, naming the boards that need no grant.

**Not done.** A field a form asks for that neither the CV nor the answers
hold — street address, postal code, a start date — is reported as "nothing
stored", which is honest and unhelpful. The panel has nowhere to type those
yet. That is the next piece: your details, typed once, filled everywhere.

**Not measured.** An unknown page that embeds a form from a *second* unknown
origin. `activeTab` is documented as a grant on the tab; whether
`executeScript` with `allFrames` reaches a cross-origin frame under it, or
skips it, or fails, is exactly the kind of fact this project measures rather
than reads — and it cannot be measured headlessly, for the same reason the
grant itself cannot. Until somebody tries it on a real page, the honest
expectation is that the embedded form is *not* reached, and the message says
to open the form's own page instead.

---

## Deliberately not planned

Ranking, scoring, feed ingestion and application tracking. All four already work
in Byte's `empleo/` module. Rebuilding them in a browser extension would be the
scope creep that costs you the single-purpose requirement.
