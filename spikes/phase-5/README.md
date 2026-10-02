# Phase 5 spikes: where the vault key can live

Dropping the passphrase means the key has to be stored somewhere, and the
extension has three contexts. The question was which of them can hold it.

## `run.cjs` — can the dedicated worker read `chrome.storage`?

The natural owner is the worker: it is where the key is *used*, and it is
already the only module allowed to touch persistence. The answer decides the
design, so it was measured before anything was written rather than after.

```
"chrome": "undefined", "storage": "no chrome", "local": "n/a"
"roundTrip": "threw: chrome is not defined"
```

**No.** `chrome` does not exist inside a dedicated worker at all. So whatever
owns the key at rest has to be a document, and the key has to travel to the
worker as an ordinary message payload.

Note what the harness does: Playwright cannot attach to an offscreen document,
so the same HTML is opened as an ordinary extension page. That is a real
limitation of the evidence — it establishes the behaviour of the *worker*,
which is what was asked, and says nothing about the document that spawns it.

## The one that was assumed instead of measured

The first design put the key store in the **offscreen document**, because it
owns the worker and outlives the service worker. Every open then failed with
`Cannot read properties of undefined (reading 'local')`.

An offscreen document is given `chrome.runtime` and **nothing else**. This is
documented Chrome behaviour and it was not checked, because after measuring
the worker it felt like the question had already been answered. The gate
caught it. The key store lives in the service worker now.

Two contexts ruled out by measurement, one of them the hard way.

## The readiness race — now `tests/e2e/offscreen-race.cjs`

`chrome.offscreen.createDocument` resolves before the document's scripts have
run, so a message sent in that window fails with "Receiving end does not
exist". The hazard predates this work; moving the vault open into the service
worker turned one absorbable message into a sequence that aborts.

The browser gate does **not** reliably catch a regression here: with the fix
removed, the gate failed once in three runs and passed twice. `race.cjs`
failed three times out of three, with two to three of its four panels erroring
each run. Anything that only fires one run in three is not a guard, so the
reproducer was promoted out of this folder into `tests/e2e/` and CI runs it
as its own step.

```
pnpm build && node tests/e2e/offscreen-race.cjs
```

Exits non-zero unless all four panels open. Do not add a wait before the
panels open. The likely reason the gate misses this is that something warms
the offscreen document before its panels open — likely, not measured. What
was measured is the one-in-three, and that is enough to know which to trust.
