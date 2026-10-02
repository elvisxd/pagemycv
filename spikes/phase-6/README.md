# Phase 6 spikes: filling on a site nobody has named

The content script is declared for a fixed list of boards. On any other
site, the only way to get it there without a permission over the whole web
is to inject it into the active tab at the moment the person asks — which
Chrome allows under `activeTab`, granted by a click on the extension's icon
and gone on navigation. The design question was not whether that works (it
is Chrome's documented behaviour) but whether the **browser gate can drive
it**: a mechanism CI cannot exercise is one CI cannot protect.

## `run.cjs` — which on-demand route can a headless gate drive?

Four routes, each tried from the service worker of a spike extension
holding `activeTab` + `scripting` and an `optional_host_permissions`
entry, against a page on an origin the manifest does not name.

| Route | Result |
|---|---|
| `scripting.executeScript` with no gesture | refused: *"Cannot access contents of the page"* |
| `permissions.request` from the worker | refused: *"must be called during a user gesture"* |
| A registered keyboard command, keys sent by Playwright | the command handler never fired |
| `_execute_action` by keyboard | the action click never fired |
| Playwright's `context.grantPermissions` for the origin | no effect on the extension; injection still refused |

**None.** Playwright's keystrokes reach the page, not the browser-level
command handler; the icon cannot be clicked; and the two permission APIs
both require a gesture Chrome will only accept from a person.

## `run2.cjs` — can a profile-level grant stand in for the click?

Chrome records an extension's granted optional permissions in the profile's
`Preferences` file. If writing an origin there before launch counted, the
gate could grant the way a person's "Allow" does.

```
containsAfterPrefsGrant: false
injectTopOnly_allFrames:  "Cannot access contents of the page"
injectBoth_allFrames:     "Cannot access contents of the page"
```

**It does not count.** Chrome does not honour a grant it did not record
itself. (`permissions.remove` works, so an extension can give a grant back;
it just cannot give itself one.)

## What this decided

- The injection is one call in one module, `src/fill/inject.ts`, and the
  guard refuses `chrome.scripting` anywhere else. It is the one line in the
  fill path CI cannot exercise, and it is said so in the file.
- Everything around it is tested: the decision to inject lives in
  `src/fill/on-demand.ts` with fakes; the classifier on a form with no
  recognisable field names runs in both the unit tests and the gate; and the
  gate reaches Chrome's refusal itself — on the page with no content script,
  the background tries to inject, Chrome says no, and that *real* refusal is
  what becomes the "click the icon" message.
- `activeTab` over `optional_host_permissions`: no prompt, no stored grant,
  nothing to revoke, and the extension holds no list of sites it was ever
  allowed into.

Both harnesses clean up their profiles. `results.json` and `results-2.json`
are the raw output.
