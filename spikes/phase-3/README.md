# Phase 3 spikes

One question, and the answer changed the shape of the phase.

```bash
cd spikes/phase-3
node run.cjs        # needs playwright from the repo root
```

The runner serves a company careers page and a board embed from disk through
Playwright's `context.route`, so the pages commit at real origins while nothing
is fetched:

```
parent   https://careers.acme.test/jobs/2272778   ← NOT on the match list
iframe   https://boards.greenhouse.io/embed/...   ← IS on the match list
```

The spike extension asks for **no permissions and no host permissions at all**.

## Results, Chromium, 26 September 2026

| Question | Answer |
|---|---|
| Does the content script reach a cross-origin iframe whose origin IS on the match list, inside a parent that is not? | **Yes**, with `all_frames: true` and zero permissions |
| Is the parent page injected? | **No** |
| Can the background reach the parent frame? | **No** — *"Could not establish connection"* |
| Can one frame be addressed by id without `webNavigation`? | **Yes**, via `sender.frameId` |
| Does the declarative flag cover a frame added AFTER load? | **Yes** |
| Does `match_about_blank` leak the parent's origin to us? | **No** |

## Three assumptions in the plan were wrong

`docs/04-phases.md` planned for Phase 3 to need:

> - Per-frame injection driven by `chrome.webNavigation`, because the
>   declarative flag only covers frames present at load
> - The broad host permission requested at runtime, on a user gesture
> - Fallback: offer to open the standalone ATS URL in a new tab

**None of the three is needed.**

**`chrome.webNavigation` is not needed.** A frame created after load, by the
script that runs when someone clicks Apply, *is* injected: the spike adds an
iframe two seconds after load and it announces itself like any other. Chrome
matches a frame when it navigates, not only at document start. The permission
would have bought nothing and cost the URL of every frame of every tab.

**No host permission is needed, at runtime or otherwise.** The iframe's own
origin is on the match list, and that is the entire basis for injecting into
it. The page that embeds it is irrelevant to the decision. Asking for
`*://*/*` on a user gesture would have been asking for reach we can prove we
do not need — and the gate's wording, *"without granting a permanent broad
permission"*, is satisfied more strongly by never asking for one.

**The standalone-URL fallback is not needed for Greenhouse.** It was planned
for the case where the parent's content script cannot reach the child. There is
no parent content script, and the child needs no reaching: it reports itself.

## The one thing that did need designing

Knowing *which* frame to talk to. `chrome.tabs.sendMessage(tabId, msg)` with no
`frameId` reaches every frame but resolves with whichever answers first, so a
broadcast cannot enumerate. The answer is to invert it: the background
broadcasts a roll call, and each frame replies by sending a *new* message back
to the background. A message travelling that direction carries
`sender.frameId`, which is the id needed to address it directly.

```
background ──"roll call"──▶ every frame        (reply discarded)
background ◀──"here I am"── each frame          (carries sender.frameId)
background ──describe/apply──▶ the chosen frame (addressed by id)
```

## What this does not answer

Ashby, which serves its embed from its own iframe and is therefore the same
shape, is untested here: it is not on the match list, so nothing would be
injected. Adding it is a registry change plus a probe, not a design change.

Workday is unaffected. Its problem is shadow DOM and a wizard, not frames.
