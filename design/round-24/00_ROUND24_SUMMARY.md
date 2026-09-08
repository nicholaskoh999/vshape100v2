# Round 24 — UI/UX Redesign Blueprint + Fresh Reset Plan v1

**Status: BLUEPRINT COMPLETE — READY FOR INDEPENDENT DESIGN REVIEW**
**Round 24 is still active. No production deployment. No destructive reset.**

Baseline: `7213f3b15fc0af6597e0ee236802357e16985084`
Checkpoint: `checkpoint/pre-round24-redesign` → that exact SHA
Application source changed: **none**

---

## The round in one paragraph

VSHAPE100 v2 is a correct system wearing an admin console. Its truth handling is genuinely
excellent — fail-closed reads, frozen snapshots, compare-and-swap writes, a modality model
that refuses to invent kilograms — and almost nothing in this round is about correctness. It
is about the fact that the app is a dark navy instrument panel with 11px uppercase
micro-labels and 28px controls, and that the single most-repeated action in the product,
logging a set one-handed in a gym, is a wrapping row of 30px text inputs inside a collapsed
accordion. Round 24 defines one coherent light visual system, one navigation decision, a
purpose-built Active Workout, and a Programme screen that can actually show you your Monday —
and it does all of that **without a single schema change and without a single API contract
change.**

---

## The five decisions

1. **Light, not dark.** Warm off-white canvas, white cards, near-black ink, lime as a fill
   with ink on it, blue demoted from primary to informational. Separation comes from the
   canvas→surface luminance step, not from glow. Every value is contrast-checked, and the two
   pairs that fail somewhere are documented with the rule that keeps them safe.
   → `02_DESIGN_SYSTEM.md`

2. **No centre action.** The bottom bar stays Today / Training / Progress / Calendar / More.
   A centre Start button would have to resolve six independent reads before it could name
   itself, and would be disabled-and-unexplained whenever any one of them was unresolved.
   Instead: a **contextual resume bar** that exists only while the server says a workout is in
   progress — so it is never wrong, and never disabled.
   → `03_NAVIGATION_IA.md`

3. **Active Workout becomes a place.** Today there is none: `/exercises/:id` sounds like it
   and is a read-only media page, while logging lives on `/training/:session` as an accordion
   over every exercise at once. The redesign makes it a focused mode of the same route —
   one exercise, one current set, 56px controls, media in-frame, a sticky action bar, the tab
   bar hidden. **UI-only**: every field it renders is already on the wire.
   → `04_SCREEN_BLUEPRINTS.md` §3

4. **The Programme gets a screen.** It is currently unreachable from the IA — the editor's
   only render site is inside an exercise's *media* page, reached by a link labelled "Edit
   media", and it can only tell you "Lat Pulldown is step 3 of 6 on Monday" rather than show
   you Monday. The redesign adds `/settings/programme`, week-first. **UI-only**:
   `PUT /api/programme` already writes the whole week all-or-nothing on `expectedRevision`.
   → `03_NAVIGATION_IA.md` IA-1/IA-2, `04_SCREEN_BLUEPRINTS.md` §9

5. **The Fresh Reset already exists, and is better than the package assumed.**
   `shared/freshStart.ts` + `scripts/fresh-start.mjs` are an operator-only, account-scoped,
   date-bounded, atomic, inventory-by-default reset with no HTTP route. Stage G's job was
   therefore not to design one but to publish the table matrix and name the gaps — of which
   the sharpest is that its operator test builds the database from a migration chain that
   **stops at 0014**, so it has never run against the schema as it now stands.
   → `09_FRESH_RESET_PLAN.md`

---

## What the impact analysis found

| Class | Count | |
|---|---|---|
| UI-only | 29 | presentation, layout, copy, component structure |
| Client-state only | 2 | rest timer, library filtering |
| Existing API supports it | 12 | an endpoint that already exists, called from a new place |
| **API contract change needed** | **1** | `GET /api/workouts/active` — **deferred, not proposed** |
| **Schema change needed** | **0** | none required, none proposed |

The one endpoint the redesign would benefit from is a convenience for a resume affordance
that already works without it. → `08_DATA_API_IMPACT_MATRIX.md`

---

## Deliverables

| File | Stage | What it is |
|---|---|---|
| `01_UX_AUDIT.md` | A | 60+ cited findings across 11 dimensions, including three the audit found in this round's own prototype |
| `02_DESIGN_SYSTEM.md` | B | tokens, type, shape, elevation, spacing, motion, contrast table, 3-phase adoption plan |
| `03_NAVIGATION_IA.md` | B | the navigation decision and its justification from V2 source; the two real IA defects |
| `04_SCREEN_BLUEPRINTS.md` | C+D | ten screens: job, structure, what changes, what must not change |
| `05_RESPONSIVE_RULES.md` | E | mobile / tablet / desktop rules, with the verification actually performed |
| `06_COMPONENT_INVENTORY.md` | — | keep / extend / new / retire, with a build order |
| `07_STATE_AND_ACCESSIBILITY.md` | — | the eight states, per-screen matrix, a11y rules, and the behaviours that must not regress |
| `08_DATA_API_IMPACT_MATRIX.md` | F | the full API surface, and 34 changes classified honestly |
| `09_FRESH_RESET_PLAN.md` | G | 20-table matrix, what the existing operator does, and five gaps |
| `10_DEFERRED_AND_APPROVALS.md` | — | eight controller decisions, nine deferred items |
| `tokens/vshape-light.css` | B | the locked token layer, written as a drop-in for `src/design/tokens.css` |
| `prototype/` | C–E | eleven working responsive screens + a design-system sheet + a viewport gallery |

---

## Evidence

`prototype/index.html` renders every screen inside a real iframe viewport at 390 × 844,
834 × 1112 and 1440 × 900 — so what is shown is actual media-query behaviour from one
responsive file per screen, not three drawings.

Verified by a headless Chromium pass over **11 screens × 3 viewports**: zero console errors,
zero uncaught page errors, and zero horizontal document overflow on all 33 combinations. Two
overflow defects were found and fixed during the round.

Each screen also carries a "design evidence" section below the fold showing its loading,
empty, error, conflict and refused-write states side by side.

### Repository checks on the candidate branch

`npm run typecheck` ✅ · `npm run lint` ✅ · `npm run build` ✅ ·
`npm run test` — **2562 passed, 2 failed, 6 files failed to load**.

Every one of those failures **reproduces identically on the accepted baseline with
`design/` deleted entirely**, so none is caused by Round 24 — which is expected, since the
round changed no application source. They are recorded as pre-existing observations in
`10_DEFERRED_AND_APPROVALS.md` §3 rather than fixed here, because fixing application source
would break the property this round's acceptance rests on.

---

## What this round did not do

- No production D1 read, written, inspected or reset. No row counts were taken.
- No deployment. No Worker published.
- `main` untouched at `7213f3b1`.
- The superseded Round 23 candidate `d9bb9cbf` not used, read or merged.
- No V1 repository, deployment or resource accessed, searched or referenced.
- **No application source changed** — `src/`, `worker/`, `shared/`, `migrations/` and every
  config file are byte-identical to the accepted baseline. Everything added lives under
  `design/round-24/`.

---

## Known limitation of this round's method

The audit's planned adversarial verification pass **did not run** — the session hit a usage
limit after 8 of 11 dimensions had completed and before any verifier finished. The three
dimensions that did not complete (worker API surface, D1 schema, truth enforcement) were
audited by hand instead and are published in full as `08` §1 and `09` §1, so nothing is
missing. But the client-surface findings in `01_UX_AUDIT.md` are **first-pass with hand
cross-checks**, not double-verified; the ones independently checked against source are marked
`[checked]`.

This is stated rather than smoothed over because it is exactly the kind of thing an
independent review should know before weighing the findings.

---

## What happens next

1. Independent design review of this package.
2. Controller decisions on the eight items in `10_DEFERRED_AND_APPROVALS.md` §1 — the ones
   that gate implementation are Q1 (the locked brand palette is superseded), Q2 (ratify the
   navigation model), Q3 (the Programme route and axis) and Q8 (does Round 24 extend to
   source implementation).
3. Only then: implementation, on a candidate branch, with focused tests per stage and full
   regression before any deploy.

**ROUND 24 STILL ACTIVE — READY FOR INDEPENDENT DESIGN REVIEW.**
