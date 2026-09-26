# The name

**Decided: `PageMyCV`.** Chosen on availability evidence, not taste. It was the
first instinct and it turned out to be the only candidate that survives a
collision check.

## What the search found

Checked on 26 September 2026: Chrome Web Store presence, product and trademark
collisions, npm, and DNS resolution for `.app`, `.dev` and `.com`.

| Name | Store | Product collision | npm | Domains | Verdict |
|---|---|---|---|---|---|
| **PageMyCV** | Nothing found | One small open-source Flask project, no company, no mark | **Free** | **All three free** | **Chosen** |
| Understudy | Competitor's own extension | **`understudy.live`, a Chrome extension that applies to jobs for you** | Taken | All taken | Eliminated |
| Carbon | Exact match exists | IBM Carbon Design System, Google's Carbon language, `carbon.now.sh`, Carbon Health, Carbon Black | Taken | All taken | Eliminated |
| Nibble | **Exact match exists** | Nibble, an AI negotiation platform with a real brand | Taken | `.app` and `.com` taken | Rejected |
| Clip | Namespace saturated | OpenAI's CLIP, Clip Studio Paint, Clipchamp | Taken | All taken | Eliminated |
| Stub | Nothing found | StubHub, plus "stub" means incomplete to developers | Taken | All taken | Weak |

**Understudy is the finding that mattered.** There is already a Chrome extension
called Understudy whose entire pitch is applying to jobs for you, including
Workday. Same name, same form factor, same category. Shipping under that name
would have been indistinguishable from a direct competitor.

**Nibble was my recommendation and it did not survive.** There is an existing
Chrome Web Store extension called exactly Nibble, and a company called Nibble
selling AI negotiation software. Neither is fatal on its own. Together they make
a name that has to be defended rather than used.

Six further candidates were checked and every one was taken on npm and on at
least two domains: `formwork`, `quire`, `longhand`, `mimeo`, `carbonless`,
`onionskin`.

## The honest downside

`PageMyCV` is descriptive, which means it is hard to trademark and it will never
be a distinctive mark. It also says "CV", which skews British and international,
while United States job postings say "resume". Both are real costs.

They are smaller than the cost of launching next to a same-category competitor
with the same name, and smaller than the cost of not owning the namespace.

## Before spending money on it

Three checks could not be completed from a sandboxed environment and are worth
ten minutes of yours:

- [ ] **Chrome Web Store search by hand.** Store search returns 403 through a
      proxy, so "nothing found" came from indexed search rather than the store.
- [ ] **Registrar check.** Domain status was inferred from DNS alone. A name that
      does not resolve is probably free but not provably so.
- [ ] **Trademark search** on USPTO for the final name, if you ever monetise.

## Renaming

Everything refers to the name in exactly two forms, `PageMyCV` and `pagemycv`.

```bash
OLD=PageMyCV NEW=Whatever
grep -rl "$OLD" --exclude-dir=.git . | xargs sed -i "s/$OLD/$NEW/g"
grep -rl "pagemycv" --exclude-dir=.git . | xargs sed -i "s/pagemycv/whatever/g"
```
