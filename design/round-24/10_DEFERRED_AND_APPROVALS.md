# Round 24 — deferred items and controller decisions

> **CONTROLLER DECISIONS ARE NOW LOCKED.** Q1, Q2, Q3, Q5, Q6 and Q8 were approved;
> Q4 was decided against the goal-weight line (removed, deferred); Q7 set the Fresh
> Reset target as a FULL ACTIVITY FRESH START with **execution not authorized**.
> The recommendations below are kept as the reasoning that was put to the controller.
> What was built against them is in `11_IMPLEMENTATION_REPORT.md`.

Two lists. **§1 needs a decision before the redesign can be implemented.** §2 is deferred to
Development Directions / Backlog and is explicitly not part of this round.

---

## 1. Decisions the controller must make

### Q1 · The locked brand palette is superseded — approve or reject

`src/design/tokens.css:5` states: *"Brand palette is locked — see 01_ACCEPTED_STATE.
Roughly: 70% deep neutral · 20% electric blue · 10% sport accents."*

Round 24 replaces all three parts of that ratio: the deep neutral becomes an off-white
canvas, electric blue is demoted from primary action to informational, and lime is promoted
from a 10% sport accent to the primary. The session-intensity semantics (HARD / LIGHT /
PUMP) keep their hue families and are only retuned for luminance on a light ground.

This is exactly what the package's visual direction asks for, but it supersedes a **locked**
accepted decision, so it needs to be said out loud rather than assumed.

**Recommendation: approve.** The package is unambiguous about the target feel, and the new
palette is fully contrast-checked (`02_DESIGN_SYSTEM.md` §9).

### Q2 · Ratify the navigation model

`03_NAVIGATION_IA.md` chooses the package's **alternative** model — Today / Training /
Progress / Calendar / More, with **no centre action** — and replaces the centre action with a
contextual resume bar that exists only while a workout is in progress.

The reasoning is in that document: a centre action would have to resolve six independent
reads before it could name itself, and would be disabled-and-unexplained whenever any one of
them is unresolved.

**Recommendation: approve the alternative model.** The package invites exactly this choice.

### Q3 · The Programme Builder gains a route and inverts its axis

Two changes, both consequences of the same finding (`03_NAVIGATION_IA.md` IA-1 / IA-2):

- **A new route `/settings/programme`** and a link from Settings and from Training. Today the
  programme editor is reachable **only** through Exercise Library → an exercise → its media
  editor.
- **Week-first instead of exercise-first.** Day tabs → ordered exercise list → prescription
  sheet, rather than "which weekdays does this exercise appear on".

The write is unchanged: `PUT /api/programme` already takes the whole `{exercises, sessions}`
on `expectedRevision`, all-or-nothing. **UI-only.** The existing card's good properties —
one atomic write, identity never moves on rename, explicit move up/down — are all preserved.

**Recommendation: approve.** This is the highest-value IA fix in the round.

### Q4 · The goal line on the body-weight chart — there is no goal field

The prototype draws a dashed "Goal 78.0" rule. **No goal weight exists anywhere in the
schema.** `body_weight_entries` stores measurements only, and nothing in `account_settings`
holds a target.

Three options:

1. **Drop the goal line.** Zero cost, zero risk. The chart still answers "am I improving?"
   through its axis, its trend and its current-value callout.
2. **Add a goal to `account_settings`.** A real schema change — a separate, separately
   approved round. It is a genuine product feature, not a redesign side effect.
3. Keep the visual and derive a "goal" from something else. **Refused** — that would be
   fabricated data, which the round's own truth rules forbid.

**Recommendation: option 1 for Round 24, option 2 as a Development Direction.**

### Q5 · The rest timer is a new feature, not a restyle

`04_SCREEN_BLUEPRINTS.md` §3 includes an optional rest timer in Active Workout. It is
client-only — it writes nothing, persists nothing and never blocks a set — but the round's
OUT list includes *"New speculative product features"*, and a timer is a new feature however
small.

**Recommendation: approve as an optional, clearly-scoped inclusion**, on the standing
condition that it never becomes server state. If the controller prefers a strict reading of
the OUT list, drop it — nothing else in the blueprint depends on it.

### Q6 · Three test-only hardening items, to be approved before any reset

None changes production behaviour. All three close a gap this round found:

| | What | Why |
|---|---|---|
| **a** | Add `migration0015` to the `CHAIN` in `src/test/freshStartOperator.test.ts` | The chain stops at `0014`, so the Fresh Start operator path has **never been executed against the schema as it now stands** (`09_FRESH_RESET_PLAN.md` G-1) |
| **b** | Add `programme_revisions`, `programme_exercises`, `programme_slots`, `company_holiday_preferences` to `FRESH_START_PRESERVED_TABLES` | Four protected tables sit outside the assertion that stops a future statement touching them (G-3) |
| **c** | Assert that a failed programme read on `/training` renders the error branch and **no** session rows | An accepted fail-closed behaviour — "do not show the default week to somebody whose real one could not be read" — has no regression test at all (`07_STATE_AND_ACCESSIBILITY.md`) |

**Recommendation: approve all three.** (b) and (c) are the kind of thing a redesign silently
breaks while every existing test stays green.

### Q7 · Fresh Reset — four questions, carried from Stage G

Repeated here because they gate any destructive step. Full context in
`09_FRESH_RESET_PLAN.md` §5.

- **Q-R1 Scope.** A *workout-history cutoff* (what the operator does today), or a *full fresh
  start* that also clears `body_weight_entries`, `today_completions`, `training_flex`,
  `holiday_overrides` and `company_holiday_preferences`? These are different authorizations
  and the second does not exist yet.
- **Q-R2 Backup.** Is a D1 export required before execution, or is the loss accepted in
  writing? The operator has no export step.
- **Q-R3 Cutoff date.** Exact local `YYYY-MM-DD`. `< cutoff` is strict.
- **Q-R4 Account key.** Exact `google_sub`. Never inferred; deliberately not written down in
  this package.

### Q8 · Does Round 24 extend to source implementation?

This round delivered a **blueprint plus a working visual prototype**, per
`06_RESET_AND_ACCEPTANCE.md`. It has changed **no application source**: `src/`, `worker/`,
`shared/`, `migrations/` and every config file are byte-identical to `7213f3b1`. Everything
added lives under `design/round-24/`.

Extending to implementation requires an explicit controller decision, and — per the package —
would then need focused tests per stage, full regression, typecheck, lint, build, one final
candidate SHA, and a stop at `READY FOR INDEPENDENT REVIEW`.

**Recommendation: decide after the independent design review, not before.**

---

## 2. Deferred to Development Directions / Backlog

Not part of Round 24. Recorded so they are not silently lost.

| | Item | Why deferred |
|---|---|---|
| D1 | **`GET /api/workouts/active`** | The only API contract change the entire redesign surfaced. The resume bar works today for the scheduled workout using an existing read; covering an in-flight **Extra** as well would need this. A convenience, not a requirement. |
| D2 | **Goal weight field** | See Q4. A real product feature with a schema change; not a redesign side effect. |
| D3 | **A canonical band library** | The audit found that a band's name and count must be retyped on every set, and that free text invites `Black` / `black` / `blk` variants that read back as different setups. The blueprint solves the typing with one-tap chips offering bands **already used in this workout** — client-side, no schema. A real per-account band library would be a schema change and belongs in its own round. |
| D4 | **A richer post-workout summary** | The blueprint's completion state counts only what was recorded, and reports completed and skipped separately. Anything beyond that — volume load, calories, an intensity score — would be fabricated, and volume in particular cannot be summed across a band set and a kilogram set. |
| D5 | **Drag-and-drop programme reordering** | Removes keyboard operability from the screen that most needs it, for lists five items long. |
| D6 | **A dark theme as a user preference** | Round 24 delivers a single light system. A future dark theme would be a second complete palette with its own contrast pass — a round of its own, not a `dark:` variant bolted onto this one. |
| D7 | **Trusted-device management / sign out everywhere** | Already a later-round item in the README. The redesigned Settings leaves room for it. |
| D8 | **Weight entry directly on Today** | The blueprint replaces the stale "comes in a later round" placeholder with a link to Progress. A one-tap entry on Today would be genuinely nice and is supported by the existing `PUT /api/progress/weight`, but it adds a write path to Today, which currently has only one. |
| D9 | **Stale-while-revalidate on Progress** | The audit found that correcting a set or saving a weight makes surrounding cards unmount and re-render as "loading". Fixable in `usePerformance` / `useWorkoutHistory` by keeping the last good data while refetching. Real, worth doing, and a behaviour change rather than a redesign — so it is named here rather than folded in silently. |

---

## 3. Pre-existing baseline observations (found while verifying, not caused by this round)

`npm run test` on the accepted baseline `7213f3b1` in a clean container does not come back
fully green. Both issues were confirmed to reproduce with the entire `design/` directory
deleted, so neither is a Round 24 effect. They are recorded, not fixed — fixing application
source would break the "no application source changed" property this round's acceptance
rests on.

| | Observation | Detail |
|---|---|---|
| **P1** | **Six test files fail to load**: `Cannot bundle Node.js built-in "node:sqlite"` | Affects `freshStart.test.ts`, `freshStartOperator.test.ts`, `programmeStore.test.ts`, `extraMigration.test.ts`, `workoutInputMigration.test.ts`, `workoutRecoveryMigration.test.ts` — via `src/test/sqliteD1.ts` for the third. Node here is v22.22.2, which has `node:sqlite`, but `vitest.config.ts` runs the whole suite under `environment: 'jsdom'` and Vite refuses to bundle a Node built-in for it. **These are the SQLite-backed tests — including both Fresh Start tests**, so the reset operator's own coverage is among what does not run. Worth confirming whether it runs in the environment the project normally uses; if it does not, it is the single most important test gap in the repository, given Q7. |
| **P2** | **One assertion fails**: `trainingNavigation.test.tsx > browser history is left alone > leaves normal Back working through the whole trail` | 41 of 42 tests in that file pass. It renders `/training`, finds the "Training" heading, then cannot find the text `Back Width + Biceps` — i.e. the session rows are absent at that moment, which is what `TrainingPage` renders when the programme read has not resolved or has failed. Consistent with a timing or stub-ordering issue in this environment rather than a product defect, but it should be reproduced in the project's normal environment before being dismissed. |

**Recommendation:** confirm both against the machine the project actually develops on, before
Q7 (Fresh Reset) is approved. P1 in particular means the Fresh Start operator's tests may not
be running anywhere.

---

## 4. What this round explicitly did **not** do

- No production D1 was read, written, inspected or reset.
- No deployment. No Worker was published.
- `main` is untouched at `7213f3b1`.
- The superseded Round 23 candidate `d9bb9cbf` was not used, read or merged.
- No V1 repository, deployment or resource was accessed, searched or referenced.
- No application source changed — `src/`, `worker/`, `shared/`, `migrations/` and every
  config file are byte-identical to the accepted baseline.
- No Ask VShape / AI feature, no band-to-kg conversion, no new training algorithm, no
  backend rewrite.
