# Round 24 — Stage E: responsive rules

Evidence: `prototype/index.html` renders every screen inside a real iframe viewport at
390 × 844, 834 × 1112 and 1440 × 900. What is shown is actual media-query behaviour from one
responsive file per screen — not three separate mockups.

**Verified:** all 11 prototype screens at all three viewports produce zero console errors
and **zero horizontal document overflow**.

---

## 1. Breakpoints

Two, and they are the two the app already uses.

| Range | Name | Shell | Content max-width | Gutter |
|---|---|---|---|---|
| `< 768px` | mobile | fixed bottom bar, no rail | 100% | 20px |
| `768–1199px` | tablet | 96px icon rail | 720px | 32px |
| `≥ 1200px` | desktop | 240px sidebar | 1120px | 40px |

The current shell uses `md` (768) and `xl` (1280) with `max-w-md / 2xl / 4xl` — a **448px**
content column on mobile that leaves a phone's edges unused, and a jump straight to 896px at
desktop. Round 24 lets the mobile column be the full width minus a real gutter, and adds a
usable intermediate at 720px.

One extra breakpoint exists for exactly one purpose: **`560px`**, below which the paired
gym-sized steppers (load + reps) stack instead of sitting side by side. At 390px two 56px
steppers with ±50px buttons leave 47px for the number, and "22.5" clips. The number is the
whole point of that control, so the pair stacks.

---

## 2. Mobile — `< 768px`

Mobile is the primary product-thinking viewport.

- **One main content column.** No two-up grids except the metric row.
- **Consistent edge padding** — 20px on every page, including inside cards.
- **Bottom navigation is fixed**, 64px tall, `env(safe-area-inset-bottom)` aware, with a
  blurred translucent white ground so content scrolling under it stays legible.
- **`main` reserves `64px + 28px`** at the bottom so the last card is never trapped under
  the bar.
- **Sticky primary action** in Active Workout: `Complete set` + `Skip`, above the safe
  area, with an upward shadow. The tab bar is **hidden** while it is present.
- **No horizontal scrolling of the document, ever.** Wide content — pill tab strips,
  charts, tables — scrolls inside its own `overflow-x: auto` container.
- **Cards stack** at the section gap (20px). Never nested more than one level.
- **Charts stay readable** — see §5.
- **Programme editing uses a sheet**, not a grid. The prescription editor is a
  bottom sheet on mobile and an inline panel from 768px up.
- **Tap targets ≥ 44px**, and 56px for the in-gym primaries.
- **Inputs are 16px** so iOS never zooms on focus. A zoom mid-set is a real usability
  failure in a gym, not a cosmetic one.
- **The third metric in a three-up row spans the full width** rather than leaving a hole
  in a two-column grid.

### Mobile layout per screen

| Screen | Composition |
|---|---|
| Today | header → week strip → training hero → 3 metrics (2 + 1) → rest of day → needs attention → done earlier |
| Training | header → next-action hero → week list → weekend → Extra → set-up links |
| Active Workout | sticky top bar (title + progress) → media → exercise → current-set card → rest → set history → exercise rail → **sticky action bar** |
| Progress | header → 3 metrics → range pills → weight chart → consistency chart → PBs → performance → recent |
| Calendar | header → month grid → legend → selected-day card → holidays |
| Achievements | header → featured → 3 metrics → milestone grid (2-up) → evidence |
| Settings | header → account → training links → foundation date → reminders → app → sign out |
| Library | header → search → filter pills → row list; detail on its own screen |
| Programme | header → day pills → day list → add → week summary |

---

## 3. Tablet — `768–1199px`

- **96px icon rail** on the left, icon over label. Every destination listed directly;
  "More" does not exist here.
- **720px content column**, centred in the remaining width. Wide enough for comfortable
  measure, narrow enough that a card is not a stretched banner.
- **Two-column composition only where content genuinely pairs** — the `.split2` grid used
  for state galleries, paired cards, and the Progress summary blocks. Never three columns.
- **Active Workout may place media and logging side by side in landscape**, using the same
  `.workout-split` grid the desktop uses. In portrait it stays stacked: an 834px portrait
  column split in two gives neither side enough room.
- **Calendar cells grow to 56px** and carry both the number and the marker comfortably.
- **No desktop density in portrait.** The rail is the only desktop-shaped thing that
  appears; page composition stays close to mobile's.
- Sticky bars start at `left: 96px` so they never sit under the rail.

---

## 4. Desktop — `≥ 1200px`

- **240px sidebar**, icon + label, selected state an `accent-soft` fill with a 3px
  `accent-edge` inset marker. Visually light — the page content is the focus.
- **1120px centred content container.** Cards do not stretch to the window.
- **Two- and three-column compositions where hierarchy benefits, and only there:**

| Screen | Desktop composition |
|---|---|
| Today | `1.5fr / 1fr` — schedule left, attention + done + weight rail right |
| Training | `1.5fr / 1fr` — week left, Extra + set-up right |
| Active Workout | `1fr / 1fr` — **media left, logging right**; the action bar becomes inline, not sticky |
| Progress | `1fr / 1fr` — charts left, bests + performance right |
| Calendar | `1.5fr / 1fr` — grid left, selected day + holidays right |
| Achievements | milestone grid at 4 columns |
| Settings | `1fr / 1fr` — account + training + foundation left, reminders + app right |
| Library | `1fr / 1fr` — list left, detail editor right |
| Programme | `1.5fr / 1fr` — day editor left, week-at-a-glance right |

- **Metric grids go three-up** with a 16px gap.
- **The sticky action bar de-stickies.** On desktop there is no thumb reach problem and no
  safe area; a fixed bar would just eat the viewport. It becomes an inline row inside the
  current-set card.
- **No full-width stretched mobile cards.** If a section has nothing to pair with, it stays
  at its natural width rather than spanning the container.

---

## 5. Charts

Charts are inline SVG with a fixed `viewBox`. An SVG scales its own type with the drawing,
so a chart allowed to grow without bound renders 19px axis labels on a tablet — larger than
the body copy around it.

**Rule for the implementation:** chart type is sized in device pixels, independently of the
plot width — which is what a real chart renderer does, because it measures its container.

The prototype approximates this by capping plot width at 520px and setting axis type at
9.5px in the `viewBox`, which keeps rendered labels between roughly 9px and 14px across all
three viewports. That cap is a prototype artefact, not part of the spec.

Other chart rules:

- light gridlines only, no chart junk
- the current value gets one dark callout bubble; nothing else is annotated
- a goal line is a dashed neutral rule with a direct label, never a coloured band
- one highlighted bar (the current period) in `accent-edge`; the rest in `surface-sunken`
- no legends where direct labels fit
- **no fake precision** — one decimal place for weight, whole numbers for reps and sets

---

## 6. Density and truncation

- Long exercise names truncate with an ellipsis in **rows**, and wrap in **headings**.
  A heading is the answer to "what am I doing"; it may take two lines.
- Badge groups wrap; badges themselves never wrap internally.
- The Active Workout top bar truncates both the session title and the progress line, so a
  long focus string can never push the intensity badge off screen.
- Tables are not the default anywhere. Where tabular data genuinely exists (recorded sets,
  weekday usage), it is a divided list of rows, which reflows.

---

## 7. Accessibility notes that are responsive in nature

- Focus rings are `2px solid ink` at `2px` offset — inverted to `ink-on-dark` on accent and
  ink fills, where a dark ring would vanish.
- Reduced motion collapses every transition and animation at every breakpoint.
- `forced-colors: active` gives cards, pills and buttons an explicit `CanvasText` border,
  because in that mode the fills that normally identify them are dropped. This degrades to
  legible rather than ambiguous precisely because every status also carries an icon and a
  word.
- The bottom bar's translucent ground uses `backdrop-filter`. Where that is unsupported the
  ground falls back to 90% opaque white, which is still legible over any page content.

---

## 8. Verification performed

A headless Chromium pass over all 11 prototype screens × 3 viewports asserted, per page:

1. no console errors and no uncaught page errors
2. `documentElement.scrollWidth − clientWidth ≤ 1` (no horizontal document overflow)

Both pass on every combination. Two failures found and fixed during the round:

- a `fieldset` in the Library editor kept its default `min-width: min-content` and pushed
  the page 45px sideways at 390px — the classic flex/grid shrink defect
- a `white-space: nowrap` spec label in the design-system page overflowed by 18px at 390px

Screenshots for all 33 combinations were produced from the same script.
