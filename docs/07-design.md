# Design

## The constraint that decides everything

The entire interface is one narrow column, roughly 360 pixels wide, showing a
list of form fields and what happened to each one. Colour is not decoration
here. It is the primary carrier of meaning:

| State | What it means |
|---|---|
| **Filled** | Written automatically, high confidence |
| **Review** | Written, but the match was uncertain. Read it. |
| **Sensitive** | Not written. Waiting for you, one field at a time. |
| **Skipped** | Deliberately not written: honeypot, hidden, or no match |
| **Error** | Something failed |

Five states in a dense list. **The brand colour must not collide with any of
them**, or the list stops being scannable. That single requirement rules out
more palettes than taste does.

---

## Palette, three directions

### A. Ink and indigo ★ recommended

Brand sits in the blue-violet range, far from green, amber and grey. Every state
colour stays available and unambiguous.

**Dark, the default**

| Token | Hex | Use |
|---|---|---|
| `bg` | `#0E1116` | Panel background |
| `surface` | `#161B22` | Cards, rows |
| `surface-2` | `#1C232C` | Hover, selected |
| `border` | `#30363D` | Hairlines |
| `text` | `#E6EDF3` | Primary |
| `text-muted` | `#8B949E` | Labels, metadata |
| `brand` | `#7C8CFF` | Primary action, focus ring |
| `brand-strong` | `#5B6BE8` | Pressed |
| `filled` | `#3FB950` | Filled state |
| `review` | `#E8A33D` | Review state |
| `sensitive` | `#BC8CFF` | Sensitive state |
| `skipped` | `#6E7681` | Skipped state |
| `error` | `#F85149` | Error state |

**Light**

| Token | Hex |
|---|---|
| `bg` | `#FFFFFF` |
| `surface` | `#F6F8FA` |
| `surface-2` | `#EFF2F5` |
| `border` | `#D0D7DE` |
| `text` | `#1F2328` |
| `text-muted` | `#59636E` |
| `brand` | `#4F46E5` |
| `brand-strong` | `#4338CA` |
| `filled` | `#1A7F37` |
| `review` | `#9A6700` |
| `sensitive` | `#8250DF` |
| `skipped` | `#6E7681` |
| `error` | `#CF222E` |

Every foreground value above clears 4.5:1 against its own background.

### B. Byte family, amber

Reuses `#E8A33D` on `#0E1116` from your banner and portfolio, so the two
projects read as siblings at a glance.

**The honest cost.** Amber is already the best colour for the review state, and
that state appears far more often than any brand element. You would have to move
review to orange `#DB6D28`, which sits uncomfortably close to error red in a
dense list, or to a desaturated yellow that loses urgency. You trade the clarity
of the most common state for portfolio consistency.

Worth it only if the sibling story matters more to you than the interface does.

### C. Monochrome, colour reserved for state

No brand hue at all. Greys and one near-white. The only chroma in the entire
product is the five state colours.

The most sophisticated option and the best fit for what this interface actually
is: a list where colour means status and nothing else. Brand is expressed
through typography, spacing and the icon, which is how developer tools usually
do it. Weakest as a marketing surface, strongest as a tool.

---

## Typography

**No web fonts.** Not a style preference: a web font is a network request, and
invariant 5 says the extension makes none except to Byte. Self-hosting would
solve it but adds weight to a panel that should open instantly. The system stack
also matches whatever the user's operating system already looks like, which is
the correct instinct for a browser panel.

```css
--font-ui: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto,
           Helvetica, Arial, sans-serif;
--font-mono: ui-monospace, SFMono-Regular, "SF Mono", Menlo, Consolas,
             "Liberation Mono", monospace;
```

**If you want a typeface with a voice**, the one defensible choice is bundling
Inter as a local `woff2`, about 30 KB subsetted to Latin. It is the only web
font worth the weight here. Decide once, in `DECISIONS.md`.

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

### Weight

Three weights only: 400 regular, 500 medium for labels, 700 bold for the single
heading. A fourth weight is how a small interface starts looking busy.

---

## Components

### Field row

The atom of the whole interface. One per detected form field.

```
┌───────────────────────────────────────────┐
│ ● First name                    autofill  │   ● state dot, 6px
│   Elvis                                   │   value, md
│   #first_name                             │   selector, mono xs, muted
└───────────────────────────────────────────┘
```

The state dot carries the colour. **It is never the only carrier**: each state
also has a distinct label on the right, because roughly one man in twelve cannot
distinguish red from green and a status list that fails for them fails.

| State | Dot | Label |
|---|---|---|
| Filled | `filled` | `autofill` |
| Review | `review` | `check this` |
| Sensitive | `sensitive` | `needs you` |
| Skipped | `skipped` | `skipped` |
| Error | `error` | `failed` |

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

Skip is on the left and is the default focus. The destructive-by-default
arrangement is inverted here deliberately: not answering is a protected choice.

### Lock screen

The first thing you see. Passphrase, nothing else. No "remember me", because the
key is never persisted.

### Fill summary

After a fill: counts per state, then the list. The counts are the audit. If
`skipped` shows zero honeypots on a Workday form, something is wrong with the
denylist and you want to see that immediately.

---

## Icon

The extension icon appears at 16, 32, 48 and 128 pixels. At 16 pixels there is
room for one shape and nothing else.

Three directions, matching the palette options:

- **A geometric nibble.** A filled square with one corner bitten out. Literal for
  the name, works at 16 pixels, and reads as a data shape rather than a mouth.
- **A cursor in a field.** A rounded rectangle with a text caret. Says exactly
  what the product does. Risks looking like every form builder.
- **A single bracket.** `[ ]` with a caret inside. Terminal-flavoured, pairs with
  option C's monochrome direction.

---

## Motion

Almost none. A panel that animates is a panel that feels slow on the second use.

- State changes: 120ms opacity, no movement
- The fill pass: fields resolve top to bottom with a 40ms stagger, once, so you
  can see the order it worked in
- Everything respects `prefers-reduced-motion`

No spinners. When a Byte call is in flight, the row shows a muted pulse on the
dot, in place.

---

## Accessibility floor

Not optional, and small enough to just do:

- 4.5:1 contrast on all text, which every value above already clears
- State is never colour alone. Dot plus label, always.
- Full keyboard path: `Tab` through fields, `Enter` to confirm, `Esc` to skip
- Focus ring in `brand`, 2px, always visible, never removed
- The confirmation dialog traps focus and returns it on close
