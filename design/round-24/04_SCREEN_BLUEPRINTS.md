# Round 24 — Stages C & D: screen blueprints

Each screen below states: what it is for, its structure, what changes from V2, what must not
change, and where the evidence is. All impact classes are justified in
`08_DATA_API_IMPACT_MATRIX.md`.

Prototype: `prototype/index.html` (all screens, all three viewports).

---

## 1. Today · `/today`

**Job:** understand today's state in seconds, and start today's training in one tap.

### Structure

1. **Header** — eyebrow `Foundation · Day 9`, title `Today`, subline
   `Monday 8 September · Home Mode`, live clock chip.
2. **Week strip** — rolling 7 days ending today. Today is an ink pill. Each day carries a
   marker dot **and a hidden text label** (completed / scheduled / recovery / holiday /
   extra).
3. **Training hero** — on any day that plans training. Badges (`Scheduled` + intensity),
   the session's window, the session name, exercises and sets, then **one large primary
   action**: `Start workout` or `Continue workout` (with a progress rail when started).
   Below it, two quiet controls: `View session` and `Take a recovery day instead`.
4. **Metric row** — streak · body weight · sessions this week. Three cards; the third spans
   the row on mobile.
5. **Rest of your day** — the routine items, in the engine's existing priority order.
6. **Needs attention** — overdue, unfinished. Amber, and on desktop it moves to the right
   rail.
7. **Done earlier** — collapsed, calm, each with Undo.
8. **Log today's weight** — a real row linking to Progress.

### What changes

| | |
|---|---|
| The **training hero is pinned above the routine** on a training day | Today currently leads with whatever the clock says is `NOW`. At 20:12 that is "Dinner + Netflix" and the gym session is buried under "Up next". The hero answers "what matters most right now" for a *training* app. |
| The gym item is **promoted, not duplicated** | It is withdrawn from the agenda list exactly as the existing Recovery path already withdraws it, and the hero carries its window and status, so nothing is lost and nothing appears twice. |
| `TrainingFlexCard` and `TodayHero` merge visually | Today stacks two competing cards above the fold. One hero, one primary action, the alternative demoted to a quiet control. |
| The `EmptyShell` "Weight check-in — comes in a later round" placeholder is deleted | Body-weight logging shipped in Round 15. The placeholder is now simply untrue. Replaced with a real row. |
| Week strip is new | Answers "what has this week looked like" without leaving Today. |

**Impact:** UI, plus three range reads that already exist (`/api/today/completions`,
`/api/workouts/history`, `/api/training-flex`).

### What must not change

- **The routine is not rendered while the day mode is unknown.** Loading shows a skeleton and
  says why; a failed Holiday read shows the failure and no routine. Falling back to Home Mode
  would put a real day's pressure on a day that may be exempt.
- **Time never completes a task.** The clock changes how an item looks and where it sits.
  Only an explicit tap finishes one.
- Completion controls stay disabled until saved progress has hydrated.
- Holiday `Training on` and `Exempt` remain visibly different days.
- Cross-midnight and spillover items keep their existing modelling.

### States shown
loading (day mode unknown) · Holiday read failed · Holiday + training on · Recovery chosen ·
workout in progress. All in `prototype/today.html`.

---

## 2. Training · `/training`

**Job:** show the week, and make the next training action obvious.

### Structure

1. Header, with an `Edit programme` icon action.
2. **Next-action hero** — today's session, with the single primary `Start workout`.
3. **This week** — five session cards: day, intensity, focus, exercise/set counts, and
   status (completed / in progress / scheduled). Today's card is accented.
4. **Weekend** — Saturday and Sunday as quiet dashed rows. No gym is scheduled and the
   design says so plainly.
5. **Outside the schedule** — the Extra entry, dashed and visually secondary, showing
   `Resume extra workout · based on <frozen source>` when one is in progress.
6. **Set-up** — links to Programme and Exercise Library.

### What changes

- A hero, so the page opens with an action rather than a list.
- Session cards carry **status**, which they do not today.
- `Programme` gains a link here as well as in Settings (IA-1).

**Impact:** UI + `GET /api/workouts/history?from&to` for the status badges.

### What must not change

- On a failed programme read, the page shows the error and **not** the static Foundation
  week. (This behaviour has no regression test today — see `07_STATE_AND_ACCESSIBILITY.md`.)
- The Extra stays below the week and visually distinct. It is an exception to the schedule,
  never a peer of it.
- Extra provenance is read from the **frozen snapshot**, not looked up against today's
  template.

---

## 3. Active Workout · `/training/:session` (focused mode)

**The largest change in the round, and it is UI-only.**

### What exists today

There is no Active Workout screen. `/exercises/:id` sounds like one but is a read-only media
and prescription page. Logging happens on `/training/:session`:

- a `WorkoutBar` card with Start / Resume, a 1.5px progress bar and Cancel-Start
- then `ExerciseAccordion` — **every** exercise of the session, collapsed
- expanding one reveals `WorkoutSetList`: a `flex-wrap` row of ~30px-tall text inputs
  (`py-1.5`, `w-20`) with Complete and Skip beside them

So mid-session the user scrolls a long accordion, opens the right exercise, finds the right
row in a wrapped grid of small fields, and types into a 30px box — one-handed, standing, in a
gym. There is no "which set am I on", no media, no sticky action and no rest timer.

### The redesign

1. **Focused top bar** — sticky. Exit (with a safe label: "your logged sets stay saved"),
   session name, `Monday · 9 / 17 sets`, intensity badge, and a progress rail. Both text
   lines truncate so a long focus can never push the badge off screen. **The tab bar is
   hidden in this mode.**
2. **Exercise hero** — media frame (contain, never cropped), modality badge, exercise name,
   target prescription, equipment. On desktop this is the **left column**.
3. **Current set card** — `Set 3 of 4`, outlined in accent. Modality-appropriate controls at
   **56px**, inputs at **16px**. The `Use 22.5 kg each` suggestion stays an explicit chip
   that types into the draft and nothing more.
4. **Rest timer** — optional, client-only, never blocks the next set.
5. **This exercise's sets** — compact rows: completed (green, exactly what was stored),
   corrected (with a `Corrected` chip), current (accented), pending. Undo on each resolved
   row.
6. **Exercise rail** — the session's exercises with done / current / pending state.
7. **Sticky action bar** — `Complete set` (56px primary) + `Skip`. On desktop it de-stickies
   into the current-set card.

### Modality behaviour — the truth boundary

| Modality | Controls | The rule |
|---|---|---|
| `weight_kg`, unit `kg` | load stepper + result | plain kilograms |
| `weight_kg`, unit `kg_each` | load stepper + result, labelled **"Load (kg each)"**, with an inline note | **per dumbbell.** Never doubled, never shown as a combined figure |
| `weight_kg`, mode `none` | result only | load does not apply |
| `resistance_band` | band label (text) + how many (numeric) + result | **no kg field exists on this control at all.** A completed band set must say which band and how many; half an answer is not a smaller record, it is an unreadable one |
| `bodyweight` | result only (reps or seconds) | **no load field exists.** Nothing is inferred |
| per-side prescriptions | result labelled `Reps / side` | recorded and displayed as "10 reps / side", never silently doubled into 20 |
| **input type unreadable** | **logging refused**, with a link to fix it in the Library | nothing is assumed about how it was loaded |

**The modality comes from the frozen snapshot, not from the exercise's current setting.** A
workout begun in kilograms keeps its kilogram field even if the exercise is switched to bands
mid-session — that is what the user is actually doing right now. The redesign adds a notice
saying so, rather than a silent difference.

**Impact: UI-only.** `useWorkoutLog` already holds every set with its `exerciseOrder`,
`setIndex`, frozen snapshot and status. Focused mode is a different render of the same array
calling the same `complete` / `skip` / `undo`. Media is `useExerciseMedia(exerciseId)`, which
already exists. The rest timer is `useState`.

### What must not change

- Every set exists from the moment the workout is started, so the list is the workout's
  shape, not just what happened to be logged.
- Load inputs are **never prefilled**. A default number is a value the user did not do.
- A skipped set is amber and never reads as success.
- Any mutation in flight locks the others.
- A stale write fails closed, keeps the typed value on screen, and overwrites nothing.
- Cancel-Start is offered **only** while the server says nothing was logged, and is never one
  tap away.

---

## 4. Progress · `/progress`

**Job:** answer "am I improving?" from persisted truth, without inventing analytics.

### Structure

1. Header.
2. **Summary metrics** — current weight (with delta) · streak · workouts logged.
3. **Body weight** — range pills, line chart with a dashed goal rule and a current-value
   callout, `Log weight` action.
4. **Sessions per week** — bar chart, current week highlighted.
5. **Personal bests** — grouped **by modality**, with an explicit note that a band set and a
   kilogram set are not ranked against each other.
6. **Exercise performance** — a small load trend for weight exercises; for band exercises,
   *reps at a stated band and count*, with **no load curve at all**.
7. **Recent workouts** — provenance badge (Scheduled / Extra), intensity, resolved counts,
   and recorded sets behind a disclosure with the correction entry preserved.

### What changes

- Card-first rather than table-first.
- Range pills, which must offer **only** the ranges `isBodyWeightRange` accepts — a pill the
  API would 400 is worse than no pill.
- Recorded sets move behind a disclosure so a workout card is scannable.

**Impact:** UI + existing reads.

### What must not change

- Modalities are never mixed or ranked against each other.
- Band progress is never plotted as a load.
- Nothing is estimated when a read fails; no chart is drawn from a partial answer.
- Correction writes keep their audit semantics, and a corrected set stays visibly corrected.
- One weight entry per local date; saving the same date replaces it.
- One decimal place for weight. No fake precision anywhere.

---

## 5. Calendar · `/calendar`

**Job:** explore schedule and history by date. **Not** a second Today engine.

### Structure

1. Month title with prev / `Today` / next.
2. Grid, 44px minimum cells, up to two marker dots per day.
3. Legend — with the rule that **every dot also has a hidden text label**, so no state is
   colour-only.
4. **Selected-day card** — date, badges, what the day was, and the one contextual action
   that day legitimately allows.
5. **Holidays** — the user's own (editable) and company holidays (locked), each showing
   Training On / Off.

### What changes

- Cells are large enough to tap on a phone.
- Company-holiday immutability is shown as a **lock, before the attempt**, not only as a 403
  afterwards.
- The selected-day card replaces a denser inline detail block.

### What must not change

- Holiday and daily-flex semantics stay factual. `Training on` and `Exempt` are different
  days and are always named.
- Calendar acquires **no** completion controls for arbitrary days.
- Overlapping Holidays are refused with the conflicting record named.

---

## 6. Achievements · `/achievements`

**Job:** make derived milestones feel earned, without becoming editable.

### Structure

1. **Featured** — the most recent unlocked milestone, on an accent hero.
2. **Streak metrics** — current · best · Foundation day.
3. **Milestone grid** — the six accepted milestones (`first-session`, `full-week`, `day-10`,
   `consistency`, `day-50`, `day-100`).
4. **Detail** — "why it was earned": the actual qualifying days, read back from logged
   workouts, including the exempt ones and why they were exempt.

### The state that matters

`MilestoneState` has **three** cases, not two: `unlocked`, `locked` (with honest progress,
and `value: null` where there is no number to show), and **`unresolved`**.

`unresolved` means the truth it depends on is loading, failed, or incomplete. **It must be
rendered as its own state**, in amber, saying "not known yet" and offering a retry. Drawing
it as locked would claim "not earned" about a fact we could not read.

### What must not change

No manual counters. Nothing here is editable. Weekend and Holiday exemptions stay visible in
the evidence list, because they are what make a streak survive a rest day.

---

## 7. Settings · `/settings`

**Job:** configuration, out of the way of training.

### Structure

1. **Account** — avatar, name, email, signed-in badge.
2. **Training** — `Programme` **(new — see IA-1)** and `Exercise Library`.
3. **Foundation start date** — with its existing fail-closed error state.
4. **Reminders** — this-device push, with the iOS install caveat.
5. **App** — version, and the day-mode row **only if it reads real Holiday truth**.
6. **Sign out** — this device only.

### What changes

Grouping, and the `Programme` link, which does not exist today.

**One row must be fixed or dropped.** `SettingsPage.tsx:12-27` hardcodes
`{ label: 'Mode', value: 'Home' }`. It is a literal in an array and reads no Holiday state, so
an account on Holiday is told **"Mode: Home"** — a false statement about the account's own day,
on the screen whose job is to state configuration. Either it reads the same Holiday truth Today
and Calendar read, or it is removed. It must not stay as a constant.

### What must not change

- A settings read that cannot be trusted **fails closed**: the error state is shown and no
  Foundation day number is displayed anywhere. `settingsFailClosed.test.tsx` pins this on
  Today, Progress and Training.
- No `GET /api/notifications/subscription` is introduced. A device reconciles its own state;
  asking would put a push endpoint into a query string.
- An impossible date such as `2026-02-30` is refused, not stored.

---

## 8. Exercise Library · `/settings/exercises`

**Job:** manage canonical exercise identity without feeling like database administration.

### Structure

1. Search.
2. Filter pills — All / Weight / Band / Bodyweight / Needs media / Archived.
3. Rows — name, input-type badge, media status, weekday usage, and a warning row style for
   an exercise with **no input type set**, which cannot be logged.
4. `Add exercise`.
5. Detail editor — media preview, display name, media URL, media description (required,
   never decorative), canonical input type, `Archive`, and *where it appears* with a link
   into the Programme.

### What changes

Search and filters (client-side over data already loaded), and rows that show input type and
media status at a glance rather than only inside the editor.

### What must not change

- **Identity does not move.** Renaming rewrites one column; the `exerciseId` that keys media,
  input type, personal bests and every historical workout row is untouched.
- An archived exercise keeps its history and its media; what it loses is a place in a
  **future** workout.
- Changing an input type applies to the **next** workout. Workouts already started keep the
  modality they were started with.
- Media description is required and non-empty.

---

## 9. Programme · `/settings/programme` — **new screen**

**Job:** arrange the training week.

### Why it is new

The programme-editing UI exists (`ExerciseProgrammeCard`) but is reachable only from an
exercise's media editor, and is exercise-first: *"which weekdays does Lat Pulldown appear
on?"* There is no screen anywhere that shows a weekday and what is in it. See
`03_NAVIGATION_IA.md` IA-1 and IA-2.

### Structure

1. Header with the revision and a live save state.
2. **Day tabs** — Mon–Fri with per-day counts.
3. **Selected day** — the day's identity (fixed Foundation focus and intensity) and its
   ordered slot list. Each slot: position, name, prescription badge, modality badge,
   equipment, and `Move up` / `Move down` / `Edit`.
4. **Prescription editor** — a bottom sheet on mobile, an inline panel from 768px: sets,
   records (reps/seconds), target from–to, per side, equipment note, and
   `Remove from <day>` with a note that removing changes no logged workout.
5. `Add an exercise to <day>`.
6. **Week at a glance** — all five days with focus, intensity and set counts.
7. **Save** — one all-or-nothing write on the revision the page loaded.

### What changes

The **entry point and the axis**, not the model.

**Impact: UI-only.** `PUT /api/programme` already accepts the entire `{exercises, sessions}`
payload on `expectedRevision` and applies it all-or-nothing. The new screen builds the same
request from the other direction.

### What must not change

- **One all-or-nothing write.** A rename that lands while a Friday slot fails would leave the
  programme in a state the user never asked for and cannot see.
- **Compare-and-swap on `revision`, and never auto-overwrite.** On 409 the user's edits stay
  on screen, the newer version is offered, and they choose.
- **Explicit Move up / Move down, not drag-and-drop.** These lists are edited on a phone in a
  gym, and a keyboard user must be able to reorder them at all. The buttons keep accessible
  names that state both the exercise and the day.
- Positions are rewritten from array order, so what is shown and what is stored cannot
  disagree.
- Validation is surfaced **per weekday, before Save**: an empty weekday cannot be started, so
  it cannot be saved; an archived exercise cannot hold a slot.
- Editing the programme never changes a workout already started.

---

## 10. Login · `/login`

Out of scope for restyling in this round beyond the theme flip: it is branded, it works, and
it sits outside the app shell by design. It inherits the new tokens and nothing else.
