# Round 24 — Stage B: navigation and information architecture

The package offers two mobile models and asks the design review to **choose one and justify
it from current V2 truth**. This document does that, and then fixes the two real IA defects
the audit found, which are not in the tab bar at all.

---

## 1. The decision

**Adopted: the alternative model — Today · Training · Progress · Calendar · More.
No centre action.**

This is the bottom bar the app already has. The redesign keeps it deliberately, and spends
the IA budget on the two places navigation is actually broken.

### Why the centre action was rejected

The package's own constraint on the centre action is: *"It must not create a second
conflicting workout truth path."* In V2 as it stands, a global Start/Continue button cannot
satisfy that constraint without moving a great deal of resolution into the shell.

Deciding what a centre button should even *say* requires, all at once:

| Question | Where the answer lives today |
|---|---|
| Does today plan a session at all? | the Today agenda — a Holiday with Training Off plans none |
| Which session? | the gym item's own `to` link, parsed in `TodayPage` |
| Has today been flexed to Recovery? | `useTrainingFlex` (`GET /api/training-flex`) |
| Has the scheduled workout already been started? | `useScheduledStarted` → `GET /api/workouts/:date/:sid` |
| Is an **Extra** in progress instead? | a second, separate occurrence read |
| Is the account's programme even readable? | `ProgrammeProvider` |

Six reads, four of which have their own loading and error states. A centre action must
therefore either (a) hoist all six into `AppShell` and render a button that is disabled and
unexplained on every screen while any one of them is unresolved, or (b) guess — and guessing
is precisely how a 409 the user "should never have been able to trigger" gets triggered.
`useScheduledStarted` already documents that trade-off in V2 and chooses not to guess.

There is also a plain product argument. The centre slot's value is that it is always the
same action. Here it would mean six different things — Start, Continue, Continue *the Extra*,
"today is Recovery", "today is a Holiday with training off", "we don't know yet" — which is
not a button, it is a status display in the shape of one.

### What replaces it

**A contextual resume bar, not a tab.** A slim bar sits directly above the tab bar **only
while the server says a workout is started and unfinished**:

> ▸ **Continue · Back Width + Biceps** — 9 / 17 sets

It answers the package's acceptance question *"Can the user resume an active workout
immediately?"* with **yes, from anywhere** — and it is honest, because it does not exist
when there is nothing to resume. There is no state in which it has to be disabled and
unexplained, because "unknown" simply renders nothing.

Cost, classified honestly (see `08_DATA_API_IMPACT_MATRIX.md`, row S6):

- covering the **scheduled** workout is **API-ok** — one `GET /api/workouts/:date/:sid`,
  the same read `useScheduledStarted` already performs, with today's session id derived
  from the programme already loaded above the shell
- covering an in-flight **Extra** as well needs a second read per navigation, or a new
  `GET /api/workouts/active` — **deferred**, and the only contract change the entire
  redesign surfaced

---

## 2. The two IA defects that actually matter

Both were found by reading the source, and neither is in the tab bar.

### IA-1 · The Programme Builder has no entry point

`SettingsPage.tsx` links to `/settings/exercises` (Exercise Library) and to nothing else.
The programme-editing UI — `ExerciseProgrammeCard` — is rendered **only** inside
`ExerciseMediaEditorPage`, at `/settings/exercises/:id`.

So the route to editing your training week is:

> Settings → Exercise Library → pick an exercise → scroll past its media editor → find the
> card that edits which weekdays that exercise appears on.

There is no screen anywhere in the app that shows a weekday and what is in it. The user
cannot answer "what does my Monday look like?" from the editor at all.

**Fix:** a `Programme` destination under Settings, and a secondary link from Training.
Route: `/settings/programme`. This is new UI over the existing `PUT /api/programme`.

### IA-2 · The programme is edited exercise-first, but it is *lived* week-first

The existing card is genuinely well built — one all-or-nothing write, identity never moves
on rename, explicit move up/down instead of drag-and-drop — and all of that is preserved.
But its axis is inverted relative to how the thing is used. It asks *"which weekdays does
Lat Pulldown appear on?"* The user's question is *"what is my Monday?"*

**Fix:** invert the entry point, keep the model. Day tabs → ordered exercise list for that
day → prescription in a focused sheet. Move up/down stay explicit buttons.

This costs nothing on the server: `PUT /api/programme` already takes the entire
`{exercises, sessions}` payload on `expectedRevision` and applies it all-or-nothing. The
new screen builds the same request from the other direction. **UI-only.**

### IA-3 · Active Workout is not a destination, it is an accordion

Not strictly a navigation defect, but it is where the IA fails hardest in practice. See
`04_SCREEN_BLUEPRINTS.md` §3. `/exercises/:id` sounds like the workout screen and is not —
it is a read-only media and prescription page. The actual logging surface is
`/training/:session`, rendering every exercise of the session as a collapsed accordion with
small wrapped form fields inside.

**Fix:** a focused presentation of the same route. No new route is required, and no new API.

---

## 3. The final IA

### Mobile — bottom bar, 5 slots

| Slot | Destination | Why it earns a slot |
|---|---|---|
| 1 | **Today** | the default route; the daily entry point |
| 2 | **Training** | the week, and the way into a session |
| 3 | **Progress** | the "am I improving?" answer; opened often |
| 4 | **Calendar** | date-oriented truth; opened often enough |
| 5 | **More** | sheet → Achievements, Settings |

Plus the **contextual resume bar** above the tab bar when, and only when, a workout is in
progress.

Active Workout **hides the tab bar** while in focused mode. The sticky action bar owns the
bottom of the screen during a workout; a tab bar underneath a Complete-set button is a
mis-tap waiting to happen in a gym.

### Tablet — 96px icon rail

All six destinations listed directly. "More" is a mobile-only concept and does not exist
here. The rail is 96px rather than 76px because "Achievements" does not fit at 76.

### Desktop — 240px sidebar

All six with icon + label. Selected state is an `accent-soft` fill with a 3px
`accent-edge` inset marker, not a heavy block. Page content stays the visual focus.

### Route map — unchanged except for one addition

```
/login
/                       → /today
/today
/training
/training/extra
/training/:session      ← Active Workout renders here, in focused mode
/exercises/:id
/progress
/calendar
/achievements
/settings
/settings/exercises
/settings/exercises/:id
/settings/programme     ← NEW (IA-1)
```

One added route. Nothing moved, nothing removed — so no bookmark, no notification deep
link and no test navigation path breaks.

---

## 4. Page hierarchy rules

Every screen answers three questions in this order:

1. **What is this page?** — page header: eyebrow, title, one line of subline. Never more.
2. **What matters most right now?** — exactly one hero or one primary metric row.
3. **What can I do next?** — exactly one visually dominant action.

Enforced by three prohibitions:

- **One primary CTA per screen.** Everything else is secondary, ghost, or a link. Today
  currently offers Start *and* the flex choice at comparable weight; after the redesign the
  flex choice is a quiet text button under the primary.
- **No duplicated navigation inside page content.** A page does not link to itself, and
  does not re-list the tab bar.
- **No repeated explanation.** A rule is explained once, at the point it applies. The
  "kg each is per dumbbell" note lives on the set that uses it, not on four screens.

---

## 5. Cross-screen continuity

| From → To | Contract |
|---|---|
| Today → Training | Today is the fastest entry into today's training truth. Its hero *is* today's session. |
| Training → Active Workout | Training selects, starts, resumes. Active Workout executes. Start is server-authoritative and lives in exactly one place per occurrence. |
| Active Workout → Progress | Completion may show a summary built **only** from the sets just logged, and link to Progress. It fabricates no analytics. |
| Calendar | Date-oriented exploration. It is **not** a second Today engine and must not acquire completion controls for arbitrary days. |
| Achievements | Derived showcase. No manual counters, ever. |
| Settings | Configuration. It does not compete with the training experience, and it holds Programme and Exercise Library. |

---

## 6. The package's acceptance questions, answered

| Question | Answer |
|---|---|
| Today's workout in one or two taps? | **One.** Open the app → Today → the hero's Start button. |
| Resume an active workout immediately? | **Yes, from any screen**, via the contextual resume bar — which exists only when there is something to resume. |
| Is Progress always easy to reach? | Yes — a permanent bottom-bar slot and a permanent rail entry. |
| Are Calendar and Achievements discoverable? | Calendar has its own slot. Achievements is one tap into More on mobile and directly in the rail on tablet/desktop. |
| Is Settings accessible without occupying premium space? | Yes — under More on mobile, directly in the rail otherwise. |
| Only one clear path to write workout truth? | **Yes.** Start is offered by the occurrence's own screen and by Today's hero, which links to it. The resume bar navigates; it does not write. The centre action was rejected precisely to keep this true. |
| Does mobile avoid becoming a mini desktop sidebar? | Yes — bottom bar and sheets on mobile, rail only from 768px. |
