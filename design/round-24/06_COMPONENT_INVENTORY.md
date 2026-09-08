# Round 24 — component inventory

Live specimen: `prototype/system.html`.

**Principle:** do not force abstractions the codebase does not need. V2 already has good
primitives — `Card`, `PageHeader`, `IntensityBadge`, `EmptyShell`, `BottomNav`, `SideNav`,
`MoreSheet`, `BrandMark`, `TrendChart`. Most of the work is **restyle plus a handful of
genuinely missing pieces**, not a new library.

Status key: **KEEP** (exists, restyle only) · **EXTEND** (exists, gains a variant or a prop)
· **NEW** (does not exist) · **RETIRE** (should stop existing).

---

## 1. Shell and navigation

| Component | Status | Notes |
|---|---|---|
| `AppShell` | **EXTEND** | New container widths (100% / 720 / 1120), new gutters (20 / 32 / 40), rail 96px at tablet. Gains a `focus` mode that hides the bottom bar for Active Workout. |
| `BottomNav` | **KEEP** | Restyle: white translucent ground, `accent-edge` active pill, `ink` active label. Same 4 + More structure, same `layoutId` indicator. |
| `SideNav` | **KEEP** | Rail widened 76 → 96px so "Achievements" fits. Active state becomes `accent-soft` fill + 3px `accent-edge` inset marker instead of `blue/15`. |
| `MoreSheet` | **KEEP** | Restyle to the light sheet spec (28px top radius, `line-strong` grab handle). |
| `BrandMark` | **KEEP** | Ink tile with a lime `V`; wordmark accent moves from blue to `accent-ink`. |
| `ResumeBar` | **NEW** | The contextual "Continue · <session> — n / m sets" bar above the tab bar. Renders **only** when the server says a workout is started and unfinished; renders nothing while unknown. Navigates; never writes. |

## 2. Page furniture

| Component | Status | Notes |
|---|---|---|
| `PageHeader` | **KEEP** | Eyebrow `ink-3` instead of blue; title 700 not 800; keeps `actions`. |
| `SectionHeader` | **NEW** | `h2` + optional right-hand link or count. Today, Training and Progress each hand-roll this today. |
| `Card` | **EXTEND** | Gains `flush` (zero padding, clipped — for divided row lists) and `quiet` (dashed, no shadow, transparent — for secondary blocks). Keeps the `style` escape hatch the media aspect ratio needs. |
| `HeroCard` | **NEW** | 28px radius, 24px padding, optional accent wash. Used by Today, Training and the Achievements feature. |
| `MetricCard` | **NEW** | Icon tile + large tabular value + label. Currently open-coded in `ProgressPage` as `Stat`. |
| `EmptyShell` | **RETIRE → `EmptyState`** | The current component exists to say "this arrives in a later round". The one remaining use — Today's "Weight check-in" — promises a feature that shipped in Round 15. Replace with a real `EmptyState`: icon, title, one line, one action. |
| `LoadingState` | **NEW** | Skeletons shaped like the content they replace, not a spinner. A spinner remains correct only for an in-flight *action*, never for a page load. |
| `ErrorState` / `Banner` | **NEW** | One component, four tones (`info` / `success` / `warn` / `danger`), title + body + optional actions. Today, Training, Progress, Settings and the session page each hand-roll their own error row with slightly different wording and retry affordances. |

## 3. Controls

| Component | Status | Notes |
|---|---|---|
| `Button` | **NEW** | Variants `primary` (accent fill + `accent-edge` border + ink label) · `ink` · `secondary` · `ghost` · `danger`. Sizes `sm` 36 / default 44 / `lg` 56. `block`. Disabled = 45% + `aria-disabled`. Currently every button in the app is a bespoke `className` string. |
| `IconButton` | **NEW** | 44px square, `line-strong` border. **Requires** `aria-label` — the type makes it non-optional. |
| `PillTabs` | **NEW** | Segmented control. Selected pill is an **ink fill** with `ink-on-dark` text (14.9:1). Horizontally scrollable with hidden scrollbar. `role="tablist"` / `role="tab"` / `aria-selected`. Used by Progress ranges, Library filters, Programme day tabs, Library input type. |
| `Badge` | **EXTEND from `IntensityBadge`** | Same component, more variants: HARD / LIGHT / PUMP, Scheduled / Recovery / Extra / Holiday, done / skipped / late / info / neutral / outline. **Every variant renders an icon and a word** — see §7. |
| `Field` | **EXTEND** | The existing `Field` inside `WorkoutSetList` becomes shared. Label always present and associated. 16px font. `line-control` border (3.2:1). `aria-invalid` + `aria-describedby` on the error. |
| `GymStepper` | **NEW** | 56px −/value/+ for load, reps and seconds. `inputMode` per type. Steps by a modality-appropriate increment (2.5 kg, 1 rep, 5 s). The typed value is still the authority; the buttons are a convenience. |
| `Checkbox` | **NEW** | 20px, `accent-edge` accent colour, 44px hit area, label association. |
| `Select` | **NEW** | Matches `Field` metrics. Used for result kind in the Programme editor. |

## 4. Training-specific

| Component | Status | Notes |
|---|---|---|
| `SessionCard` | **NEW** | Day + intensity + status badges, focus, exercise/set counts, chevron. Replaces the open-coded `Card` in `TrainingPage`. |
| `WeekStrip` | **NEW** | Rolling 7 days ending today. Today is an ink pill; each day carries a marker dot **plus a visually hidden label** naming what the marker means. |
| `ExerciseRail` | **NEW** | The session's exercises as a compact ordered list with done / current / pending state. Derived from the set array already loaded. |
| `ExerciseHero` | **NEW** | Media frame + modality badge + name + target + equipment. |
| `SetRow` | **EXTEND from `WorkoutSetList`'s rows** | Three states: pending / completed / skipped. Completed carries exactly what was stored; skipped is amber and never reads as success; a corrected set carries a `Corrected` chip. |
| `CurrentSetCard` | **NEW** | The focused single-set editor: modality-appropriate controls, suggestion chip, and the sticky action bar. |
| `LoadInput` | **NEW** | `GymStepper` + `kg` / `kg each` unit label. Renders the "per dumbbell" note when the unit is `kg_each`. |
| `BandInput` | **NEW** | Band label (text) + count (numeric) + result. **No kg field exists on this component at all** — the absence is the feature. |
| `BodyweightInput` | **NEW** | Result only (reps or seconds), per-side aware. **No load field exists.** |
| `RestTimer` | **NEW** | Client-only. Writes nothing, persists nothing, never blocks a set. |
| `ProgressRail` | **NEW** | The thin `role="progressbar"` bar. Exists in `TrainingSessionPage`; becomes shared. |
| `ExerciseMedia` | **KEEP** | Contain/full-fit behaviour and its `resolution` states are already correct and stay untouched. |

## 5. Progress, Calendar, Achievements

| Component | Status | Notes |
|---|---|---|
| `TrendChart` | **KEEP** | Restyle to the chart language in `02_DESIGN_SYSTEM.md`. Gains a goal rule and a current-value callout. |
| `BarChart` | **NEW** | Sessions per week. One highlighted bar. |
| `PersonalBestCard` | **KEEP** | Restyle; **grouping by modality is preserved exactly**. |
| `ExercisePerformanceCard` | **KEEP** | Restyle. Band performance keeps its no-load-curve presentation. |
| `RecordedWorkoutSets` / `RecordedSetEditor` | **KEEP** | Restyle; move behind a disclosure so a workout card is scannable. Correction semantics untouched. |
| `BodyWeightCard` | **KEEP** | Restyle. |
| `CalendarGrid` | **EXTEND** | 44px minimum cells, up to two marker dots per day, `aria-pressed` selection, and a legend. Every dot has a hidden text label. |
| `DayDetailCard` | **NEW** | Selected-day summary + the one contextual action that day legitimately allows. |
| `MilestoneCard` | **NEW** | Three states, matching `MilestoneState` exactly: `unlocked`, `locked` (with honest progress), **`unresolved`** — which is rendered as its own amber state and must never be drawn as locked. |

## 6. Settings, Library, Programme

| Component | Status | Notes |
|---|---|---|
| `SettingsGroup` | **NEW** | Section header + divided card of rows. |
| `ListRow` | **NEW** | Lead tile + title + subtitle + trailing badge/chevron/action. The most-repeated pattern in the app; currently open-coded in at least six places. |
| `ExerciseRow` | **NEW** | Name + input-type badge + media status + weekday usage. |
| `ExerciseEditor` | **KEEP** | `ExerciseMediaEditorPage` composition, restyled. |
| `ProgrammeDayEditor` | **NEW** | Day tabs → ordered slot list → prescription sheet. Move up/down stay explicit buttons with real accessible names. |
| `PrescriptionSheet` | **NEW** | Sets / result kind / target min–max / per side / equipment. A bottom sheet on mobile, an inline panel from 768px. |
| `ConflictBanner` | **NEW** | The 409 presentation: show that it happened, offer the newer version, keep the user's edits, **never auto-overwrite**. Used by Programme and by Holiday. |
| `NotificationSettingsCard` | **KEEP** | Restyle. Must not acquire a "read my subscription" call — no such endpoint exists, deliberately. |
| `FoundationStartCard` | **KEEP** | Restyle. Keeps its fail-closed error state. |

## 7. Rules every component obeys

1. **No status by colour alone.** Every badge renders an icon **and** a word. Every calendar
   and week-strip marker carries a visually hidden text label. This is what makes the
   deliberate hue overlap between session intensity and day resolution safe, and what makes
   `forced-colors` mode degrade to legible rather than ambiguous.
2. **44px minimum, 56px in the gym.** Nothing tappable is smaller than 44px anywhere.
   Complete set, Skip, and the load/rep steppers are 56px.
3. **16px inputs.** iOS zooms on focus below 16px. A zoom mid-set is a real failure.
4. **Every icon-only control has an accessible name**, and `IconButton`'s type requires one.
5. **A component that can fail renders its own failure.** Loading, empty, error, saving,
   saved, conflict and refused are component states, not page-level afterthoughts.
6. **Truth-bearing components never fabricate.** `BandInput` has no kg field.
   `BodyweightInput` has no load field. A skipped `SetRow` is never green. An `unresolved`
   `MilestoneCard` is never drawn as locked.
7. **One card, one job.** No card inside a card inside a card. The deepest legitimate
   nesting is `Card > list > ListRow`.

---

## 8. Rough build order

1. tokens + `Button`, `IconButton`, `Badge`, `Field`, `Banner`, `EmptyState`, `LoadingState`
2. `AppShell`, `BottomNav`, `SideNav`, `MoreSheet`, `PageHeader`, `SectionHeader`, `Card`
3. `HeroCard`, `MetricCard`, `ListRow`, `PillTabs`, `ProgressRail`
4. Today: `WeekStrip` + hero + agenda
5. Training: `SessionCard` + hero
6. **Active Workout**: `ExerciseHero`, `CurrentSetCard`, `LoadInput`, `BandInput`,
   `BodyweightInput`, `SetRow`, `ExerciseRail`, `RestTimer`, sticky bar — the largest and
   highest-value block
7. Progress: charts, PBs, performance, recorded sets
8. Calendar, Achievements
9. Settings, Library, `ProgrammeDayEditor` + `PrescriptionSheet` + `ConflictBanner`
10. `ResumeBar` last — it depends on the shell and on the workout read being stable

Steps 1–3 are the ones that make every later step cheap.
