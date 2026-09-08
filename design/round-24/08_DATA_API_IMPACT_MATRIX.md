# Round 24 — Stage F: Data / API impact matrix

**Rule this stage was written under:** do not invent backend or schema work because the
UI changed. Every proposal below is classified against the API and schema as they exist at
`7213f3b1`, verified by reading `worker/*/routes.ts` and `migrations/0001–0015`.

**Headline finding: the Round 24 redesign is almost entirely UI-only.**
Of 34 proposed experience changes, **29 are UI-only or client-state-only**, 4 are served by
the existing API with no contract change, and **1 optional convenience would need a new
endpoint — and it is deferred, not proposed for this round.**

No schema change is required by the redesign. None is proposed.

---

## 1. The API surface as it stands

Verified endpoint by endpoint from `worker/index.ts` and each `worker/<area>/routes.ts`.
Every route below requires the app session cookie; every non-`GET` additionally rejects a
cross-origin `Origin`.

| # | Method | Path | Purpose | Concurrency control |
|---|---|---|---|---|
| 1 | GET | `/api/auth/google/start` | Begin OIDC, redirect to Google | — |
| 2 | GET | `/api/auth/google/callback` | Verify identity, mint session | single-use `state` row |
| 3 | GET | `/api/auth/session` | Am I signed in | — |
| 4 | POST | `/api/auth/logout` | Revoke this device | — |
| 5 | GET | `/api/today/completions?from&to` | Completed Today occurrences in a range | — |
| 6 | PUT | `/api/today/completions/:occurrenceKey` | Mark complete | idempotent PK |
| 7 | DELETE | `/api/today/completions/:occurrenceKey` | Undo | idempotent |
| 8 | GET | `/api/exercise-media` | Whole media library | — |
| 9 | GET | `/api/exercise-media/:exerciseId` | One record | — |
| 10 | PUT | `/api/exercise-media/:exerciseId` | Set media | replace-by-PK |
| 11 | DELETE | `/api/exercise-media/:exerciseId` | Clear media | — |
| 12 | GET | `/api/exercise-input-types` | Whole input-type library | — |
| 13 | GET | `/api/exercise-input-types/:exerciseId` | One record | — |
| 14 | PUT | `/api/exercise-input-types/:exerciseId` | Set canonical input type | replace-by-PK |
| 15 | GET | `/api/programme` | The account's whole programme + `revision` | — |
| 16 | PUT | `/api/programme` | Save the **whole** programme | `expectedRevision` → **409 `programme_conflict`** |
| 17 | POST | `/api/programme/exercises` | Add a custom exercise | **409 `programme_conflict`** |
| 18 | GET | `/api/workouts/history?limit` / `?from&to` | Account-wide workout history | — |
| 19 | GET | `/api/workouts/:date/:sessionId` | Occurrence + sets + progress + `cancelable` | — |
| 20 | DELETE | `/api/workouts/:date/:sessionId` | Cancel an accidental Start | conditional delete |
| 21 | POST | `/api/workouts/:date/:sessionId/start` | Start; server freezes the snapshot | `expectedRevision`; PK decides a concurrent Start |
| 22 | POST | `/api/workouts/:date/extra/start` | Start an Extra from a source session | as above |
| 23 | PUT | `/api/workouts/:date/:sid/sets/:order/:index` | Complete or skip one set | compare-and-swap |
| 24 | DELETE | `/api/workouts/:date/:sid/sets/:order/:index` | Undo one set | compare-and-swap |
| 25 | PUT | `/api/workouts/:date/:sid/sets/:o/:i/correction` | Correct a recorded set + write audit | version-pinned |
| 26 | GET | `/api/progression/:date/:sessionId` | Derived guidance for a started workout | — |
| 27 | PUT | `/api/progression/:date/:sid/calibration/:order` | Record load feedback | replace-by-PK |
| 28 | GET | `/api/holidays?from&to` | Holidays in a range | — |
| 29 | POST | `/api/holidays` | Create | **409 `holiday_conflict`** |
| 30 | PUT | `/api/holidays/:id` | Edit | 409 conflict · **403 `holiday_immutable`** |
| 31 | PUT | `/api/holidays/:id/training` | Training On / Off for that day | 400 `holiday_not_trainable` |
| 32 | DELETE | `/api/holidays/:id` | Delete | 403 on a company holiday |
| 33 | GET | `/api/progress/weight?range&tz` | Body-weight series | — |
| 34 | PUT | `/api/progress/weight` | Save today's weight | replace-by-PK |
| 35 | DELETE | `/api/progress/weight/:date` | Delete one day's weight | — |
| 36 | GET | `/api/progress/performance` | Per-exercise performance | — |
| 37 | GET | `/api/settings` | Foundation start date | **500 `settings_unreadable`** (fails closed) |
| 38 | PUT | `/api/settings` | Save it | — |
| 39 | GET | `/api/training-flex?from&to` | Flex choices in a range | **500 `flex_unreadable`** (fails closed) |
| 40 | PUT | `/api/training-flex` | Set **today's** choice | refuses a started scheduled workout |
| 41 | GET | `/api/notifications/config` | VAPID public key | — |
| 42 | PUT | `/api/notifications/subscription` | Subscribe this device | replace-by-endpoint-hash |
| 43 | DELETE | `/api/notifications/subscription` | Unsubscribe this device | — |

**There is deliberately no `GET /api/notifications/subscription`** — a device reconciles its
own state rather than putting a push endpoint into a query string. The redesigned Settings
screen must keep that shape; it may not add a "read my subscription" call.

### Three API facts the redesign leans on

1. **`PUT /api/programme` already writes the whole week, all-or-nothing, on
   `expectedRevision`.** This is why the week-first Programme Builder (§2, row P1) costs
   nothing on the server: the write shape the new UI wants is the write shape that exists.
2. **`GET /api/workouts/:date/:sessionId` already returns the complete set list, the
   frozen snapshot, progress counts and `cancelable`.** This is why the focused Active
   Workout mode is UI-only: every field it renders is already on the wire.
3. **A workout is addressed by `(date, sessionId)`.** There is no "give me the workout
   currently in progress" endpoint. That is the one place a proposal touches the contract,
   and it is deferred (row N3).

---

## 2. The matrix

Classes used: **UI** (presentation only) · **CS** (client state / composition only) ·
**API-ok** (a call that already exists, used differently or from a different place) ·
**API-new** (a contract addition would be needed) · **SCHEMA** (a data-model change would
be needed).

### Shell, navigation, theme

| id | Change | Class | Why | Cost note |
|---|---|---|---|---|
| S1 | Dark navy theme → light system | **UI** | `src/design/tokens.css` values only. §8 of `tokens/vshape-light.css` re-points every existing token name, so no `className` has to change to flip the theme. | 1 file for the flip; a mechanical rename after |
| S2 | Delete `body::before` ambient gradient | **UI** | Cosmetic element in `tokens.css` | trivial |
| S3 | `color-scheme: dark` → `light`, `<meta name="theme-color">` `#0B1220` → `#F5F6F2` | **UI** | `tokens.css`, `index.html` | trivial |
| S4 | Bottom nav / rail / sidebar restyle | **UI** | `BottomNav.tsx`, `SideNav.tsx`, `MoreSheet.tsx` | small |
| S5 | Keep the 4+More bottom bar, reject the centre action | **UI** | No routing change; see `03_NAVIGATION_IA.md` for the reasoning | none |
| S6 | Persistent "Continue workout" bar above the tab bar | **API-ok** *(scheduled)* / **API-new** *(any occurrence)* | Scheduled: derive today's session id from the programme already loaded in `ProgrammeProvider`, then one `GET /api/workouts/:date/:sid` — the same read `useScheduledStarted` already performs. Covering an in-flight **Extra** as well needs a second read or a new endpoint → **deferred** (N3) | medium |
| S7 | Container widths, gutters, section rhythm | **UI** | `AppShell.tsx` | small |
| S8 | Add `Programme` and `Exercise Library` links to Settings | **UI** | `SettingsPage.tsx` — see finding A-IA-1: Programme Builder is currently **unreachable from Settings** | trivial |

### Today

| id | Change | Class | Why | Cost note |
|---|---|---|---|---|
| T1 | Training hero pinned above the routine on any day that plans training | **UI** | Reorders what `useToday` already returns. The gym item is *promoted*, not duplicated — it is withdrawn from the agenda list exactly as the existing Recovery path already withdraws it | small |
| T2 | Week strip (rolling 7 days, markers) | **API-ok** | `GET /api/today/completions?from&to`, `GET /api/workouts/history?from&to` and `GET /api/training-flex?from&to` are all range reads that already exist and are already used elsewhere | medium |
| T3 | Metric row (streak / weight / sessions this week) | **API-ok** | Streak from `useAchievements` sources; weight from `GET /api/progress/weight`; sessions from workout history — all three already read on other screens | medium |
| T4 | Replace the "Weight check-in" `EmptyShell` placeholder with a real link to Progress | **UI** | The placeholder promises a later round for a feature that shipped in Round 15 | trivial |
| T5 | Holiday / Recovery / unknown-day states restyled, semantics unchanged | **UI** | Same three branches `TodayPage` already renders | small |
| T6 | One primary CTA; "Recovery instead" demoted to a quiet control | **UI** | `TrainingFlexCard` and `TodayHero` merge visually; the write path is unchanged | small |

### Training

| id | Change | Class | Why | Cost note |
|---|---|---|---|---|
| R1 | Next-action hero on the Training list | **API-ok** | `useLocalToday` + programme + the same occurrence read Training already performs for the Extra card | small |
| R2 | Session cards show status (completed / in progress / scheduled) | **API-ok** | `GET /api/workouts/history?from&to` — already used by Progress | medium |
| R3 | Weekend rows restyled; Extra stays visually secondary and separate | **UI** | Presentation only. The Extra/Scheduled distinction is preserved verbatim | trivial |
| R4 | Session page → focused **Active Workout** presentation | **UI** | See A1–A6 | large (UI) |

### Active workout — the largest change, and it is UI-only

| id | Change | Class | Why | Cost note |
|---|---|---|---|---|
| A1 | Focused single-exercise mode replacing the all-exercises accordion | **UI** | `useWorkoutLog` already holds every set with `exerciseOrder`/`setIndex`. Focus mode is a different render of the same array, calling the same `complete`/`skip`/`undo` | large |
| A2 | Current-set card with 56px steppers and 16px inputs | **UI** | Replaces the wrapped small-field row in `WorkoutSetList.tsx`. Same three values, same validation, same payload | medium |
| A3 | Exercise media shown *inside* the workout | **API-ok** | `useExerciseMedia(exerciseId)` already exists; today it is only used on `/exercises/:id`. The exercise id is on every set as `exerciseId` | small |
| A4 | Sticky bottom action bar (mobile), inline (desktop) | **UI** | CSS + layout | small |
| A5 | Exercise rail showing position in the session | **UI** | Derived from the set array already loaded | small |
| A6 | Optional rest timer | **CS** | Local `useState` + `setInterval`. **Writes nothing**, persists nothing, never blocks a set. Deliberately not server state | small |
| A7 | Per-modality controls (weight / band / bodyweight / unreadable) | **UI** | Exactly the four branches `WorkoutSetList` already implements, restyled | medium |
| A8 | `kg each` explained inline as "per dumbbell" | **UI** | Copy only. `loadUnitLabel` unchanged | trivial |
| A9 | Modality-drift and stale-write notices | **UI** | `modalityVerdictAt` and the existing mutation-error path already produce both | small |
| A10 | Cancel-Start confirmation restyled | **UI** | `cancelable` already on the wire | trivial |

### Progress

| id | Change | Class | Why | Cost note |
|---|---|---|---|---|
| P1 | Range pills 30D/90D/6M/1Y/All | **API-ok** | `GET /api/progress/weight?range` already takes a range; `isBodyWeightRange` defines the allowed set. **Offer only the ranges that validator accepts — do not add a pill the API will 400.** | small |
| P2 | Body-weight line chart with goal line + current-value callout | **UI** | `TrendChart.tsx` restyle | medium |
| P3 | Sessions-per-week bar chart | **API-ok** | Derived from `GET /api/workouts/history?from&to` | medium |
| P4 | Personal bests grouped **by modality**, never ranked across | **UI** | `GET /api/progress/performance` already returns modality-separated data | small |
| P5 | Recorded sets behind a disclosure, correction entry preserved | **UI** | `RecordedWorkoutSets` / `RecordedSetEditor` restyle | medium |
| P6 | Band performance shown as reps at a stated band + count, with no load curve | **UI** | `formatPerformance.ts` already refuses to plot a band as a load | none |

### Calendar · Achievements

| id | Change | Class | Why | Cost note |
|---|---|---|---|---|
| C1 | Calendar grid restyle, day markers + legend + text labels | **UI** | Same data `useHolidays` / `calendarModel` already produce | medium |
| C2 | Selected-day detail card | **UI** | Same | small |
| C3 | Company-holiday immutability shown as a lock, not only as a failed write | **UI** | The 403 already exists; the redesign surfaces it *before* the attempt | small |
| H1 | Featured milestone + streak metrics + milestone grid | **UI** | `buildMilestones` returns all six with state | medium |
| H2 | **`unresolved` rendered as its own state, not as locked** | **UI** | `MilestoneState` already has three cases. Rendering `unresolved` as locked would claim "not earned" about a fact we could not read | small |
| H3 | "Why it was earned" evidence list | **API-ok** | Read from the same workout history the streak is derived from | medium |

### Settings · Exercise Library · Programme Builder

| id | Change | Class | Why | Cost note |
|---|---|---|---|---|
| G1 | Settings grouped into Account / Training / Reminders / App | **UI** | `SettingsPage.tsx` | small |
| G2 | Library: search, modality filter, media-status filter | **CS** | Filtering a list `useExerciseMediaLibrary` + `useProgramme` already hold in memory | small |
| G3 | Library rows show input type, media status, weekday usage | **UI** | All three already available client-side | small |
| G4 | Library row → detail editor (name, media, input type, archive) | **UI** | Exactly what `ExerciseMediaEditorPage` already composes | medium |
| **G5** | **Week-first Programme Builder** (day tabs → ordered list → prescription sheet) | **UI** | **`PUT /api/programme` already takes the entire `{exercises, sessions}` on `expectedRevision`.** The current exercise-first card (`ExerciseProgrammeCard`, reached only from an exercise's media page) builds that same payload from the other direction. Inverting the entry point changes no request, no response and no table | large (UI) |
| G6 | Move up / move down stay explicit buttons; no drag-and-drop | **UI** | Preserves keyboard operability. `compactPositions` already rewrites positions from array order | none |
| G7 | Validation issues shown per weekday before Save | **UI** | `validateProgramme` already returns typed `ProgrammeIssue`s client-side | small |
| G8 | Revision conflict: show both, never auto-overwrite | **UI** | The 409 handler already keeps the user's edits on screen | small |

### Cross-cutting

| id | Change | Class | Why | Cost note |
|---|---|---|---|---|
| X1 | One loading / empty / error / saving / conflict / refused vocabulary | **UI** | Component work; every state already exists in at least one screen | medium |
| X2 | 44px minimum tap target; 56px for in-gym primaries | **UI** | CSS | small |
| X3 | 16px inputs so iOS never zooms on focus | **UI** | CSS | trivial |
| X4 | Accessible names on every icon-only control | **UI** | Markup | small |
| X5 | No status by colour alone — icon + word on every badge | **UI** | Markup | small |

---

## 3. What is **not** proposed, and why

| id | Idea | Verdict |
|---|---|---|
| N1 | Persist the rest timer server-side | **Rejected.** It is not evidence of training. Storing it invents a data model for a stopwatch and creates a write path during a workout that can fail. Keep it in client memory. |
| N2 | A "workout summary" screen with new analytics after the last set | **Deferred.** A summary computed from the completed sets is UI-only and welcome; anything beyond that (calories, volume load across modalities, "intensity score") would be fabricated. Volume load in particular cannot be summed across a band set and a kilogram set. |
| N3 | `GET /api/workouts/active` — the currently in-flight occurrence, whatever it is | **API-new · deferred to Development Directions.** The resume bar covering the *scheduled* workout works today with one existing read. Covering an in-flight **Extra** as well needs either a second read per navigation or this endpoint. It is a convenience, not a requirement, and it is the only contract change the whole redesign surfaced. |
| N4 | Drag-and-drop programme reordering | **Rejected for this round.** It removes keyboard operability from the one screen a keyboard user most needs it on, and the lists are five items long. |
| N5 | Band-to-kg conversion so bands appear on the load chart | **Refused.** Explicitly OUT of Round 24 and false besides. |
| N6 | Merging Extra / Recovery / Holiday / Scheduled into one "workout" visual | **Refused.** Explicitly protected truth. They stay four distinct badges with four distinct words. |
| N7 | Making Programme Builder a top-level nav destination | **Rejected.** It is configuration. It gains a real entry point in Settings (S8) and a secondary link from Training, which is what it lacks today. |
| N8 | New "goal weight" field for the Progress chart | **SCHEMA — not proposed.** The prototype draws a goal line; there is no column for a goal. Either the line is dropped, or the field is a separate, separately-approved round. **Flagged for controller decision** — see `10_DEFERRED_AND_APPROVALS.md`, item Q4. |

---

## 4. Summary count

| Class | Count | Meaning |
|---|---|---|
| UI | 29 | presentation, layout, copy, component structure |
| CS | 2 | client state only (`A6` rest timer, `G2` library filtering) |
| API-ok | 12 | an endpoint that already exists, called from a new place |
| API-new | 1 | `N3`, deferred, not part of this round |
| SCHEMA | 0 | none required, none proposed (`N8` flagged as a question, not a plan) |

*Rows appear in more than one class where a change has both a presentation and a data-read
component; the counts are of matrix rows, not of files.*

**The redesign does not require a backend change.** The one endpoint it would benefit from
is a convenience for a resume affordance that already works without it.
