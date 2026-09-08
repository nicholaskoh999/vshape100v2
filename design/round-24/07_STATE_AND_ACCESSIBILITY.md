# Round 24 — state and accessibility rules

---

## 1. The eight states every screen must intend

| State | Meaning | Presentation |
|---|---|---|
| **loading** | the answer is not known yet | skeleton shaped like the content it replaces. Never a bare spinner for a page load |
| **empty** | the answer is known and there is nothing | `EmptyState`: icon, one title, one line, one action |
| **error** | the answer could not be read | `Banner danger`: what failed, **what was not lost**, one retry |
| **ready** | normal | — |
| **saving** | a write is in flight | the acting control shows a spinner and disables; siblings that could conflict also disable |
| **saved** | the write landed | `role="status"` line or a success badge; never a modal |
| **stale / conflict** | the write was refused because the world moved | `ConflictBanner`: **the user's input stays on screen**, the newer version is offered, nothing is auto-overwritten |
| **disabled / refused** | truth does not allow this write | the control is visibly unavailable **and says why**. A control that looks available but cannot work is worse than one that is plainly unavailable |

The last two are the ones V2 gets right today and that a redesign is most likely to lose.
They are non-negotiable.

---

## 2. Per-screen state matrix

`•` = required in the redesign. Notes name where V2 already does it, and where the redesign
adds something.

| Screen | load | empty | error | saving | saved | conflict | refused |
|---|:--:|:--:|:--:|:--:|:--:|:--:|:--:|
| **Today** | • | • | • | • | • | – | • |
| **Training** | • | • | • | – | – | – | • |
| **Active Workout** | • | – | • | • | • | • | • |
| **Progress** | • | • | • | • | • | – | – |
| **Calendar** | • | • | • | • | • | • | • |
| **Achievements** | • | • | • | – | – | – | – |
| **Settings** | • | – | • | • | • | – | • |
| **Exercise Library** | • | • | • | • | • | – | • |
| **Programme** | • | – | • | • | • | • | • |

### Today
- **load** — the day mode is not known until the Holiday read returns. V2 already refuses to
  render the routine while unknown, because showing it would put a real day's pressure on a
  day that may be exempt. **This behaviour is preserved exactly.**
- **error** — the Holiday read failing shows the failure and *no* routine. Falling back to
  Home Mode would be a guess the user acts on.
- **refused** — while a flex choice stands, the scheduled session is withdrawn from the
  agenda and the card says so. Once the workout is started, the alternatives are disabled
  rather than offered, because the server would refuse the write.
- **saving / saved** — completion toggles are per-item; an unknown hydration state disables
  all of them, because completing something before saved progress has loaded is acting on
  state we have not read.

### Three screens report the wrong failure today
These are corrected by the redesign, and each is a one-line honesty fix rather than a
restyle:

- **`ExerciseDetailPage`** handles only `programmeStatus === 'loading'`. On a failed
  programme read it falls through and renders **"Exercise not found · This exercise is not in
  your programme"** — a false statement about the account's data, with no retry.
- **`ExtraWorkoutPage`** reads `programmeState` but never inspects `.status`, so a failed read
  renders an **empty chooser** rather than an error. "We could not read your programme" and
  "you have no sessions" must stay distinct.
- **`CalendarPage`** ignores the training-flex read status, so a failed flex read makes
  **Recovery days render as ordinary training days** — on the one screen that exists to tell
  them apart.

### Training
- **error** — "your training week could not be loaded" and **deliberately not** the default
  Foundation week. Showing the default to somebody whose real programme could not be read
  would show them a session they may have edited away. Preserved.
- **refused** — a weekday with no exercises, or an unparseable prescription, cannot be
  started; the Start control is unavailable and names the reason.

### Active Workout
- **load** — "checking your workout" rather than offering Start, so a workout already
  underway never briefly looks unstarted.
- **conflict** — a stale set write fails closed: the typed value stays on screen, nothing is
  overwritten, one reload is offered.
- **refused** — a set whose stored input type could not be read cannot be logged at all, and
  says so. Nothing is assumed about how it was loaded.
- **saving** — any set mutation locks the others, so a second submit cannot start while one
  is in flight.

### Calendar
- **conflict** — an overlapping Holiday is refused with the conflicting record named.
- **refused** — a company holiday is immutable. The redesign shows the lock **before** the
  attempt rather than only as a 403 afterwards.

### Programme
- **conflict** — the whole-programme write is compare-and-swap on `revision`. On 409 the
  user's edits stay, the newer version is offered, and nothing merges itself.
- **refused** — an empty weekday or an archived exercise still holding a slot blocks Save,
  per weekday, before the request is sent.

---

## 3. Error copy rules

Every error says three things, in this order:

1. **what failed**, in the user's terms — "your training week could not be loaded", not
   "request failed (500)"
2. **what was not lost** — "nothing has been lost", "your edits are still on screen",
   "nothing was overwritten"
3. **one way forward** — a single retry, or a single navigation

And never:

- an automatic retry loop
- a destructive "reset and try again"
- a raw status code or a stack trace as the whole message
- a cheerful tone about a failure

V2's existing wording is already close to this and several strings are reused verbatim.

---

## 4. Accessibility rules

### Contrast
Per `02_DESIGN_SYSTEM.md` §9. The two rules that constrain layout:

- **`--vs-ink-3` is 4.4:1 on the canvas** — small text on the canvas uses `ink-2` instead.
- **Any input, checkbox, radio, toggle or focusable boundary uses `--vs-line-control`
  (3.2:1)**, not the decorative hairline (1.6:1). WCAG 1.4.11.

### Targets
- 44px minimum for anything tappable, everywhere.
- 56px for in-gym primaries: Complete set, Skip, and the load / rep / seconds steppers.
- 44px minimum for calendar cells and week-strip days, including at 390px.

### Focus
- `2px solid var(--vs-ink)` at `2px` offset, 6px radius.
- Inverted to `ink-on-dark` on accent and ink fills, where a dark ring disappears.
- Never removed. Never `:focus { outline: none }` without a `:focus-visible` replacement.
- Opening a sheet moves focus into it; closing returns focus to the control that opened it.

### Names and semantics
- Every icon-only control carries an `aria-label`. `IconButton`'s type makes it required.
- Move up / move down in the Programme editor name the exercise **and** the day:
  "Move Lat Pulldown up in Monday". V2 already does this; it is preserved.
- Every form control has a real `<label>` with `htmlFor`. Placeholders are never labels.
- Errors use `aria-invalid` on the control and `aria-describedby` pointing at the message.
- Progress bars use `role="progressbar"` with `aria-valuemin` / `max` / `now` and a label.
- Segmented controls use `role="tablist"` / `role="tab"` / `aria-selected`.
- Calendar cells use `aria-pressed` for selection.
- Status lines use `role="status"`; failures use `role="alert"`.

### No colour-only status
Every badge renders an icon **and** a word. Every calendar dot and week-strip marker carries
a visually hidden text label naming what it means. This is the rule that makes the deliberate
hue overlap between session intensity (HARD/LIGHT/PUMP) and day resolution
(Scheduled/Recovery/Extra/Holiday) safe, and it is what makes `forced-colors: active` degrade
to legible rather than ambiguous.

### Keyboard
- **No drag-and-drop anywhere.** Programme reordering stays explicit buttons. These lists are
  edited on a phone in a gym and a keyboard user must be able to reorder them at all.
- Sheets are dismissible with `Escape` and trap focus while open.
- Tab order follows visual order; nothing relies on a positive `tabindex`.

### Motion
- `prefers-reduced-motion: reduce` collapses every animation and transition, globally.
  V2 already does this in `tokens.css` and via `MotionConfig reducedMotion="user"`; both are
  preserved.
- **A loading signal must never be carried by animation alone.** V2's global reduced-motion
  rule sets `animation-duration: 0.01ms !important` on everything, and every loading
  indicator in the app today is a spinning `Loader2`. For a user with reduced motion on,
  "something is happening" silently stops being communicated — in a calm fitness app,
  exactly the audience most likely to have that setting enabled. Skeletons must therefore
  read as placeholders while completely still (a solid sunken ground, with any shimmer as an
  enhancement on top), and an in-flight action must also change its label or its
  `aria-busy`/`role="status"` text, not only its icon.
- No parallax, no auto-playing decorative motion, no motion required to understand state.

### Text
- Body text is never below 13.5px.
- Inputs are 16px, so iOS never zooms on focus.
- Uppercase is licensed for the eyebrow style only.
- The layout survives 200% text zoom without horizontal document scrolling — the reason
  content columns are `max-width` rather than fixed, and why headings wrap while rows
  truncate.

---

## 5. What must not regress

A redesign is the easiest place to lose a hard-won behaviour. These are the ones to guard,
each with a test that already pins it:

| Behaviour | Pinned by |
|---|---|
| Today refuses to render a routine while the day mode is unknown | `src/test/todayHoliday.test.tsx` |
| A Holiday record that cannot be read fails rather than defaulting | `src/test/holidayReadModel.test.tsx` |
| A stale set write fails closed | `worker/test/ordinarySetCas.test.ts` |
| An unreadable input type refuses logging | `src/test/settingsFailClosed.test.tsx`, `worker/test/inputTypeRepairFlow.test.ts` |
| `kg_each` is never doubled | `worker/test/workoutModality.test.ts`, `src/test/workoutBandLogging.test.tsx` |
| A band records label + count, never kg | `worker/test/progressBandComparability.test.ts` |
| A started workout keeps its frozen snapshot | `worker/test/snapshotCompatibility.test.ts`, `programmeHistoryFreeze.test.ts` |
| Extra and scheduled stay distinct | `worker/test/extraProvenance.test.ts`, `src/test/extraIsolation.test.ts` |
| A programme conflict never auto-overwrites | `src/test/programmeStore.test.ts` |
| Correction audit semantics | `worker/test/workoutSetCorrection.test.ts`, `correctionDerivedTruth.test.ts` |

**Rule for the implementation round: none of these tests may be modified to accommodate a
visual change.** If a redesign makes one fail, the redesign is wrong.

### One accepted behaviour has no regression pin

`TrainingPage.tsx` renders `data-training-week="error"` and, in that branch, deliberately
does **not** fall back to the static Foundation week — "showing the default programme to
somebody whose real one could not be read would show them a session they may have edited
away."

Searching `src/test` and `worker/test` for `data-training-week`, or for that error string,
returns nothing. **This fail-closed behaviour is currently unasserted**, which makes it
exactly the kind of thing a redesign drops silently while every test stays green.

**Proposed (small, test-only, no production change):** add an assertion that a failed
programme read on `/training` renders the error branch and renders **no** session rows.
Flagged as item Q5 in `10_DEFERRED_AND_APPROVALS.md`.
