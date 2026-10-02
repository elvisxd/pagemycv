# Decisions

Eighteen choices were open. **Research closed twelve of them and overturned four
of my own recommendations.** What remains open is at the bottom.

## Overturned by research

These were my recommendations. Evidence beat them.

| | I said | Research said | Now |
|---|---|---|---|
| **Name** | Nibble | An extension called exactly Nibble already exists, plus a company called Nibble selling AI negotiation software. **Understudy** is worse: a Chrome extension of that exact name already applies to jobs for you. | **PageMyCV**, the only candidate with npm and all three domains free |
| **Palette** | Hand-rolled, Primer-derived hex | Hand-rolling costs the maintenance of a system with none of the guarantees | **Radix Colors** through CSS variables into Tailwind's `@theme` |
| **State colours** | Green for filled, amber for review | Under deuteranopia those two appear nearly identical, and they are the two most frequent states in the list | **Blue and orange**, the axis robust across all common colour vision deficiencies |
| **Key derivation** | PBKDF2 at 600,000 | Still current OWASP guidance, but OWASP ranks it last, as the FIPS escape hatch. No memory hardness against a GPU attack on stolen data that can never be rotated. | **Argon2id** at `m=19 MiB, t=2, p=1`, under 7 KB |
| **UI library** | React 19 | Measured 67.7 KB gzipped against Preact's 5.7 KB, and a side panel is rebuilt on every open | **Preact 10** through `preact/compat` |

## Confirmed after checking the alternative

| | Alternative considered | Why it lost |
|---|---|---|
| **WXT** | Extension.js, Plasmo, CRXJS | Plasmo has shipped nothing since May 2025. WXT holds, though offscreen documents are not first class and it is still pre-1.0. |
| **sqlite-wasm driven directly** | SQLocal, wa-sqlite, Drizzle | SQLocal has zero support for the VFS we need, forces cross-origin isolation on every extension page, and pins an older SQLite |
| **Biome** | oxlint | Faster with better type-aware rules, but three packages instead of one, 44 platform binaries instead of 8, and its formatter is still alpha |
| **AES-GCM** | XChaCha20-Poly1305, native ChaCha20-Poly1305 | Hardware-accelerated everywhere this runs. The native variant landing in Chrome 155 uses the same nonce size, so it offers nothing. |
| **Playwright** | — | Right tool. Cannot drive the real side panel, so test the panel document as an ordinary page. |
| **System font stack** | Inter bundled locally | A web font is a network request, and the panel should open instantly |

## Added by research

| | |
|---|---|
| **Chromium's field classifier** | 83 types, 361 patterns with negative matches, 16 locales, BSD licensed. Vendored at `vendor/chromium-autofill/`. Field detection goes from three passes to four. |
| **AAD on every encryption** | Without it, any ciphertext decrypts in any column, so an attacker with file access can relocate and swap encrypted fields. The single highest-value line in the security document. |
| **`@webext-core/messaging`** | Typed messages across all four contexts, written by WXT's own author. The alternatives are stale since 2023 and dead since 2022. |
| **WCAG 2.2 target size** | Every interactive target at least 24 by 24 pixels. In a dense list this is a likelier compliance gap than colour. |
| **A colour-vision theme** | About thirty lines of token override, and the highest-leverage accessibility feature available here |
| **Padding low-entropy columns** | Ciphertext length reveals plaintext length. For work authorization status, the length is the value. |

## Closed

The last five, decided 26 September 2026.

| | Decision | Why |
|---|---|---|
| **Repository visibility** | **Public** | Same as Byte. The build history is the portfolio, and nothing here is a secret. |
| **Icon** | **A caret in a field** | Says what the product does at 16 pixels, and matches the name |
| **Default theme** | **Follow the system** | A browser panel should look like the browser |
| **Auto-lock** | **15 minutes idle** | Long enough to fill several applications, short enough that a walk away is covered |
| **First ATS** | **Lever and Greenhouse together** | Similar enough that the second is nearly free, and two data points stop the first adapter baking one ATS's habits into shared code |

## Answered by running it, not by reading

Phase 0, on Chromium 141, 26 September 2026. Harness at
[`spikes/phase-0/`](../spikes/phase-0/).

| | Answer |
|---|---|
| `chrome.offscreen` reason `WORKERS` | **Accepted.** No fallback needed. |
| `opfs-sahpool` across a browser restart | **Persists.** |
| The service worker's two blocks | **Both confirmed in the browser.** No `Worker` constructor, no `createSyncAccessHandle`. |
| `chrome.storage.session` with a `CryptoKey` | **Does not round-trip.** Returns a plain object, silently. Key moves to the offscreen document. |
| Loopback fetch from the extension | **Works on 141.** Re-check on 142, where Local Network Access is enforced. |
| The AAD mitigation | **Proved.** Decrypts in place, fails when moved. |

## Decided while building Phase 2

Each of these reversed or replaced something written above, and each was
forced by evidence rather than by taste.

| Decision | Chose | Because |
|---|---|---|
| **Detection pass order** | **The per-ATS map BEFORE Chromium's patterns**, and a sensitive pass before both | An exact match on a field name a board documents to its integrators is stronger than a regex over label text, and the confidence scores already said so: 0.9 against 0.8. The sensitive pass has to be first because *"Country of citizenship"* matches Chromium's `COUNTRY` exactly. |
| **Host permissions** | **None at all**, not even the two boards | The content script's `matches` already grant the two hosts. `host_permissions` would additionally hand the background the URL of every tab, for no gain: the content script already knows what page it is on and says so. The extension now cannot see the address of a tab it is not injected into. |
| **Where the plan is built** | **In the background, not the content script** | One extra round trip buys data minimisation: only the values the plan will actually write cross into the tab's process. The alternative puts the whole profile in a page's isolated world. |
| **Chromium's IGNORED patterns** | **Scoped, and two dropped entirely** | `REGION_IGNORED` is `province\|region\|other`; as a global veto it rejects the `STATE` field it exists to disambiguate. `CREDIT_CARD_EXP_YEAR`'s bare `exp` swallows "experience". Chromium applies these as competing classifications inside one group, not as global rejections. |
| **The vendored patterns** | **Generated into a committed module**, `pnpm patterns`, checked in CI | The source is 126 KB of JSON-with-comments that nothing can `require`. Generating it is the only way to know the committed copy still matches after a vendor bump. |
| **Ashby** | **Moved out of Phase 2** | It renders inside its own iframe, which makes it the Phase 3 problem wearing a Phase 2 label. Two boards were already enough to keep the shared code honest. |
| **`website`** | **On the denylist, released by evidence** | A real field on Lever and Greenhouse, a honeypot on Workday. It is released only when the field is both visible and labelled, never one, because a honeypot with a visible label would be warning the humans it is trying to catch. |
| **Cross-layer message routing** | **A `Record` over the protocol type at both hops** | A list of registrations let a message be added everywhere except the one place that routes it, compile cleanly, and fail at runtime as *"the message port closed before a response was received"*. |

## Decided by the Phase 2 review

| Decision | Chose | Because |
|---|---|---|
| **Trusting an element reference across a message hop** | **Never. Re-derive a fingerprint and check `isConnected` at write time** | A plan crosses two hops, and frameworks reuse DOM nodes while changing their attributes. A live reference is not evidence that it is still the same field, and writing through a stale one puts the right value in the wrong box and calls it a success. |
| **Where a label may come from** | **Only from something that can only be describing THIS field** | The sibling walk stops at another control and the group lookup requires the group to hold exactly one. Both were handing a field its neighbour's question. |
| **Sending the résumé** | **Only when the plan has somewhere to put it** | Most application forms have no file input at all. Sending it regardless put the whole CV in a page's process for nothing, which is the opposite of why the plan is built in the background. |
| **Testing the DOM boundary** | **jsdom, for `descriptor.ts` and `write.ts` only** | They were reachable only through the browser gate, which made the two most dangerous modules the two least tested. Layout and `DataTransfer` stay the gate's job. |
| **A loose option match** | **At least three characters** | `US` is a prefix of `Usually`. The exact matches above still handle a two-letter country code, which is the case that matters. |
| **Reporting an unreachable content script** | **Only a connection error means "unsupported site"** | `catch(() => UNSUPPORTED)` turned a bug inside our own content script into a claim about the user's page. |

## Decided by the Phase 3 spike, before any of it was built

| Decision | Chose | Because |
|---|---|---|
| **Reaching an embedded form** | **`all_frames: true` and nothing else** | Chrome injects into an iframe because the IFRAME's origin is on the match list. The page embedding it is irrelevant to that decision and is never injected. The spike confirms the parent is unreachable — *"Could not establish connection"*. |
| **`chrome.webNavigation`** | **Not requested** | The plan assumed the declarative flag only covers frames present at load. A frame added two seconds later is injected like any other. The permission would have bought nothing and cost the URL of every frame of every tab. |
| **A broad host permission at runtime** | **Never asked for** | The gate's wording was "without granting a permanent broad permission". Not asking at all is the stronger answer, and it is available. |
| **The standalone-URL fallback** | **Dropped** | It existed for the case where a parent content script cannot reach the child. There is no parent content script, and the child reports itself. |
| **Learning a frame's id** | **A roll call the frames answer by messaging back** | A broadcast with no `frameId` reaches every frame but resolves with whichever answers first, so it cannot enumerate. A message travelling TOWARDS the background carries `sender.frameId`, which is the only way to get it without `webNavigation`. |
| **Which frame, when there are several** | **Most fields, ties broken by top frame then lowest id** | Deterministic on purpose. A fill that lands somewhere different on the second run is worse than one that refuses. |
| **Saying where it filled** | **The panel names the board when the form was embedded** | The click happened on a company careers page and the values went into a form served by somebody else. Silence there is the difference between trusted and merely convenient. |

## Decided by the Phase 3 review

| Decision | Chose | Because |
|---|---|---|
| **Detecting "no content script here"** | **The adapter classifies; the rule does not guess** | The rule matched Chrome's error wording, and the messaging library replaces it with its own. Unit tests passed against text that never arrives. The translation now lives next to the library that does it, and `isNoListener` is tested against **both** wordings. |
| **How long to treat silence as meaningful** | **Two budgets: short while nothing has answered, long once something has** | Silence early is weak evidence, because a careers page has no content script anywhere until its embed mounts. Silence later is strong. One budget got it wrong in both directions, one after the other. |
| **What counts as a field, for ranking frames** | **Only what a person could fill** | Hidden inputs, submit buttons and disabled controls were counted, and that count decides which embedded form gets filled. |
| **Refusal messages** | **Two, not one** | "Not a board" and "a board with no form on this page" are different problems. The second is the commonest way a fill does not work — being on the job description — and one shared message sent people looking for a bug instead of clicking Apply. |
| **Announcing an import** | **After the refresh, not before** | The panel said "5 roles, 2 degrees" while the list below still showed the old profile. A promise made ahead of the thing it promises. |
| **Where roll-call logic lives** | **`src/fill/roll-call.ts`, with Chrome injected** | It was inside the background entrypoint, which nothing can import, so it had no tests — the same defect that hid Phase 2's bugs in `descriptor.ts` and `write.ts`. |

| **Screening answers** | **A table you type into, never inferred** | `notice_period` and `how_did_you_hear` used to be refused outright, because "we hold no answer for these, and a plausible guess is the failure mode this whole design exists to avoid". That was right while there was nowhere to put an answer. There is now, and the guarantee is kept by a better route: they read from a separate map the CV parser cannot reach, so no future change to parsing can start answering a question about you by inference. |
| **`preferred_name` is one of them** | **Never defaulted to the first name** | The obvious fix when the box came back empty. It is wrong: a "Preferred Name" field exists because the answer may differ from the legal one, and filling it from the legal name fails exactly the people the field is there for. |
| **Salary stays out of the answers table** | **It is sensitive, and stays refused** | Asked for it to be stored and filled like the others. `salary_expected` is in the sensitive registry with its reason already written — "the first number spoken usually wins" — and storing it for autofill would undo that. What was fixed instead is the matcher, so the question now reads as *yours to answer* rather than as *not recognised*. |
| **Notice before employer** | **Narrow questions before broad ones, in `LABEL_RULES` too** | `sensitive-match.ts` already stated that convention; this list did not follow it, and a bare `\bemployer\b` matched "How much notice would you need to give your current employer" — writing the company name into the box asking when you can start. Ordering plus an explicit `not`, because ordering alone is one reshuffle away from the bug returning. |

| **The passphrase** | **Removed. The key sits in `chrome.storage.local`.** | Asked for: *"que abra normal sin login ni nada"*. It is a real loss of threat 6 (a copied profile reads the CV) and it is written down as one in `03-security.md` rather than dressed up. With no passphrase there is no secret the machine lacks, so no storage choice recovers that property; what is kept is that the key and the data are in different stores, so the database file on its own is still useless. |
| **Who holds the key at rest** | **The service worker** | Not a preference — an elimination. The dedicated worker has no `chrome` at all and an offscreen document has only `chrome.runtime`, so the service worker is the one context that can read storage. The first design put it in the offscreen document; the gate refused it. |
| **Converting an old vault** | **Store the key the passphrase already derives; re-encrypt nothing** | The alternative was re-encrypting every column under a new key, which is a migration that can stop halfway and leave rows readable under two different keys. Changing where the key comes from cannot half-finish. |
| **Auto-lock and the Lock button** | **Both removed** | With the key on disk, locking would clear it from memory and the next call would silently read it back. A control that undoes itself is worse than no control, because it tells you the CV is protected while it is not. |

| **Backup file** | **Plain JSON, no passphrase** | Asked, and chosen. What it can hold today is the CV, the résumé and the screening answers, because no code sets a sensitive value. A passphrase would make a forgotten passphrase a lost backup. `tests/unit/backup-coverage.test.ts` fails the day sensitive values become settable, so this cannot outlive its reason silently. |
| **Restore semantics** | **Replace, in one transaction** | A merge has no answer for "the file has no résumé and the vault does". After a restore the vault is exactly the file. |
| **Which tables a backup covers** | **Every table decided, by a test** | Adding a table to a migration reminds nobody to add it to the backup. The coverage test is that reminder: every table is backed up or excluded with a written reason. |

| **Filling on a site nobody has named** | **`activeTab` + one injection module** | Asked for: popular sites and not-so-popular ones. The classifier never depended on the ATS — passes 0, 1, 3 and 4 are standards and labels — so the only question was how the script gets there. `activeTab` leaves nothing behind; an optional broad host would. Both measured in `spikes/phase-6`: neither can be driven by the gate, so the injection is one line in one guarded module and everything around it is tested instead. |
| **More boards, declared with empty maps** | **Workable, SmartRecruiters, Jobvite: hosts yes, maps no** | A host from the documented table costs one manifest line and buys embeds filling without the icon click. A map written without seeing the form is a hypothesis with a confidence score; an empty one lets the standards-based passes carry it, and a field they miss is reported as unrecognised rather than guessed. |
| **An unknown site is a definition** | **`UNKNOWN` has an empty map and is chosen like any board** | It used to be a refusal, which made "a site we have not named" indistinguishable from "no form here". `chooseFrame` now ranks on what a frame holds, not on whose it is. |

## Still open

One thing, and it is the only one that could still change the shape of the
project.

- [ ] **Are Workday's shadow roots open or closed?** Needs a real
      `*.myworkdayjobs.com` application page. `chrome.dom.openOrClosedShadowRoot`
      handles either, but a frame nested inside a shadow root is unreachable by
      design. Every existing Workday automation used Playwright or the DevTools
      protocol, which pierce shadow DOM natively, so none of them ever had to
      answer this. A content script does not have that power.

