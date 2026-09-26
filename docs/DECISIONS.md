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

## Still open

One thing, and it is the only one that could still change the shape of the
project.

- [ ] **Are Workday's shadow roots open or closed?** Needs a real
      `*.myworkdayjobs.com` application page. `chrome.dom.openOrClosedShadowRoot`
      handles either, but a frame nested inside a shadow root is unreachable by
      design. Every existing Workday automation used Playwright or the DevTools
      protocol, which pierce shadow DOM natively, so none of them ever had to
      answer this. A content script does not have that power.

