# Round 24 — Stage B: the visual system

The locked token layer is `tokens/vshape-light.css`. It is written to mirror
`src/design/tokens.css` so adoption is a swap, not a rewrite. This document says what the
values mean and when each is allowed.

Live specimen: `prototype/system.html`.

---

## 1. The one decision everything follows from

The current app is a **dark navy system** — `--color-navy: #0b1220`, `color-scheme: dark`,
an ambient radial glow behind every page, electric blue as the primary action colour. It
reads as an instrument panel.

Round 24 inverts the ground and demotes blue:

| | Before | After |
|---|---|---|
| Ground | `#0B1220` navy | `#F5F6F2` warm off-white |
| Card | `#121A2B` raised navy | `#FFFFFF` pure white |
| Primary text | `#F7F9FC` on dark | `#171A15` on light |
| Primary action | `#2F6BFF` electric blue | `#CDF564` lime, with ink text |
| Separation | glow + shadow on dark | canvas → surface luminance step + a whisper of shadow |
| Blue's job | primary | informational only |

Separation now comes from the **luminance step between canvas and surface**, not from glow.
That is why `body::before` is deleted rather than recoloured: a light theme that keeps an
ambient gradient looks smudged, not premium.

---

## 2. Colour

### Neutrals
| Token | Value | Job |
|---|---|---|
| `--vs-canvas` | `#F5F6F2` | app background. Warm, never grey-blue |
| `--vs-surface` | `#FFFFFF` | every card and hero |
| `--vs-surface-soft` | `#F0F2EA` | chip ground, inset panel, skeleton base |
| `--vs-surface-sunken` | `#E7EADE` | progress track, unfilled bar |
| `--vs-scrim` | `rgb(23 26 21 / .44)` | sheet and dialog overlay |

### Ink ramp — and the surfaces each level is licensed for

| Token | Value | On white | On canvas | Licensed for |
|---|---|---|---|---|
| `--vs-ink` | `#171A15` | 16.3:1 | 15.6:1 | anything |
| `--vs-ink-2` | `#4E5348` | 7.8:1 | 7.2:1 | anything |
| `--vs-ink-3` | `#6E7468` | 4.8:1 | **4.4:1** | small text **on white only**; on canvas, large text (≥18.66px bold / ≥24px) only |
| `--vs-ink-4` | `#8B9184` | 3.2:1 | 3.0:1 | placeholders, disabled labels, decorative marks. **Never load-bearing copy** |

`ink-3` on canvas is the one trap in the palette: it is 4.4:1, just under AA for body text.
Supporting copy that sits directly on the canvas uses `ink-2`.

### Lines

| Token | Value | Contrast on white | Rule |
|---|---|---|---|
| `--vs-line` | `#E4E7DE` | 1.6:1 | decorative hairline. Legitimate **only** where the surface/canvas step already separates the block |
| `--vs-line-strong` | `#D0D5C6` | 2.3:1 | dense list separation |
| `--vs-line-control` | `#8B9184` | 3.2:1 | **mandatory** on any input, checkbox, radio, toggle or focusable control boundary (WCAG 1.4.11) |

A card border at 1.6:1 is deliberate and permitted: the white-on-canvas step plus the
shadow already identify the card, so its border is decoration. A *text field* border is
not decoration — it is the only thing that says "type here" — so it gets 3.2:1.

### Accent

Lime is a **fill**, never small text.

| Token | Value | Job |
|---|---|---|
| `--vs-accent` | `#CDF564` | primary fill. Ink on it = **14.3:1** |
| `--vs-accent-press` | `#C0EA50` | `:active` |
| `--vs-accent-edge` | `#74961F` | 3.4:1 on white — the boundary of an accent fill, and the progress-rail fill |
| `--vs-accent-ink` | `#4E6B12` | 6.0:1 on white — accent **as text** |
| `--vs-accent-soft` | `#EAFBC4` | tint ground for accent chips and the hero wash |

An accent-filled button on white has almost no boundary contrast on its own (1.25:1), which
is why `--vs-accent-edge` is a required 1px border on every accent fill, not an option.

### Semantic, session intensity, day resolution

Three families, each with an `-ink` (≥4.5:1 on white, for text and meaningful icons), a
`-soft` (tint ground) and, where a non-text mark is needed, a `-mark` (≥3:1).

- **Semantic:** success `#1F7A46` · warn `#8A5A00` · danger `#B3261E` · info `#1D5FBF`
- **Session intensity (locked semantics, retuned for a light ground):**
  HARD `#C2453A` · LIGHT `#0E6E7B` · PUMP `#6A45C7`
- **Day resolution:** Scheduled `#4E5348` · Recovery `#0E6E7B` · Extra `#4E6B12` ·
  Holiday `#6A45C7`

**On the hue overlap between the two axes.** LIGHT and Recovery share a teal; PUMP and
Holiday share a purple. This is deliberate and it is safe, for one reason and one reason
only: **session intensity and day resolution never appear in the same legend, and every
badge on both axes carries an icon *and* a word.** No status in this system is ever
communicated by colour alone, so a shared hue across two unrelated axes cannot create an
ambiguity. If a future screen ever puts the two axes side by side in one legend, the
overlap must be broken before that screen ships.

The current dark theme already assigns the *same literal value* `#9b6cff` to both
`--color-pump` and `--color-holiday`; Round 24 keeps the shared family and adds the
icon-plus-word rule that makes it defensible.

---

## 3. Typography

**No font change.** `Outfit Variable` is already a dependency, and its geometric forms suit
the direction. Changing it would be cost without benefit.

| Role | Spec | Notes |
|---|---|---|
| display | 700 · 44/1.02 · `-0.02em` | hero metric. Tabular |
| h1 | 700 · 28/1.14 → 32 at ≥768 | page title |
| h2 | 700 · 19/1.26 | section title |
| h3 | 650 · 16/1.3 | card title |
| body | 450 · 15/1.5 | default |
| body-strong | 600 · 15/1.5 | emphasised body |
| body-sm | 450 · 13.5/1.46 | supporting copy |
| label | 600 · 12/1.2 | field label |
| eyebrow | 700 · 11 · `0.09em` uppercase | **the only licensed uppercase** |

`font-variant-numeric: tabular-nums` is set on `body`, not per component. Every number in
this app can be compared vertically — loads, reps, weights, dates, counts — and proportional
figures make a column of them jitter.

The current app uses `font-extrabold` (800) widely. Round 24 tops out at 700 for headings
and 650 for card titles: on a light ground 800 reads as shouting.

---

## 4. Shape

| Token | Value | Job |
|---|---|---|
| `--vs-r-xs` | 8px | micro chip, tag |
| `--vs-r-sm` | 12px | input, small control |
| `--vs-r-md` | 16px | button, list row, media thumb |
| `--vs-r-lg` | 22px | card |
| `--vs-r-xl` | 28px | hero card, bottom sheet |
| `--vs-r-pill` | 999px | pill, segmented control, avatar, progress rail |

Six steps, each with a stated job. Nothing gets an arbitrary radius.

---

## 5. Elevation

| Token | Job |
|---|---|
| `--vs-shadow-card` | every card and hero. `0 1px 2px /.04, 0 10px 24px -18px /.16` |
| `--vs-shadow-raised` | sheet, dialog, popover |
| `--vs-shadow-sticky` | upward shadow under a sticky bottom bar |
| none | quiet / dashed blocks that must read as secondary |

The dark theme's `shadow-card` carries an inset white hairline
(`0 1px 0 0 rgb(255 255 255 / 0.03) inset`). That highlight is meaningless on white and is
deleted rather than ported — one of only three tokens with no honest light equivalent
(the others being `body::before` and `color-scheme: dark`).

---

## 6. Spacing rhythm

4px base. Screens differ in **gutter** and **section gap** only — never in the internal
rhythm of a card.

| Token | Mobile | Tablet | Desktop |
|---|---|---|---|
| page gutter | 20px | 32px | 40px |
| section gap | 20px | 24px | 24px |
| card padding | 20px | 24px | 24px |
| hero padding | 24px | 28px | 28px |
| row gap inside a list card | 10px | 10px | 10px |

Two interaction sizes, not one:

| Token | Value | Rule |
|---|---|---|
| `--vs-tap-min` | **44px** | the floor. Nothing tappable is smaller, anywhere |
| `--vs-tap-gym` | **56px** | in-gym primaries: Complete set, the load and rep steppers, Start workout |

The current `WorkoutSetList` inputs are `py-1.5` — roughly 30px tall — inside a wrapping
flex row. That is the single worst ergonomics defect in the app and `--vs-tap-gym` exists
to fix it.

---

## 7. Motion

Values mirror `src/design/motion.ts` exactly, so there stays one source in two syntaxes.

| Token | Value | Used by |
|---|---|---|
| instant | 100ms | press feedback |
| fast | 180ms | colour and border transitions |
| base | 280ms | page entrance, card expansion |
| slow | 420ms | sheet |
| `--vs-ease-out` | `cubic-bezier(.16,1,.3,1)` | entrances |
| `--vs-ease-soft` | `cubic-bezier(.45,0,.2,1)` | exits |

Motion is licensed for exactly five things: card expansion, progress completion, tab/filter
change, active-workout transitions, and a success state. Everything else is still.
`prefers-reduced-motion` collapses all of it, as it already does.

---

## 8. Adoption plan

**Phase 1 — compatibility shim (one commit).** `tokens/vshape-light.css` §8 re-points every
token name the codebase already uses to a light value. Every existing `bg-surface`,
`text-ink-dim`, `border-edge` keeps working; the app becomes light without editing a single
`className`. Three things cannot be shimmed and must be edited in code:

- the inset white hairline in `--shadow-card` → delete
- `body::before` ambient gradient → delete
- `color-scheme: dark` → `light`, and `<meta name="theme-color">` in `index.html`

**Phase 2 — rename (mechanical).** `navy → canvas`, `offwhite → ink` (an inverted role, so
this one must be done carefully), `ink-dim → ink-2`, `ink-faint → ink-3`, `edge → line`,
`edge-strong → line-strong`, `blue → info-ink`, `lime → accent`, `coral → danger-ink`.
Codemod-able, zero behavioural risk, and it can happen after the theme is already light.

**Phase 3 — components.** The inventory in `06_COMPONENT_INVENTORY.md`.

Splitting the flip from the rename means the visual change can be reviewed on its own,
without a thousand-line diff of renamed classes underneath it.

---

## 9. Contrast summary

Every value in the palette was checked, and the ones that fail somewhere are documented
rather than quietly used:

| Pair | Ratio | Verdict |
|---|---|---|
| ink on surface | 16.3:1 | AAA |
| ink on canvas | 15.6:1 | AAA |
| ink-2 on surface | 7.8:1 | AAA |
| ink-3 on surface | 4.8:1 | AA |
| **ink-3 on canvas** | **4.4:1** | **AA-large only — documented, and ink-2 is used instead** |
| ink-4 on surface | 3.2:1 | non-text / large only, by rule |
| ink on accent | 14.3:1 | AAA |
| accent-ink on surface | 6.0:1 | AA |
| accent-ink on accent-soft | 5.5:1 | AA |
| accent-edge on surface | 3.4:1 | AA for a control boundary (1.4.11) |
| line-control on surface | 3.2:1 | AA for a control boundary (1.4.11) |
| line on surface | 1.6:1 | decorative only, by rule |
| success/warn/danger/info -ink on surface | 5.3 / 5.9 / 6.5 / 6.1 | AA |
| HARD / LIGHT / PUMP -ink on surface | 5.0 / 6.0 / 6.4 | AA |
