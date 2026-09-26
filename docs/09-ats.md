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
but could not be confirmed. Probe it before adding.

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
  second content script instance in the child frame is required. When that
  fails, offer to open the embedded URL directly in a new tab, which is what
  another extension concluded after fighting it.

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
| **Shadow-heavy** | Described that way by more than one project. **Whether the roots are open or closed is the single unverified fact that most affects Phase 4.** Probe it first. `chrome.dom.openOrClosedShadowRoot` handles either, but a frame nested inside a shadow root is unreachable by design. |
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

So field detection is four passes, not three:

| Pass | Source | Roughly |
|---|---|---|
| 1 | The `autocomplete` attribute | 10 fields, when the form is marked up well |
| 2 | Chromium's patterns | Identity, address and phone, even on badly marked-up forms |
| 3 | The per-ATS map above | The fields each ATS names in its own way |
| 4 | Our own label heuristics | Work history, education, authorization, demographics |

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

| ATS | Phase | Map verified against a live page |
|---|---|---|
| Lever | 2 | No |
| Greenhouse | 2 | No |
| Ashby | 2 | No |
| Greenhouse embedded | 3 | No |
| Workday | 4 | No |
| iCIMS, Taleo, SmartRecruiters | Unplanned | No |

Update the right-hand column as `ats-probe` runs. A map nobody probed is a
hypothesis.
