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

## Still open, and genuinely yours

| # | Decision | Options | Mine |
|---|---|---|---|
| 1 | **Repository visibility** | Public, like Byte / Private until Phase 2 | **Public** ★ |
| 2 | **Icon** | Caret in a field / Page with a caret / Bracket with a caret | **Caret in a field** ★ |
| 3 | **Default theme** | Follow the system / Always dark | **Follow the system** ★ |
| 4 | **Auto-lock** | 15 minutes idle / On browser close / Never | **15 minutes** ★ |
| 5 | **First ATS** | Lever alone / Lever and Greenhouse together | **Both** ★ |

- [ ] 1. Visibility: ______________
- [ ] 2. Icon: ______________
- [ ] 3. Theme: ______________
- [ ] 4. Auto-lock: ______________
- [ ] 5. First ATS: ______________

## Still unverified, and Phase 0's whole job

Needs a real browser. See [`04-phases.md`](04-phases.md).

- [ ] Does `chrome.offscreen` accept the reason `WORKERS` on current Chrome
- [ ] Does `opfs-sahpool` survive a full browser restart
- [ ] Are Workday's shadow roots open or closed, and does `chrome.dom` reach them
- [ ] Can the extension fetch loopback under Chrome 142's Local Network Access rules
- [ ] Does `chrome.storage.session` round-trip a non-extractable `CryptoKey`

## Worth ten minutes before spending money

- [ ] Search the Chrome Web Store by hand for the final name. Store search is
      blocked to automated tools, so "nothing found" came from indexed search.
- [ ] Confirm the domains at a registrar. Availability was inferred from DNS.
- [ ] A trademark search, if this is ever monetised.
