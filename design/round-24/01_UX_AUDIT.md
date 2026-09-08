# Round 24 — Stage A: V2 UX audit

**Scope:** the VSHAPE100 **v2** repository at `7213f3b1` only. No V1 repository, deployment
or resource was accessed, searched, compared against or inferred from. No production data was
read.

**Method.** Eleven dimensions were audited against the source. Eight completed as parallel
agent passes over the client surfaces; three — the worker API surface, the D1 schema, and
truth enforcement — were audited by hand and are published as
`08_DATA_API_IMPACT_MATRIX.md` §1 and `09_FRESH_RESET_PLAN.md` §1. Every finding below cites
a real file and line.

**Honest limitation:** the planned adversarial verification pass did not run (the session hit
a usage limit). Findings are therefore *first-pass with hand cross-checks*, not
double-verified. Where a claim was independently checked against the source it is marked
**[checked]**. Three findings that turned out to be about the *prototype* rather than the app
were confirmed and fixed during the round — see §9.

---

## 1. The headline

VSHAPE100 v2 is a **correct system with an admin-console interface**. Its truth handling is
genuinely excellent — fail-closed reads, frozen snapshots, compare-and-swap writes, a
modality model that refuses to invent kilograms. Almost none of the findings below are about
correctness.

They are about this: the app is a dark navy instrument panel with 11px uppercase micro-labels
and 28px controls, and the single most-repeated action in the product — logging a set,
standing up, one-handed, in a gym — is a wrapping row of 30px text inputs inside a collapsed
accordion.

---

## 2. Dark / system-like patterns that block the new direction

| # | Finding | Evidence |
|---|---|---|
| A1 | **The token layer is single-theme dark with no seam to flip.** Ground colour, ink colour and the OS `color-scheme` hint are asserted once, unconditionally, in the base layer. | `src/design/tokens.css:69`, `:78` **[checked]** |
| A2 | **A fixed full-viewport radial wash sits behind every page** (blue 12%, cyan 5%). It has no light equivalent — on an off-white ground it reads as a smudge, not as depth. | `src/design/tokens.css:88` **[checked]** |
| A3 | **`--shadow-card` carries an inset white 3% hairline, explicitly "tuned for a dark ground".** Meaningless on white. | `src/design/tokens.css:60` **[checked]** |
| A4 | **Both navigations and the sheet scrim are translucent dark glass** (`bg-navy/85 backdrop-blur-xl`, `bg-surface/60`). Frosted chrome over a dark ground is the signature of the look being left, and it is the treatment that survives the ground change least. | `BottomNav.tsx:25`, `SideNav.tsx:22` |
| A5 | **The bottom nav's only active-state marker is a bare lime hairline** — which becomes near-invisible once lime is the accent on a light canvas. Core wayfinding carried by the one colour about to change role. | `BottomNav.tsx:40`, `:85` |
| A6 | **Blue, not lime, is the app's operating accent.** `bg-blue` ×40, `border-blue` ×30, `text-blue` ×24, `ring-blue` ×11 versus `bg-lime` ×5. Blue carries primary buttons, active nav, eyebrows **and the global focus ring**. "Change the accent" is therefore a decision about what focus, selection and links become — not a token swap. | `tokens.css:100` (focus), usage counts across `src/` |
| A7 | **Primary buttons paint their label in the page background colour** (`bg-blue text-navy`). A dark-dashboard idiom that has no meaning on a light ground. | `CompleteToggle.tsx:104` |
| A8 | **Sections are announced by 11px uppercase tracked micro-labels, not headings.** Progress has exactly one real `<h1>` and no `<h2>`/`<h3>` at all — hierarchy is carried entirely by size and letterspacing. | `ProgressPage.tsx:250` and the same pattern across Today, Training, Settings |

---

## 3. Hierarchy

| # | Finding | Evidence |
|---|---|---|
| B1 | **There is no type scale.** `tokens.css` declares exactly one type token (`--font-sans`) and no `--text-*`. Components use ~16 ad-hoc arbitrary sizes clustered between 9px and 15px, across 339 arbitrary-size utilities. "Strong hierarchy, low visual noise" is not reachable from there. | `tokens.css:42`; arbitrary `text-[…px]` usage across `src/` |
| B2 | **Today leads with a decision widget, not with what is happening.** On a training day the first card is a three-option "do you want to train?" — at 09:00 that is a decision about an event 11½ hours away, sitting above the item actually in progress. The page's own contract says "what is happening leads". | `TodayPage.tsx:221-232` vs `:77-79` **[checked]** |
| B3 | **On the gym hero, the filled primary button ticks a routine checkbox.** The most prominent action on a training day marks the 20:30 slot done **without logging a single set**; the real workout is behind the outline button. Two writes with very different meanings, presented as primary and secondary of one card. | `TodayHero.tsx:124-144`, `CompleteToggle.tsx` |
| B4 | **The Training list has no "today" and no next action** — five identical cards. Nothing says which day it is, which session is due tonight, or which is underway. | `TrainingPage.tsx:61-85` **[checked]** |
| B5 | **Nothing says which set you are on.** Every pending set renders a full, identical, simultaneously-editable control set. "Which set am I on" is the core in-gym question and the UI answers it only by scanning colours. | `WorkoutSetList.tsx:78-95` **[checked]** |
| B6 | **The Programme's Save is a tiny 12px chip while the media Save on the same page is a full-width button.** Visual weight is inverted relative to consequence: the control that rewrites the whole training week is the least prominent on the screen. | `ExerciseProgrammeCard.tsx:436` |
| B7 | **Exercise performance never states a change** — only "*n* workouts recorded" and a date. Body weight answers "am I improving?" with two explicit deltas; training performance, the point of the app, does not. | `ExercisePerformanceCard.tsx:149-158` |

---

## 4. Mobile and gym friction — the most important section

| # | Finding | Evidence |
|---|---|---|
| C1 | **Every logging control is well under a 44px tap target**: Complete `py-2` (~34px), Skip the same, Undo `py-1.5` (~28px), the suggestion chip smaller still. These are pressed with sweaty hands, mid-set. | `WorkoutSetList.tsx:268`, `:282`, `:348` **[checked]** |
| C2 | **The pending set row is a wrapping multi-field form.** A band set needs Band (128px) + How many (80px) + Reps (80px) + Complete + Skip, which cannot fit one mobile line and wraps into three or four — inside an accordion panel, inside a card. With 4 sets × 5 exercises this is *the* screen the user actually stands in front of. | `WorkoutSetList.tsx:198` **[checked]** |
| C3 | **Every logged value requires keyboard text entry.** One bare `<input type="text">` per value, no steppers, no chips, no `<form>`, no submit-on-enter. Three keyboard round-trips per set, and on a phone the wrapped Complete button can sit behind the keyboard. | `WorkoutSetList.tsx:407-422` **[checked]** |
| C4 | **A band's name and count must be retyped from scratch on every set.** Four sets means typing "Black" four times, and free text invites `Black` / `black` / `blk` variants that read back as different setups. | `WorkoutSetList.tsx:114-119`, `:151` **[checked]** |
| C5 | **Workout progress and actions scroll away; the thumb zone is occupied by navigation.** During a workout the persistent bottom real estate is spent on Today / Training / Progress / Calendar / More rather than on the action being repeated dozens of times. | `TrainingSessionPage.tsx:193-202`, `:391-405` **[checked]** |
| C6 | **Demo media only exists on a separate route.** Checking form mid-workout is a two-navigation round trip that destroys accordion state and scroll position. | `ExerciseAccordion.tsx:344-350` **[checked]** |
| C7 | **Opening an exercise from a started Extra loses the workout** — the back control returns to `/training`, because the return resolver does not know the reserved `extra` origin. | `extra.ts:147-149`, `navigation.ts` |
| C8 | **Programme number inputs snap to 0 when cleared and raise a red alert mid-typing.** Changing 10 to 15 on a phone requires select-all-then-type, and every intermediate keystroke flashes an error and disables Save. | `ExerciseProgrammeCard.tsx:546-555` |
| C9 | **The programme builder's controls are 11–13px chips at ~22px**, on the screen its own doc comment says is "edited on a phone in a gym". | `ExerciseProgrammeCard.tsx:277`, `:338` |
| C10 | **The only way to read an individual measurement on Progress is to expand a 12px table inside a nested scroll box.** The chart itself is `aria-hidden` and carries no values. | `TrendChart.tsx:131-139`, `:180-189` |

---

## 5. Navigation and IA

| # | Finding | Evidence |
|---|---|---|
| D1 | **The Programme Builder is not reachable from anywhere in the IA.** `SettingsPage` links only to `/settings/exercises`. The editor's only render site is inside `ExerciseMediaEditorPage`. | `SettingsPage.tsx:96-115`, `ExerciseMediaEditorPage.tsx:232` **[checked]** |
| D2 | **The only in-app link into the programme editor is labelled "Edit media".** It delivers a screen that can rename an exercise, move it between weekdays, re-prescribe it and archive it. | `ExerciseDetailPage.tsx:77-88` **[checked]** |
| D3 | **Ordering is edited exercise-first and blind.** The card can say "Lat Pulldown is step 3 of 6 on Monday" but cannot show Monday. Building Monday's order means opening six separate exercise pages. | `ExerciseProgrammeCard.tsx:268-290` **[checked]** |
| D4 | **There is no Active Workout destination.** `/exercises/:id` sounds like one and is a read-only media page; logging lives on `/training/:session` as an accordion. | `router.tsx`, `ExerciseDetailPage.tsx` **[checked]** |
| D5 | **Only the Extra card knows whether a workout is in progress**; the five scheduled sessions do not. The page's single workout read is spent on the least important item. | `TrainingPage.tsx:122` **[checked]** |

---

## 6. State handling — where the app tells the user something untrue

These are the highest-value findings in the audit, because each is a small honesty fix rather
than a restyle, and each is the kind of thing a redesign silently preserves.

| # | Finding | Evidence |
|---|---|---|
| E1 | **`ExerciseDetailPage` reports a failed programme read as "Exercise not found".** It handles only `loading`; `error` falls through to a false statement about the account's data, with no retry. | `ExerciseDetailPage.tsx:47-53` **[checked]** |
| E2 | **`ExtraWorkoutPage` renders an empty chooser on a failed programme read.** It reads `programmeState` but never inspects `.status`. "We could not read your programme" and "you have no sessions" are different facts. | `ExtraWorkoutPage.tsx:63-66` |
| E3 | **Calendar ignores the training-flex read status**, so a failed read makes Recovery days render as ordinary training days — on the one screen whose job is telling them apart. | `CalendarPage.tsx:89`, `:285`, `:460-464` |
| E4 | **The programme builder renders `null` when the programme cannot be read.** The most consequential editor in the app disappears silently: no loading branch, no error branch. | `ExerciseProgrammeCard.tsx:111` **[checked]** |
| E5 | **Settings hardcodes `Mode: Home`.** A literal in an array that reads no Holiday state, so an account on Holiday is told "Mode: Home" on the screen whose job is stating configuration. | `SettingsPage.tsx:12-27` **[checked]** |
| E6 | **A failed workout read makes the flex card assert "Today's session is already under way".** Treating unknown as "started" is correct fail-closed *disabling*; stating a positive fact from that same unknown is not. | `useScheduledStarted.ts:74-78` **[checked]** |
| E7 | **Every 409 refusal on Start is reported as a connection problem** — one message for every failure. A programme that moved in another tab, or a day already resolved as Recovery, is not a network error. | `useWorkoutLog.ts:233-236` |
| E8 | **A failed Complete reports at the top of the page, nowhere near the row that failed.** Once scrolled into an exercise panel the alert is off-screen, the row looks unchanged, and a set that was **not** recorded can read as one that was. | `useWorkoutLog.ts:104`, `:269` **[checked]** |
| E9 | **A stale write fails closed on the server but the client keeps showing the stale row** and offers "try again" against a row that has moved — where a retry re-reads and wins. | `useWorkoutLog.ts:265-273` |
| E10 | **A fully resolved workout still says "Resume workout".** There is no finished state anywhere in the app; at 17/17 it still invites you to resume. | `TrainingSessionPage.tsx:314-323` **[checked]** |
| E11 | **Correcting a set blanks both derived cards; saving a weight blanks the chart.** No stale-while-revalidate: the most common actions on Progress make surrounding content unmount and reflow. | `usePerformance.ts:34-42` |
| E12 | **Today ships a dashed "comes in a later round" placeholder for a feature that shipped in Round 15.** Roadmap language, in developer terms, on a shipped screen. | `TodayPage.tsx:283-288` **[checked]** |
| E13 | **A set whose modality cannot be read is visually identical to a bodyweight set.** With `inputType === null` both `isBand` and `takesLoad` are false, so the refusal — one of the strongest truths in the codebase — is communicated by the quietest element on the row. | `WorkoutSetList.tsx:133-134` **[checked]** |
| E14 | **First paint on Progress shows four separate loading messages**, two of which describe the same single fetch. | `ProgressPage.tsx:216`, `BodyWeightCard.tsx:78-82`, `PersonalBestCard.tsx` |

---

## 7. Accessibility

| # | Finding | Evidence |
|---|---|---|
| F1 | **Every loading indicator is a CSS-animated spinner that the app's own reduced-motion rule freezes.** `animation-duration: 0.01ms !important` applies to `*`, so for a user with reduced motion on, "something is happening" silently stops being communicated. | `tokens.css:121-129` **[checked]** |
| F2 | **Every workout-logging input signals invalidity with a coral border and nothing else** — a hue change on a 1px border, plus a Complete button that goes disabled with no stated reason. This is the app's most-used form. | `WorkoutSetList.tsx:407-421` **[checked]** |
| F3 | **Most secondary controls are ~22–28px tall** — Skip, Undo, "Use suggestion", move up/down. Desktop-admin densities on the surfaces used mid-workout. | `ExerciseProgrammeCard.tsx:277`, `WorkoutSetList.tsx:348` **[checked]** |
| F4 | **The global focus ring is blue and forces `border-radius: 6px` on every focused element**, regardless of the element's own shape. | `tokens.css:100` **[checked]** |
| F5 | **Programme validation shows one issue at a time, far from the field, usually without naming the weekday.** With five weekdays and up to six fields each, one unanchored sentence cannot say which box is wrong. | `ExerciseProgrammeCard.tsx:393-397` |

---

## 8. Duplication and dead tokens

| # | Finding | Evidence |
|---|---|---|
| G1 | **Two parallel token vocabularies; the role tokens are dead.** `--color-ink` is declared as the primary text role and has **zero** `text-ink` usages — 147 call sites write `text-offwhite` instead. A light redesign has to invert every text colour, and the app names them by palette noun rather than by role. | `tokens.css:28` vs usage counts **[checked]** |
| G2 | **`--color-mutedgrey` has zero usages** and is an exact duplicate of `--color-ink-faint`. | `tokens.css:19` **[checked]** |
| G3 | **Four semantic tokens are byte-identical to palette tokens**: `--color-hard` = `--color-coral`, `--color-light-day` = `--color-cyan`, `--color-pump` = `--color-purple` = `--color-holiday`, `--color-energy` = `--color-lime`. Session intensity PUMP and day-mode Holiday are literally the same colour. | `tokens.css:33-37` **[checked]** |
| G4 | **The four CSS duration and two easing tokens are declared and never used as utilities.** Timing lives in `motion.ts` and in hand-written `duration-150` classes. | `tokens.css:50-57` **[checked]** |
| G5 | **`--color-ink-faint` is the single most-used colour in the app (216 usages)** — a tertiary text token doing the work of a primary one. | usage counts across `src/` |
| G6 | **Six screens hand-roll their own error row**, each with slightly different wording, retry affordance and markup. There is no shared `Banner`, `EmptyState` or `LoadingState`. | Today, Training, Session, Progress, Settings, Library |

---

## 9. Findings the audit made about the Round 24 prototype itself

Three findings turned out to be defects in this round's own prototype rather than in the app.
All three were confirmed against the source rule they violated and **fixed during the round**.

| # | Finding | Resolution |
|---|---|---|
| H1 | **The current-set card shipped with a load value already in the input** (`value="22.5"`). Against `WorkoutSetList.tsx:115-116` — "never prefilled: a default number would be a value the user did not do". A prefilled load plus a one-tap Complete makes it possible to record a weight nobody lifted: the single largest fabrication risk in the redesign. | **Fixed.** The field renders empty with a placeholder; the suggestion remains an explicit chip. |
| H2 | **The exercise rail labelled an exercise "Done" from a resolved count, and the set list had no skipped state.** An exercise whose four sets were all skipped would have rendered green — a skip reading as successful training. | **Fixed.** Completed and skipped are reported separately and never summed; a `partial` state and a skipped set row were added. |
| H3 | **`--vs-extra-ink` / `--vs-extra-soft` were byte-identical to `--vs-accent-ink` / `--vs-accent-soft`**, and the `extra` badge class was being reused for the UI states "Now", "Current" and "In progress" — collapsing a provenance signal into a state signal. | **Fixed.** Extra is now an outline chip (shape, not hue, carries the distinction) and a separate ink-filled `current` badge carries UI state. |

This is the part of the audit that most justifies having run it.

---

## 10. What the audit found that is *right*, and must survive

Named explicitly, because a redesign is the easiest place to lose them:

- Today refuses to render a routine while the day mode is unknown, and refuses to fall back
  to Home Mode on a failed Holiday read.
- Training refuses to show the default Foundation week when the account's own programme
  cannot be read.
- A started workout renders from its **frozen snapshot**, never from the current programme,
  so a rename or a reorder cannot attach logged sets to a different exercise.
- Load inputs are never prefilled.
- Band evidence is a label and a count, never kilograms; bodyweight has no load field; an
  unreadable modality refuses logging outright.
- `kg_each` is per dumbbell and is never doubled for display.
- Per-side prescriptions record "10 reps / side" and are never silently doubled into 20.
- The programme write is one all-or-nothing compare-and-swap, and a conflict never
  auto-overwrites.
- Reordering uses explicit buttons with accessible names that state both the exercise and the
  day, so a keyboard user can reorder at all.
- Cancel-Start is offered only while the server confirms nothing was logged, and is never one
  tap away.
- Achievements are derived; there is no counter to edit.
- `MilestoneState` distinguishes `unresolved` from `locked` — "we do not know" is not "not
  earned".

`07_STATE_AND_ACCESSIBILITY.md` §5 lists the tests that pin these, and the one accepted
behaviour that currently has no test at all.
