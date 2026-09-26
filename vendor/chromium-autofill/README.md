# Chromium autofill field patterns

`legacy_regex_patterns.json` is copied verbatim from the Chromium source tree at
`components/autofill/core/browser/form_parsing/resources/`, fetched on
26 September 2026.

**License: BSD-3-Clause, © The Chromium Authors.** Compatible with this
project's MIT license. The copyright header is preserved at the top of the file.
Keep the attribution if the patterns ship in a build.

## What it is

The field classifier Chrome itself uses in production, on the whole web.

| | |
|---|---|
| Field types | 83 |
| Positive patterns | 361 |
| Locales | Up to 16 per type |
| Size | 127 KB |

Each entry carries a `positive_pattern` and usually a `negative_pattern`, so a
match can be rejected as well as accepted. That negative half is what a
hand-rolled label heuristic always forgets.

## What it covers, and what it does not

**Covers:** names in several cultural orders, street addresses down to house
number and apartment, city, state, postal code, country, phone broken into
country code, area code, prefix, suffix and extension, email, company name, and
all the credit-card fields.

**Does not cover anything job-specific.** The full type list was checked. There
is no work history, no education, no visa or work authorization, no salary
expectation, no demographic question, no cover letter. Those thirty-odd fields
are the project's own problem, solved by the per-ATS maps in `docs/09-ats.md`
and by label heuristics.

## One behaviour to replicate

Chrome only applies these heuristics when a form has **at least three fields
classified with distinct types**. Without that guard the patterns fire on search
boxes and newsletter signups. Replicate it.

## Notes

- The file is JSON with `//` comments, so it needs a JSONC parser or a comment
  strip before `JSON.parse`.
- The patterns are ICU regular expressions. Most translate directly to JavaScript
  `RegExp`, but they need a compile pass with a test asserting every one of the
  361 compiles, so a syntax difference fails the build rather than a form.
- Re-fetch periodically. Chrome updates these as the web changes.
