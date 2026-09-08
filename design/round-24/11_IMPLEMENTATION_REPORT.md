# Round 24 — implementation report

**Same Round 24, continued into source (Q8, approved). Not Round 25.**

Blueprint reviewed at `1753862e2978dc744c745ce24f83f401d31f7c8f`.
Accepted pre-redesign baseline `7213f3b15fc0af6597e0ee236802357e16985084`.

No merge · no deploy · no production D1 mutation · no Fresh Reset execution · no V1.

---

## 1. What was built, against the locked decisions

| Decision | Built |
|---|---|
| **Q1** dark/electric-blue palette superseded | `src/design/tokens.css` is a light system: warm off-white canvas, white cards, near-black ink, lime accent as a fill with ink on it, blue demoted to informational. The ambient radial wash and the dark-ground inset shadow are deleted rather than recoloured; `color-scheme: light`; `index.html` and the web manifest follow. A compatibility shim re-points every legacy token name, so the flip landed without touching 147 call sites, and the screens were then migrated to role names as each was rebuilt. |
| **Q2** Today / Training / Progress / Calendar / More · no centre FAB | Bottom bar unchanged in structure and restyled to an opaque white plane with an `accent-edge` active marker (a bare lime hairline is near-invisible on an off-white canvas). No centre action exists. Resume is contextual: Today's training hero says **Continue workout** with a real progress rail, and only when the server says the workout is started. |
| **Q3** `/settings/programme`, week-first | **New screen.** Day tabs → ordered exercises → one focused editor per slot. Reached from Settings *and* from Training. The write is unchanged: whole programme, all-or-nothing, on `expectedRevision`. |
| **Q4** no goal weight | No goal line, value or field exists anywhere in the source. Nothing was fabricated to stand in for one. |
| **Q5** optional client-only rest timer | **Not built.** See §5 — it is the one approved item deliberately left out, and why. |
| **Q6** three test-hardening items + the `node:sqlite` gap | All four done. See §4. |
| **Q8** extend into source | This report. |

### Visual review directives

- **Today** — hierarchy kept: header → week strip → training hero → metrics → the rest of the day. The hero is pinned above the routine on any day that plans training.
- **Progress** — no goal line. Card titles promoted from 11px uppercase micro-caps to real headings; the page had exactly one real heading before and now has a hierarchy.
- **Programme** — a row is a row; the editor opens focused beneath the row it belongs to, rather than every field for every day being expanded at once.
- **Active Workout** — the giant instructional boxes are gone, the set row is a gym control rather than a form, and demo media now lives inside the workout.

---

## 2. The two screens that changed most

### Active workout / set logging

Before: a `flex-wrap` row of ~30px text inputs with a ~34px Complete beside them, repeated identically for every set, inside a collapsed accordion, with no media and nothing saying which set you were on.

Now:

- the first unresolved set is promoted to a **current-set card** with a `Current set` badge and an accent border — the layout answers "which set am I on"
- every numeric value is a **56px stepper beside a 56px field**; inputs are 16px so iOS never zooms on focus mid-set
- **Complete is a full-width 56px primary**; Skip is plainly secondary
- a resolved set shows exactly what was stored, with a numbered tile, and **a skipped set says "Skipped · Not a completed set"** so it can never read as success
- a set whose modality cannot be read states its refusal in a **banner**, not a caption
- **demo media is inside the workout** — checking form was a two-navigation round trip that destroyed accordion state and scroll position
- the workout **closes**: at 17/17 the header says *Workout complete · Every set is resolved*, not "Resume workout"

**What did not change:** every pending set still owns its own labelled inputs and its own Complete, because logging out of order is legitimate; the load field is still **never prefilled**; the modality still comes from the frozen snapshot; the stepper is an input aid and the typed value stays the authority.

### Programme

The editor existed but was reachable only through Exercise Library → an exercise → its media editor, behind a link labelled "Edit media", and it could say "Lat Pulldown is step 3 of 6 on Monday" without ever showing Monday.

`/settings/programme` inverts the axis and keeps the model: one all-or-nothing compare-and-swap write, explicit Move up / Move down naming both the exercise and the day, positions rewritten from array order, and identity never touched — renaming and archiving stay in the Library, which owns it.

Two defects fixed on the way: number fields no longer snap to `0` when cleared (they hold a local draft and commit on blur, so changing 10 to 15 on a phone no longer flashes an error on every keystroke), and validation is now reported **per weekday, all issues at once**, next to the day it belongs to.

---

## 3. Truth preservation

Every accepted V2 truth contract is intact, and the suite that pins each one passes.

| Truth | Status |
|---|---|
| `kg_each` is per dumbbell, never doubled | unchanged; the label now also carries an inline "Per dumbbell — never a combined weight" hint |
| Band = label + count, never kg | unchanged; the band control still has no kg field at all |
| Bodyweight invents no load | unchanged; no load field is rendered |
| Per-side records "10 / side", never doubled | unchanged |
| Unreadable modality refuses logging | unchanged, and now stated in a banner instead of a caption |
| Load inputs never prefilled | unchanged — and re-verified, because the blueprint's own prototype had violated it |
| Started workouts render from the frozen snapshot | unchanged |
| Stale writes fail closed | unchanged |
| Programme write is one atomic CAS; conflict never auto-overwrites | unchanged, on the new screen too |
| Extra / Recovery / Holiday / Scheduled stay distinct | strengthened — see below |
| Today refuses to render a routine while day mode is unknown | unchanged |
| Training refuses to fall back to the default week | unchanged, **and now tested** |
| Achievements `unresolved` ≠ `locked` | unchanged |
| Progress derives from persisted truth | unchanged |

**Three truth-adjacent fixes made:**

1. **`useScheduledStarted` now exposes `status`.** Treating an unknown read as "started" is correct fail-closed *disabling*; stating the positive fact "today's session is already under way" from that same unknown is not, and the flex card used to do exactly that.
2. **Settings no longer hardcodes `Mode: Home`.** It was a literal in an array that read no Holiday state, so an account on Holiday was told "Mode: Home" on the screen whose job is stating configuration. The row is removed; Today and Calendar own day mode and read it properly.
3. **Extra is an outline chip, and UI state has its own ink-filled `current` badge.** The blueprint's own tokens had made the Extra provenance chip byte-identical to the accent, and reused it for "Now"/"Current"/"In progress" — which would have made a provenance signal stop being a signal.

---

## 4. Q6 — test hardening

**The `node:sqlite` gap was real and worse than reported.** Six suites — including **both Fresh Start suites** — failed to load under the project's jsdom environment and had *never executed here at all*: 106 tests, silently absent.

- **Fix:** those six files declare `// @vitest-environment node`, and `src/test/setup.ts` applies its DOM shims only where there is a DOM (it threw `ReferenceError: window is not defined` before a single test could run). Narrow, and confined to the runtime gap — no unrelated test-suite cleanup.
- **Q6 A:** `migration0015` added to the Fresh Start operator chain. The chain stopped at `0014`, so the operator path had never run against the schema as it stands.
- **Q6 B:** `FRESH_START_PRESERVED_TABLES` completed with `programme_revisions`, `programme_exercises`, `programme_slots`, `company_holiday_preferences`.
- **Q6 C:** `src/test/trainingFailClosed.test.tsx` — three cases pinning that a failed programme read shows the failure, offers exactly one retry with no automatic retry loop, and lists **no** Foundation session. **Mutation-checked:** making the error branch fall back to the default week fails all three.

---

## 5. What was deliberately not built

**The rest timer (Q5, approved).** Nothing in the blueprint depends on it, and adding a new feature to the same commit that rewrites every screen makes both harder to review. It stays approved and unbuilt; it is a small, self-contained follow-up.

**Auto-opening the exercise being worked on.** Built, then reverted. It reads well in a gym but takes the disclosure out of the user's hands: the panel opens itself on Start, so the user's own tap on that row then *closes* it, and finishing an exercise moves the open panel out from under them mid-scroll. It also fights the accordion's tested disclosure contract, and accommodating it would have meant rewriting ten tests. Carried to Development Directions, where it belongs with a real focused-workout mode.

---

## 6. Test status

**2673 tests · 113 files.** The baseline had 2564 passing with 8 files failing to load.

Two tests fail **intermittently**, and both were proven pre-existing by running them on a clean worktree of `7213f3b1` with none of this round's changes present:

| Test | Baseline `7213f3b1` | This branch |
|---|---|---|
| `calendar > turns training on and keeps it` | flaky — passed twice, failed on the third run | flaky, same rate |
| `trainingNavigation > leaves normal Back working through the whole trail` | **failed 4 of 4 runs in isolation** | fails ~3 of 4 |

Neither is a Round 24 regression, and neither was fixed by Round 24. Both are timing-sensitive and load-dependent. They are reported rather than patched: making them pass would mean changing what they assert, and neither is asserting something this round touched.

---

## 7. Responsive evidence

Captured from the **real built application** running against a local stub of the API — no production system was contacted — at `390 × 844`, `834 × 1112` and `1440 × 900`.

Nine screens × three viewports = 27 captures: Today, Training, Active Workout, Progress, Calendar, Achievements, Settings, Exercise Library, Programme.

Verified headless on every one: **no page errors, and no horizontal document overflow.**
