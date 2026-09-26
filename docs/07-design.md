# Design

## The constraint that decides everything

The entire interface is one narrow column, roughly 360 pixels wide, showing a
dense list of form fields and what happened to each one. Colour is not
decoration here. It is the primary carrier of meaning:

| State | What it means |
|---|---|
| **Filled** | Written automatically, high confidence |
| **Review** | Written, but the match was uncertain. Read it. |
| **Sensitive** | Not written. Waiting for you, one field at a time. |
| **Skipped** | Deliberately not written: honeypot, hidden, or no match |
| **Error** | Something failed |

Five states in a dense list. The brand colour must not collide with any of them.
That single requirement rules out more palettes than taste does.

---

## Palette: Radix Colors, not a hand-rolled one

**Decided after research. The earlier plan was a hand-rolled palette with hex
values copied from GitHub Primer, and that was the worst of both worlds:** the
maintenance cost of hand-rolling with none of Primer's guarantees.

[Radix Colors](https://www.radix-ui.com/colors) is built for exactly this
problem. Thirty scales of twelve steps, each step with a defined job, and every
scale ships a light and a dark version that swap from one class on the root.

| Step | Job |
|---|---|
| 1, 2 | App and subtle backgrounds |
| 3, 4, 5 | Component background: normal, hover, active |
| 6, 7, 8 | Borders |
| 9, 10 | Solid fill, and its hover |
| 11 | Low-contrast text |
| 12 | High-contrast text |

**Integration: CSS variables straight into Tailwind v4's `@theme`.** No plugin.
Tailwind v4 reads CSS custom properties natively, so the Radix stylesheet plus a
mapping block is the whole setup. The two live Tailwind plugins both work, but
they are moving parts that buy nothing here.

**Maintenance read, honestly.** `@radix-ui/colors` is at 3.0.0 from October 2023,
now owned by WorkOS, with small changes since. The scales are finished, not
abandoned, and hex values do not rot. Low risk for a palette.

## The state hues changed, and why

**The original plan used green for filled and amber for review. Research killed
that pairing.** For deuteranopia, the most common form of colour blindness,
green success indicators and amber warnings appear nearly identical. Those are
the two highest-frequency states in a scannable list. That is the exact failure
mode to design out.

**Blue and orange is the robust axis**, distinguishable across every common form
of colour vision deficiency.

It also turns out to be more honest semantically. Green and amber imply pass and
fail. But both states mean the same thing, "we typed this"; what differs is
confidence. Blue and orange read as a confidence axis rather than a verdict.

| State | Radix scale | Chip background | Border | Text | Glyph |
|---|---|---|---|---|---|
| **Filled** | `blue` | step 3 | step 6 | step 11 | `✓` |
| **Review** | `orange` | step 3 | step 6 | step 11 | `!` |
| **Sensitive** | `plum` | step 3 | step 6 | step 11 | `◆` |
| **Skipped** | `slate` | step 2 | step 6 | step 11 | `–` |
| **Error** | `red` | step 3 | step 6 | step 11 | `×` |

Two rules that come out of the research and are easy to get wrong:

- **Stagger lightness as well as hue.** Two states that differ only in hue at the
  same lightness are one deuteranope away from being the same state. Author in
  OKLCH so the lightness stagger is deliberate rather than accidental.
- **Never put white text on Radix step 9 for warm scales.** Amber, yellow, lime,
  mint and sky are designed for **black** foreground at steps 9 and 10. Our
  orange chips are in that family.

## Brand: monochrome

Once the five states have claimed blue, orange, plum, slate and red, and the
brand must avoid all of them plus the blue-to-violet arc that collides with plum
under tritanopia, there is almost nothing left. That is not a problem, it is the
answer.

**The brand is neutral.** Radix `slate` step 12 in each theme, which is near
black in light and near white in dark. Primary buttons are solid neutral, the
focus ring is neutral. All the chroma in the product belongs to state.

This is what Linear and Vercel do, and for the same reason: when colour carries
status, spending it on branding makes the status harder to read.

## Contrast: verify it, do not assume it

**Radix targets APCA. You will be audited against WCAG 2.2, which is a different
algorithm.** Steps 11 and 12 are a good starting point, not a passing grade.

**A CI test asserts at least 4.5:1 for all five state text and background pairs,
in both themes.** That test is worth more than any palette choice.

On standards, so this does not get relitigated:

- **WCAG 2.2 changed no contrast numbers.** 4.5:1 for text, 3:1 for large text
  and non-text, all carried forward.
- **APCA and WCAG 3 are not a compliance target.** WCAG 3 is still a working
  draft, its contrast algorithm is marked undetermined, and Recommendation is
  years away.

**Two WCAG 2.2 criteria that bite a dense panel harder than colour does:**

| | |
|---|---|
| **2.5.8 Target Size, AA** | Every interactive target at least 24 by 24 CSS pixels. In a dense per-field list this is the likely real compliance gap. |
| **2.4.11 Focus Not Obscured, AA** | A focused row must not be hidden behind a sticky header or action bar. |

## A colour-vision theme

Ship one, the way Primer does. It is about thirty lines of token override and it
is the highest-leverage accessibility feature available here.

The override drops plum and red, restates all five states on the blue and orange
axis alone, and widens the lightness stagger. The glyphs carry the rest.

---

## Typography

**No web fonts.** Not a style preference: a web font is a network request, and
invariant 5 says the extension makes none except to Byte. The system stack also
matches whatever the operating system already looks like, which is the right
instinct for a browser panel.

```css
--font-ui: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto,
           Helvetica, Arial, sans-serif;
--font-mono: ui-monospace, SFMono-Regular, "SF Mono", Menlo, Consolas,
             "Liberation Mono", monospace;
```

### Scale

| Token | Size | Line height | Use |
|---|---|---|---|
| `xs` | 11px | 16px | Metadata, timestamps, selectors |
| `sm` | 12px | 18px | Field labels, chips |
| `base` | 13px | 20px | Body. Deliberately small: this is a panel, not a page. |
| `md` | 15px | 22px | Field values, the text you actually read |
| `lg` | 18px | 24px | Section headings |
| `xl` | 22px | 28px | The one heading per screen |

Mono is used for exactly three things: field selectors, the question fingerprint,
and anything copied from the page. Never for prose.

Three weights only: 400, 500 for labels, 700 for the single heading.

---

## Components

### Field row

The atom of the whole interface. One per detected form field.

```
┌───────────────────────────────────────────┐
│ ✓ First name                    autofill  │   glyph in the state colour
│   Elvis                                   │   value, md
│   #first_name                             │   selector, mono xs, muted
└───────────────────────────────────────────┘
```

**The glyph carries as much as the colour.** In a 360 pixel list, shape does more
work than hue, and roughly one man in twelve cannot rely on hue at all. Each
state has a glyph, a colour and a text label. Never fewer than two of the three.

| State | Glyph | Label |
|---|---|---|
| Filled | `✓` | `autofill` |
| Review | `!` | `check this` |
| Sensitive | `◆` | `needs you` |
| Skipped | `–` | `skipped` |
| Error | `×` | `failed` |

The whole row is the target, which also satisfies the 24 pixel minimum without
special effort.

### Sensitive confirmation

Never a list. One field, one screen, and the reason stated before the value.

```
┌───────────────────────────────────────────┐
│ ◆ Work authorization expiry               │
│                                           │
│ This form is asking when your permit      │
│ ends. A valid authorization and a visible │
│ expiry date read very differently. When   │
│ and whether to say it is your call.       │
│                                           │
│ Stored value    ••••••••                  │
│                                           │
│ [ Skip ]              [ Reveal and fill ] │
└───────────────────────────────────────────┘
```

Skip is on the left and holds the default focus. The arrangement is inverted
deliberately: not answering is a protected choice.

### Lock screen

The first thing you see. Passphrase, nothing else. No "remember me", because the
key is never persisted anywhere, by design.

### Fill summary

After a fill: counts per state, then the list. The counts are the audit. If
`skipped` shows zero honeypots on a Workday form, the denylist has broken and you
want to see that immediately.

---

## Icon

At 16 pixels there is room for one shape and nothing else.

- **A caret in a field.** A rounded rectangle with a text cursor. Says exactly
  what the product does and matches the name.
- **A page with a caret.** Ties to the "page" in PageMyCV.
- **A single bracket** with a caret inside, terminal-flavoured, pairs with the
  monochrome brand.

---

## Motion

Almost none. A panel that animates is a panel that feels slow on the second use.

- State changes: 120ms opacity, no movement
- The fill pass: fields resolve top to bottom with a 40ms stagger, once, so you
  can see the order it worked in
- Everything respects `prefers-reduced-motion`
- No spinners. A Byte call in flight shows a muted pulse on the glyph, in place.

---

## Accessibility floor

- 4.5:1 on all text, asserted in CI, not assumed from the palette
- 24 by 24 pixel minimum on every target, per WCAG 2.2 criterion 2.5.8
- State is never colour alone. Glyph, colour and label.
- A colour-vision theme that drops to the blue and orange axis
- Full keyboard path: `Tab` through fields, `Enter` to confirm, `Esc` to skip
- Focus ring in the neutral brand, 2px, never removed, never obscured
- The confirmation dialog traps focus and returns it on close
