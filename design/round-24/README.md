# Round 24 — UI/UX Redesign Blueprint + Fresh Reset Plan v1

Blueprint and design evidence for the VSHAPE100 v2 redesign.
**Nothing in this directory is imported, built, served or deployed by the application.**

Baseline `7213f3b15fc0af6597e0ee236802357e16985084` · checkpoint
`checkpoint/pre-round24-redesign` · application source unchanged.

---

## Read order

1. **[`00_ROUND24_SUMMARY.md`](00_ROUND24_SUMMARY.md)** — start here. The round in one page.
2. [`01_UX_AUDIT.md`](01_UX_AUDIT.md) — Stage A: what is wrong, with citations
3. [`02_DESIGN_SYSTEM.md`](02_DESIGN_SYSTEM.md) — Stage B: the visual system
4. [`03_NAVIGATION_IA.md`](03_NAVIGATION_IA.md) — Stage B: the navigation decision
5. [`04_SCREEN_BLUEPRINTS.md`](04_SCREEN_BLUEPRINTS.md) — Stages C & D: ten screens
6. [`05_RESPONSIVE_RULES.md`](05_RESPONSIVE_RULES.md) — Stage E: mobile / tablet / desktop
7. [`06_COMPONENT_INVENTORY.md`](06_COMPONENT_INVENTORY.md) — components, with a build order
8. [`07_STATE_AND_ACCESSIBILITY.md`](07_STATE_AND_ACCESSIBILITY.md) — states and a11y
9. [`08_DATA_API_IMPACT_MATRIX.md`](08_DATA_API_IMPACT_MATRIX.md) — Stage F: data / API impact
10. [`09_FRESH_RESET_PLAN.md`](09_FRESH_RESET_PLAN.md) — Stage G: the reset contract
11. [`10_DEFERRED_AND_APPROVALS.md`](10_DEFERRED_AND_APPROVALS.md) — what needs a decision

---

## Viewing the prototype

No build step. Open it straight from disk:

```sh
open design/round-24/prototype/index.html          # macOS
xdg-open design/round-24/prototype/index.html      # Linux
```

Or serve it, which is nicer for the iframe gallery:

```sh
npx http-server design/round-24/prototype -p 4173 -o
```

`index.html` is the **responsive evidence gallery**: pick a screen, pick a viewport
(390 × 844 · 834 × 1112 · 1440 × 900 · all three), and it renders inside a real iframe — so
what you see is actual media-query behaviour, not three separate drawings.

### Screens

| File | |
|---|---|
| `today.html` | Today |
| `training.html` | Training week |
| `workout.html` | **Active workout** — the biggest change in the round |
| `progress.html` | Progress |
| `calendar.html` | Calendar |
| `achievements.html` | Achievements |
| `settings.html` | Settings |
| `library.html` | Exercise Library |
| `programme.html` | **Programme** — the new screen |
| `more.html` | the mobile More sheet |
| `system.html` | the design system: every token and component |

Every screen carries a **design evidence** section below the fold showing its loading, empty,
error, conflict and refused-write states side by side. Those sections are documentation, not
a region of the real screen.

---

## `tokens/vshape-light.css`

The locked token layer, written to mirror `src/design/tokens.css` so that adoption is a
**swap, not a rewrite**:

- **§7** is the Phase-2 role-name theme (`canvas`, `surface`, `ink`, `line`, `accent`…)
- **§8** is a **Phase-1 compatibility shim** that re-points every token name the codebase
  already uses to a light value — so the whole app goes light in one commit without editing a
  single `className`. Three things cannot be shimmed and are named there explicitly.

Every colour carries its contrast ratio and the surfaces it is licensed for.

---

## Files, and what they are not

```
design/round-24/
  README.md                        ← you are here
  00_ROUND24_SUMMARY.md            ← the one-page answer
  01 … 10                          ← the blueprint
  tokens/vshape-light.css          ← the locked token layer (NOT imported by the app)
  prototype/
    index.html                     ← responsive evidence gallery
    vs.css  vs.js                  ← prototype-only; plain CSS/JS, no build, no framework
    <screen>.html × 11
```

The prototype is **static HTML with no data access**. It performs no request, holds no
product truth, and shares no code with the application. It exists to be looked at and
argued with.
