# Round 24 — correction report

**Same Round 24. Not Round 25, 24A or 24.1.**

Reviewed candidate `c0d6e7a2b66c2229c1c23315bf7d13a4f9ee60a6`.
Accepted pre-redesign baseline `7213f3b15fc0af6597e0ee236802357e16985084`.

Three blockers and one narrow polish. Nothing else was redesigned.

No merge · no deploy · no production D1 mutation · no Fresh Reset execution · no V1.

---

## Blocker 1 — the week-first screen could not add an exercise

**What was wrong.** `Add an exercise to Monday` was a `<Link>` to `/settings/exercises`.
The screen built to invert the axis put the user straight back on the
exercise-first path it exists to replace: to get one exercise onto Monday you
opened the Exercise Library, found that exercise, scrolled past its media form,
and ticked a weekday.

**What it does now.** Weekday → **Add exercise** → a focused panel listing the
exercises that may go on this day → it joins the end of the day → its
prescription editor opens on it.

Preserved exactly, and asserted:

| Rule | How |
|---|---|
| No duplicate exercise in one weekday | not offered, **and** refused in `add()` |
| An archived exercise cannot be added | not offered, **and** refused in `add()`; the save would refuse it too |
| Stable `exerciseId` | nothing here constructs or rewrites one |
| Deterministic positions | `compactPositions` over the whole day, the rule the server applies |
| At least one active exercise per weekday | unchanged — `validateProgramme` still refuses an empty day |
| No intermediate server write | choosing an exercise edits the **draft**; the only request is the whole-week save |
| Whole-programme CAS | unchanged: one all-or-nothing write on the revision the author read |

**The default prescription is not a new one.** `defaultSlot()` moved into
`programmeApi.ts` and both editors call it, so the Library card and this screen
cannot drift apart on what "3 × 10–15" means.

---

## Blocker 2 — a conflict could rebase a stale draft

**What was wrong.** The draft carried no revision. `current = draft ?? base`
meant an old draft survived a 409, the provider's reload replaced `base` with
the newer programme, and the next save read `programme.revision` — the NEW one.
An edit written against work its author had never seen could be saved as though
it had been written on top of it. That is exactly the silent overwrite
compare-and-swap exists to prevent.

**What it does now.** The draft carries the revision it was authored on:

```ts
type Draft = { revision: number; sessions: ProgrammeSessions }
```

- `commit()` states `current.revision` — the draft's own — never whichever is loaded.
- `stale = draft.revision !== programme.revision` disables saving entirely.
- Editing further keeps the pin: more edits are not a way of re-basing.
- On a 409 the server's current programme is adopted, which is what makes the
  draft provably stale rather than merely flagged.
- The one way forward is explicit: **Discard my edits and load the latest**,
  which says in the banner that the unsaved edits will be permanently lost,
  clears the draft and the open editor, then re-reads.

There is deliberately **no "save anyway"**. There is no merge yet, and saving
anyway is the overwrite.

---

## Blocker 3 — the active workout was still a session overview

**What was wrong.** Resume workout, collapsed exercise cards, the whole app's
navigation. Better looking than what it replaced, and still not a gym screen.

**What it does now.** **Continue workout** opens a focused workspace. It is
entered deliberately and left deliberately — it is not what happens when you
tap Start, because this page is also how somebody looks a session over.

It shows session progress, the current exercise and its position, the demo
media, the current unresolved set with modality-correct controls, a full-width
**Complete set** with Skip beside it, the sets already logged for that exercise
with Undo, and named movement to the next and previous exercise.

The refusals are the point:

- **It does not guess.** The opening exercise is the one holding the first
  PENDING set of the persisted workout (`firstPendingExercise`). A skipped set
  is resolved, so a skipped exercise is not re-opened.
- **It writes nothing on entry.** Opening it issues no request at all.
- **It does not move under you.** The opening exercise is derived ONCE, on
  entry. Finishing an exercise offers the next one; it does not perform it, and
  Undo stays reachable on the set just logged.
- **It invents no current set.** Every set resolved → *Workout complete*, and
  the overview stops offering the way in.
- **It changes no modality.** The set controls are literally the same
  component the accordion renders (`PendingSetControls`), so kg each still says
  per dumbbell, a band still has a label and a count and no kilogram field, and
  bodyweight still has no load field at all. One implementation, not two.

**Mobile.** The workspace asks the shell to stand the bottom bar down
(`useImmersive`) and Complete set pins to the bottom of the viewport. Two
targets a few pixels apart, pressed one-handed mid-set, is a mis-tap that costs
the user their place in the workout.

**Tablet / desktop.** Two columns from `lg` up — media beside the current-set
controls. At 834px the split was tried and rejected: minus the rail and gutters
it leaves ~650px, and two 320px columns shrink the media to a thumbnail and wrap
"Completed · 12 reps · 22.5kg each" onto three lines. The tablet gets the
stacked layout at a comfortable width, with the actions back in the flow.

**The accordion is untouched.** It remains *All exercises*, and its disclosure
contract is unchanged. Auto-opening is still not reintroduced.

---

## Polish — the Body weight card with nothing recorded

At a LIFETIME count of zero the card spent most of a phone screen on three empty
metric blocks — Latest —, Since previous —, Since first — — and a window
switcher for a history with nothing in it, pushing the only available action
below the fold. After the planned Fresh Start that is the state every account
opens on.

It now says *No weight recorded yet* once, and puts the form directly under it.
No trend is fabricated. The full layout returns unchanged the moment there is a
real measurement.

---

## Tests

Two new suites, 28 cases: `src/test/programmeWeekEditor.test.tsx` (11) and
`src/test/focusedWorkout.test.tsx` (17).

Each was **mutation-checked** — the fix reverted, the suite re-run:

| Mutation | Caught by |
|---|---|
| `add()` does nothing (the old link-only behaviour) | 3 add cases (+5 downstream) |
| archived exercises offered again | *never offers an archived exercise* |
| duplicates offered again | *never offers an exercise already on this weekday* |
| save states the LOADED revision, stale guard removed | *cannot be submitted as though written on the newer revision* |
| focus opens on exercise 0 instead of the first pending set | 2 selection cases |
| the mobile bar is left up | *stands the mobile navigation down* |
| a current set is invented when everything is resolved | 2 cases |
| focus auto-advances when an exercise finishes | *does not move the exercise out from under you* |

**Three existing assertions were changed, all for the deliberately changed
empty state, and none weakened:** the zero-measurement copy in
`progressBodyWeight.test.tsx` (×2, plus two that now seed a measurement so the
window switcher exists) and `progressMidnight.test.tsx` (×1). The
zero-measurement case now asserts the STRONGER claim — nothing recorded, no
fabricated change, no `[data-change]` node, and the add control reachable — and
a new case pins that the window switcher is absent with no history to window.
The windowed message is unchanged and still tested for the case it was written
for: measurements that exist outside the window.

---

## Evidence

Captured from the real built application against a local stub of the API — no
production system was contacted.

Focused mode: mobile 390×844 (kg_each current set, and a resistance-band current
set), tablet 834×1112, desktop 1440×900. Plus the Add-exercise panel, the
conflict state, the fresh-empty Progress card and the populated one for
contrast.

The full nine-screen × three-viewport sweep was re-run: **no page errors, no
horizontal overflow** on any of the 27.
