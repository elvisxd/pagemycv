# The ATS field maps

Everything here comes from public source code and documentation, not from
inspecting a live session. **Verify each map against a real page with the
`ats-probe` skill before building on it.** Anything marked unverified stayed
unverified after research.

## URL patterns

Match these in the manifest and in `src/ats/registry.ts`.

| ATS | Page host | Public job API |
|---|---|---|
| Workday | `{tenant}.wd{1-105}.myworkdayjobs.com` | `/wday/cxs/.../jobs` |
| Greenhouse | `boards.greenhouse.io/{slug}`, `job-boards.greenhouse.io/{slug}` | `boards-api.greenhouse.io/v1/boards/{slug}/jobs` |
| Lever | `jobs.lever.co/{slug}` | `api.lever.co/v0/postings/{slug}` |
| Ashby | `jobs.ashbyhq.com/{slug}` | `api.ashbyhq.com/posting-api/job-board/{slug}` |
| SmartRecruiters | `careers.smartrecruiters.com/{slug}` | `api.smartrecruiters.com/v1/companies/{slug}/postings` |
| Workable | `apply.workable.com/{slug}` | `apply.workable.com/api/v1/widget/accounts/{slug}` |
| iCIMS | `{slug}.icims.com`, `careers-{slug}.icims.com` | — |
| Taleo and Oracle | `{slug}.taleo.net`, `*.oraclecloud.com/hcmUI/CandidateExperience/` | — |
| Jobvite | `jobs.jobvite.com/{slug}` | — |

Note both Greenhouse hosts. `boards.greenhouse.io` is the legacy board and
`job-boards.greenhouse.io` is the current one. Missing either loses half the
market.

`*.myworkdaysite.com` was seen referenced as an alternate Workday candidate host
but could not be confirmed. Probe it before adding. **Still not added** as of
Phase 4: an unconfirmed host widens where the content script runs in exchange
for nothing proven, and `scripts/guard.mjs` will refuse it until somebody
puts it on the allowlist deliberately.

---

## Honeypots

**This table is the most important thing in this document.**

| ATS | Field | Matched on | Behaviour |
|---|---|---|---|
| Workday | `beecatcher` | `data-automation-id`, `name`, `id` | Hidden input labelled *"This input is for robots only, do not enter if you're human."* Filling it flags the application as automated. |
| Workday | `website` | `name` | A second honeypot, reported across several independent automation projects. |

The denylist is layer one. Layer two is the computed visibility check in
`src/fill/visibility.ts`, which exists because **the next honeypot will not be
called `beecatcher`**. Never rely on the names alone.

---

## Lever

The friendliest target. Start here.

- Conventional server-rendered form, no iframe or shadow DOM found
- Posting id is a UUID in the path: `/([0-9a-f-]{36})/i`
- Headline selectors: `.posting-headline h2`, `.posting-headline h1`
- Name and email are always required. Everything else is configured per account,
  so **the field set differs between employers**. Lever tells integrators to
  inspect a live form for exactly this reason.
- "Link questions" collect URLs such as LinkedIn and GitHub

Strategy: `autocomplete` token first, then label text. No per-employer map is
worth maintaining.

## Greenhouse

Plain HTML with stable ids. The difficulty is not the form, it is where the form
lives.

- Direct board fields: `#first_name`, `#last_name`, and similar
- Custom questions come from the posting's `questions` array in the public API,
  which means you can read the question set before the page renders
- **The hard case.** Companies embed the form in an iframe on their own domain.
  The container id is `grnhse_iframe`, and the embed maps like this:

  | | |
  |---|---|
  | Parent page | `https://careers.acme.com/positions/2272778/?application=true` |
  | Embedded form | `https://boards.greenhouse.io/embed/job_app?for=acme&token=2272778` |

  The iframe is cross-origin, so the parent content script cannot reach it. A
  second content script instance in the child frame is required.

  **That is all it takes, and it needs no permission over the parent.** With
  `all_frames: true`, Chrome injects into the iframe because the *iframe's*
  origin is on the match list; the page embedding it is irrelevant to the
  decision and is never injected. Proven in `spikes/phase-3/`. The
  open-the-standalone-URL fallback another extension settled for is not needed
  here, because there is no parent content script that has to reach anything.

## Ashby

React, with CSS-module hashed class names. Assume no stable hooks.

- Embeds run inside an Ashby-managed iframe, mounted from
  `<div id="ashby_embed">` plus a script from `jobs.ashbyhq.com/{slug}/embed`
- Three embed modes exist: full board, API-driven with your own form, and
  application-form only
- Class names are unstable. Match on **label text**, not on classes.

## Workday

Its own phase. Everything below is why.

### The good news

`data-automation-id` attributes are the most stable hooks across tenant skins.
Known values in the apply flow:

| Section | Values |
|---|---|
| Account | `email`, `password`, `verifyPassword`, `createAccountLink`, `createAccountCheckbox`, `createAccountSubmitButton`, `signInSubmitButton`, `verificationCode` |
| Wizard | `applyFlowPage`, `progressBar`, `progressBarStepIcon`, `pageFooterNextButton` |
| My information | `formField-legalName--firstName`, `formField-legalName--lastName`, `formField-addressLine1`, `formField-city`, `formField-postalCode`, `formField-countryRegion`, `formField-phoneType`, `formField-phoneNumber`, `formField-source`, `formField-candidateIsPreviousWorker` |
| Voluntary disclosures | `formField-gender`, `formField-hispanicOrLatino`, `formField-ethnicity`, `formField-veteranStatus`, `formField-disabilityStatus`, `selfIdentifiedDisabilityData`, `formField-dateSignedOn`, `formField-name`, `formField-acceptTermsAndAgreements` |
| Other | `educationSection`, `formField-websitePanelSet`, `file-upload-input-ref`, `searchBox`, `legalNoticeAcceptButton` |

**Every field in the voluntary disclosures row belongs to the sensitive class.**
None of them fills automatically, ever.

### The bad news

| Problem | What it means for the adapter |
|---|---|
| **The `beecatcher` honeypot** | Hard denylist plus the visibility gate |
| **Account creation is mandatory** | The flow lands on `/apply/applyManually` behind a create-account form. The extension never creates an account. |
| **Step count varies per employer** | Read the live Application Progress list. One employer has six steps, another has eight. Never hardcode. |
| **A click-intercepting overlay** | Normal clicks time out while buttons report visible and enabled. Playwright automations use `force: true`; a content script needs synthetic dispatched events. |
| **Custom listboxes, not `<select>`** | The menu must be opened and the option selected in one synchronous pass. The menu closes between asynchronous round trips and a later query finds zero options. |
| **Shadow-heavy** | ~~The single unverified fact that most affects Phase 4.~~ **Settled, and it does not matter.** `chrome.dom.openOrClosedShadowRoot` does handle either — measured in spikes/phase-4 against roots the page itself sees as `null`, nested two deep. The rest of that row was wrong: a frame inside a shadow root **is** reachable. What the pierce does NOT fix on its own is labels (`id` is scoped per root) and events (a bubbling one stops at the boundary); both needed their own fix. |
| **Saved drafts resume automatically** | Landing on `/apply` may skip the entry choice. Detect state from the progress list, not from the URL. |

---

## Chromium's own field classifier

Before writing a single label heuristic, use Chrome's. The patterns are vendored
at `vendor/chromium-autofill/`, under BSD-3-Clause.

It is the classifier Chrome runs in production against the entire web: 83 field
types, 361 positive patterns, each with a negative pattern that rejects false
matches, in up to 16 locales. Hand-rolled heuristics always forget the negative
half.

**Covers** names, street address down to house number, city, state, postal code,
country, phone split into country code, area code, prefix, suffix and extension,
email, and company name.

**Covers nothing job-specific.** The full type list was checked: no work history,
no education, no visa status, no salary, no demographics. Those stay ours.

**Replicate one guard:** Chrome applies these heuristics only when a form has at
least three fields classified with distinct types. Without it they fire on search
boxes.

So field detection is four passes, not three. **Pass 0 was added while
building it, and the order of 2 and 3 was reversed.**

| Pass | Source | Roughly |
|---|---|---|
| **0** | **The sensitive class** | **Runs first and wins. See below.** |
| 1 | The `autocomplete` attribute | 10 fields, when the form is marked up well |
| 2 | The per-ATS map above | The fields each ATS names in its own way |
| 3 | Chromium's patterns | Identity, address and phone, even on badly marked-up forms |
| 4 | Our own label heuristics | Work history, education, links, notice period |

**Why pass 0 exists, and why it has to be first.** *"Country of citizenship"*
matches Chromium's `COUNTRY` pattern exactly. Without a sensitive pass ahead
of everything, the planner would write the user's country of residence into a
citizenship question and report it as a success. `autocomplete="bday"` is the
same shape of problem: a standards-blessed token for a field we refuse on
purpose. `src/fill/sensitive-match.ts` runs before all four and vetoes them,
and `tests/unit/fill.test.ts` pins both collisions.

**Why 2 and 3 swapped.** An exact match on a field name a board documents to
its own integrators is stronger evidence than a regex over label text, and
the confidence scores say so: 0.9 against 0.8. Leaving the order as first
drafted would have let the weaker signal pre-empt the stronger one. No
conflict between them was found on either board — Lever's `org` is invisible
to Chromium's `COMPANY_NAME`, which wants the whole word `organization` — so
in practice this changes ranking rather than results.

**Two of the vendored IGNORED patterns cannot be used as written.**
`REGION_IGNORED` is `province|region|other`; as a global veto it would reject
the `STATE` field it exists to disambiguate. `CREDIT_CARD_EXP_YEAR` is
`exp|^/|year`, and a bare `exp` swallows "experience". Both are left out of
`scripts/build-patterns.mjs`, and the rest are scoped to the kinds Chromium
scopes them to rather than applied globally. English only: a Spanish pattern
applied to an English form matches noise, and both Phase 2 boards are
English.

---

## The `autocomplete` standard, and its ceiling

Use it as the first and highest-confidence pass. Know what it does not cover.

**Covered:** `given-name`, `family-name`, `additional-name`, `name`, `email`,
`tel` and its subparts, `url`, `street-address`, `address-line1` to
`address-line3`, `address-level1` and `address-level2`, `postal-code`,
`country`, `country-name`, `organization`, `organization-title`, `bday`, `sex`,
`username`, `current-password`, `new-password`, `one-time-code`.

**Not covered, at all:** work history, education, résumé upload, cover letter,
salary expectation, work authorization, visa sponsorship, demographic questions,
references, availability, notice period.

That is roughly ten of the forty fields in a real application. The remaining
thirty come from label heuristics, the per-ATS maps above, and finally from you.

---

## Per-ATS status

| ATS | Status | Map | Verified against a live page |
|---|---|---|---|
| Lever | built | yes | No — against a fixture built from public page source |
| Greenhouse | built | yes | No — against a fixture built from public page source |
| Greenhouse embedded | built | yes | No — against a fixture built from the documented embed shape |
| Ashby | built | thin | Labels copied from a real application form |
| Workday | PR #8 | yes, unverified | No — needs a real tenant |
| Workable | declared, no map | — | No. Host from the table above; the form fills from labels alone |
| SmartRecruiters | declared, no map | — | No. Same |
| Jobvite | declared, no map | — | No. Same |
| iCIMS, Taleo | not declared | — | Tenant subdomains; need the `*.` host form PR #8 adds |
| **Any other site** | **on demand** | — | The same script, injected into the active tab after a click on the icon. See `src/fill/inject.ts` and `spikes/phase-6` |

"Declared, no map" is a deliberate state, not an unfinished one. The host is
documented, the form is not, and a map written from guesswork is a
hypothesis wearing a confidence score. With an empty map pass 2 contributes
nothing and the standards-based passes carry the form — which is exactly
what happens on a site nobody has named. Declaring the host buys one thing:
the content script is already there, so an application embedded in a
company careers page fills without the person clicking the icon first.

Update the right-hand column as `ats-probe` runs. **A map nobody probed is a
hypothesis**, and that is still true of both Phase 2 maps: the gate proves the
code does what it says against a form shaped like the real one, not that the
form is shaped the way this document claims. The four passes are designed so
that being wrong here costs recognition rather than correctness — a field the
map misnames falls through to `autocomplete` and Chromium, and a field nothing
recognises is reported as unrecognised rather than guessed at.

Ashby moved out of Phase 2. It renders inside its own iframe, which makes it
a Phase 3 problem wearing a Phase 2 label, and two boards were already enough
to keep the shared code from hard-coding one ATS's habits.

## The honeypot denylist, as built

`src/fill/honeypot.ts` matches whole words rather than substrings, in both
directions: substring matching would hit `websiteUrl`, a real field on several
boards, and would still miss a trap named `bee_catcher`. camelCase is split,
so `data-automation-id="beeCatcher"` is caught too.

`website` is the interesting one. It is a genuine, wanted field on Lever and
Greenhouse and a honeypot on Workday, so it is released from the denylist only
on evidence: the field must be **visible and labelled**, both, never one. The
gate asserts both halves — the visible labelled `website` is filled, and an
off-screen one is not.
