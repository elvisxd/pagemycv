# Phase 4 spikes

```bash
cd spikes/phase-4
node run.cjs        # needs playwright from the repo root
```

## The question had to be turned around first

`docs/04-phases.md` has carried one open question since Phase 0:

> **Are Workday's shadow roots open or closed?** Not runnable without a real
> application page.

That is true, and it is why the question sat unanswered through three phases.
A Workday apply flow lives behind a mandatory account, and this container
cannot reach `*.myworkdayjobs.com` at all — the egress policy refuses the
CONNECT, as it does for Lever and Greenhouse, which is why every phase so far
has been built against fixtures served at real origins.

So the spike asks the other question, the one that is runnable:

> **Does it matter?** `chrome.dom.openOrClosedShadowRoot` is *claimed* to
> handle either kind. If the claim holds, open-vs-closed is retired rather
> than answered.

A closed root is a closed root whoever attached it. The fixture attaches its
own, and `rootsReallyClosed` confirms the page itself sees `null` where we see
a root — so nothing below can be a pass against an open root by accident.

## Results, Chromium, 27 September 2026

### Verified about the browser

These hold wherever the page came from.

| Question | Answer |
|---|---|
| Does `chrome.dom.openOrClosedShadowRoot` exist, with zero permissions? | **Yes**, a function |
| Does it pierce a **closed** root the page itself cannot see? | **Yes** — `pageVisible: false, weCanSee: true` |
| Does it pierce a closed root **nested inside** a closed root? | **Yes**, `deeplyNested` found at depth 2 |
| What does a flat query see? | **Nothing.** `flat: 0` against `deep: 4` |
| Can we write a value in there, and does an in-root listener hear it? | **Yes** — `firstName=Ada` |
| Does `checkVisibility()` work across the boundary? | **Yes** |
| Does `document.getElementById(id)` find a control inside a root? | **No** |
| Does `document.querySelector('label[for=…]')` find its label? | **No** |
| Does `getRootNode().querySelector` / `.labels`? | **Yes**, both give *"First Name"* |
| Does `closest('form')` cross the boundary? | **No** |
| Is an iframe **inside** a closed shadow root injected into? | **Yes** — frameId 3 answered |

**The open-versus-closed question is retired.** The API pierces both, so the
adapter never needs to know which it is looking at, and Phase 4 can be planned
without a real application page. What a real page is still needed for is the
phase's own gate, which is a different thing and stays open.

### Three findings that are bugs in code already merged

Each breaks silently — the field is simply never found, or is filled without
anything noticing.

1. **A bubbling event does not leave a shadow root.** `write.ts` dispatches
   `new Event('input', { bubbles: true })`. Inside a root that reaches the
   in-root listener but **never reaches the document**: `heardAtDocument:
   "(nothing)"`. With `composed: true` it arrives, retargeted at the host:
   `"my-information;"`. A framework listening at document level would see a
   field that was never filled.

2. **`descriptor.ts` resolves labels through `document`.** Both paths it uses
   return nothing inside a root. Labels have to be resolved in the node's own
   `getRootNode()`, or through `.labels`.

3. **`closest()` stops at the boundary**, so the wrapper and group walks end
   early and a control inside a root looks like it has no form around it.

### Modelled on documented behaviour, not verified

The overlay and the listbox are built here from the descriptions in
`09-ats.md`. These results say our handling works against that description.
They do **not** say Workday behaves that way.

| Modelled behaviour | Result |
|---|---|
| A real click on a covered button | **times out** — the overlay owns the pixel |
| A dispatched `MouseEvent` on the same button | **lands** |
| Options queried in the same task as the open | **3** |
| Options queried one task later | **0** |

## A correction to `docs/02-architecture.md`

The architecture table says:

> | Frames inside a shadow root | **Unreachable.** Not exposed by Chromium by design. Rare. Fall back to opening the ATS URL directly. |

**That is wrong as stated.** The frame is not *enumerable* — it does not appear
in a frame listing — but it is injected into like any other frame, and it
announces itself with its own `frameId`. Phase 3 already builds its roster from
those announcements rather than from enumeration, so the fallback that row asks
for is dead code that was never needed.

## Closing the gap: capture-from-a-real-tenant.js

The part of Phase 4 that is a hypothesis is small and precisely bounded: the
`data-automation-id` map and the dropdown selectors in `src/ats/registry.ts`.
Everything else was measured. `capture-from-a-real-tenant.js` is a console
snippet that collects exactly what would settle it, and nothing else.

```
1. Open a real application on any {tenant}.wd{n}.myworkdayjobs.com
2. Get as far as the "My Information" step (the account is yours to make;
   the extension never creates one)
3. DevTools console, paste the file, press enter — it copies its own output
4. Optionally:  await pagemycv.probeDropdown("formField-countryRegion")
```

**It reads and does not write.** `report()` only queries the DOM.
`probeDropdown()` is separate and opt-in because it clicks a menu open, and
that is somebody's real application.

**It never collects a field value.** Not filtered out afterwards — never
read in the first place, which is a different and checkable promise: there
is no `.value` access anywhere in the file. Attribute names, tag names,
roles, label text and counts only, so the output is safe to paste back.

### What each part of the output settles

| Output | What it decides |
|---|---|
| `automationIds` | Whether the map in `registry.ts` names the right things, and what it is missing |
| `dropdowns[].trigger` | Whether `button[aria-haspopup="listbox"], [role="combobox"]` is the real trigger |
| `probeDropdown(...)` counts | Whether the menu really is gone by the next task. Two different numbers means the synchronous open-and-pick is required; two equal numbers means it was modelled on something that is not true, and `write.ts` can be simpler |
| `optionsRenderedInsideTheField` | Whether the menu is a descendant of the field or portalled to `<body>`. `selectFromListbox` already handles both; this says which one is real |
| `customElementsWeCannotSeeInto` | Non-zero means the fields are behind closed roots — the case the extension handles and the console cannot. Confirms the pierce is load-bearing on a real page |
| `progressList` | The only input the wizard step-count work needs, and the reason it is not built |

Only data should need to change afterwards. That separation is the whole
reason the selectors live on the ATS definition rather than in `write.ts`.

## What this spike does not answer

- Whether Workday's roots are in fact closed. Retired, not answered.
- Whether the real `data-automation-id` values match `09-ats.md`.
- Whether the real overlay and listbox behave like the models above.
- Phase 4's own gate: a complete application across every wizard step. That
  needs a real account on a real tenant, and account creation is manual by
  design — the extension never creates one.
