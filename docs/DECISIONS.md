# Open decisions

Everything waiting on you, in one list. A star marks my recommendation and the
reasoning lives in the linked document. Tick a box, write the choice, and the
rest of the repository follows.

## Identity

| # | Decision | Options | Mine |
|---|---|---|---|
| 1 | **Name** — see [`00-name.md`](00-name.md) | Nibble / PageMyCV / Understudy / Carbon / Clip / Stub | **Nibble** ★ |
| 2 | **Repository visibility** | Public, like Byte / Private until Phase 2 | **Public** ★, the build history is the portfolio |
| 3 | **Documentation language** | English throughout / English README with Spanish internals, like Byte | **English** ★, you asked for English and recruiters read it |

- [ ] 1. Name: ______________
- [ ] 2. Visibility: ______________
- [ ] 3. Language: ______________

## Design — see [`07-design.md`](07-design.md)

| # | Decision | Options | Mine |
|---|---|---|---|
| 4 | **Palette** | A, ink and indigo / B, Byte family amber / C, monochrome | **A** ★. B forces the review state off amber, which costs more than the sibling story is worth. |
| 5 | **Typeface** | System stack / Inter bundled locally, about 30 KB | **System stack** ★, a web font is a network request and the panel should open instantly |
| 6 | **Icon** | Bitten square / Cursor in a field / Bracket with caret | **Bitten square** ★ if the name stays Nibble |
| 7 | **Default theme** | Follow the system / Always dark | **Follow the system** ★ |

- [ ] 4. Palette: ______________
- [ ] 5. Typeface: ______________
- [ ] 6. Icon: ______________
- [ ] 7. Theme: ______________

## Stack — see [`06-environment.md`](06-environment.md)

| # | Decision | Options | Mine |
|---|---|---|---|
| 8 | **UI library** | React 19 / Preact, about 30 KB smaller | **React 19** ★, it is your stack and the panel is not size-constrained |
| 9 | **Lint and format** | Biome, one tool / ESLint plus Prettier | **Biome** ★, fewer packages is part of the threat model |
| 10 | **Package manager** | pnpm / npm | **pnpm** ★ |

- [ ] 8. UI: ______________
- [ ] 9. Lint: ______________
- [ ] 10. Package manager: ______________

## Security — see [`03-security.md`](03-security.md)

| # | Decision | Options | Mine |
|---|---|---|---|
| 11 | **Key derivation** | PBKDF2 at 600k iterations, native / Argon2id, needs a WASM dependency | **PBKDF2** ★ for now. Argon2id is better and costs a dependency. Revisit at Phase 6. |
| 12 | **Encryption scope** | Sensitive columns only / The whole database file | **Columns** ★, so history stays searchable while locked |
| 13 | **Auto-lock** | 15 minutes idle / On browser close / Never | **15 minutes** ★ |
| 14 | **Demographic questions** | In the sensitive class / Fill from stored answers | **Sensitive** ★, declining is a protected choice and should stay yours each time |

- [ ] 11. KDF: ______________
- [ ] 12. Scope: ______________
- [ ] 13. Auto-lock: ______________
- [ ] 14. Demographics: ______________

## Scope — see [`04-phases.md`](04-phases.md) and [`09-ats.md`](09-ats.md)

| # | Decision | Options | Mine |
|---|---|---|---|
| 15 | **First ATS** | Lever alone / Lever and Greenhouse together | **Both** ★, they are similar enough that the second is nearly free |
| 16 | **LinkedIn and Indeed** | Out of scope / Support anyway | **Out of scope** ★, the risk lands on your account |
| 17 | **Chrome Web Store** | Developer mode only / Publish after Phase 4 | **Developer mode** ★ until Phase 4's gate passes |
| 18 | **Byte transport** | `gh codespace ports forward` to loopback / A public forwarded port | **Loopback** ★, a public Codespaces port has no authentication at all |

- [ ] 15. First ATS: ______________
- [ ] 16. LinkedIn and Indeed: ______________
- [ ] 17. Store: ______________
- [ ] 18. Transport: ______________

---

## Answered by research, not open

Recorded here so they do not get reopened by accident.

| | Answer | Source |
|---|---|---|
| Language of a browser extension | JavaScript only, TypeScript compiled. Byte can never run inside it. | [`02-architecture.md`](02-architecture.md) |
| Can SQLite run in the extension | Yes, but only offscreen document then dedicated worker then `opfs-sahpool`. Never the service worker. | [`02-architecture.md`](02-architecture.md) |
| Does the extension need COOP and COEP | No, `opfs-sahpool` avoids them, and opting in would break other requests | [`02-architecture.md`](02-architecture.md) |
| Is calling an LLM backend allowed under Manifest V3 | Yes for data, never for instructions the extension interprets | [`03-security.md`](03-security.md) |
| Do unlisted or private listings skip review | No. Same review, same policies. | [`03-security.md`](03-security.md) |
| Is there a honeypot to avoid | Yes. Workday's `beecatcher`, plus a `website` field. | [`09-ats.md`](09-ats.md) |

## Still unverified

These need a real browser and are Phase 0's entire job. See
[`04-phases.md`](04-phases.md).

- [ ] Does `chrome.offscreen` accept the reason `WORKERS` on current Chrome
- [ ] Does `opfs-sahpool` survive a full browser restart
- [ ] Are Workday's shadow roots open or closed, and does `chrome.dom` reach them
- [ ] Can the extension fetch loopback under Chrome 142's Local Network Access rules
