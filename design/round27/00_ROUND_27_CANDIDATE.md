# Round 27 — Small UX Polish & Navigation v1

Three narrow changes: a way into Admin, a countdown that stops treating the run-up
to Day 1 as dead time, and a shared-component gap closed. **This candidate is not
merged and not deployed. No production D1 was read or written, no production secret
or Foundation date was changed, and no migration was added.**

- Baseline / `main`: `7b6092b58260a81a8f43c3f5fe8b455df125f7e0`, confirmed against the
  GitHub remote with `git ls-remote` before any edit
- Branch: `claude/round-27-small-ux-polish`, cut directly from that SHA
- `git merge-base origin/main HEAD` is the baseline, and
  `git rev-list --left-right --count origin/main...HEAD` reports `behind=0`. No merge,
  no rebase, no rewrite.

No migration was added: the chain is still 0001–0015, unchanged from `main`.

---

## VT-13 — Admin entry in Settings

`/admin` was URL-only. On a personal app that is not a security boundary; it is the
owner having to remember and type a path. Settings now carries a **System** section
with one row, `Admin — System health and account facts`, sitting below Training and
above the App card, built from the same `SectionHeader` + `RowList` + `ListRow`
pattern the Training section already uses.

It routes internally through the existing router `Link` — same tab, no `target`, no
`rel` — which is what every other Settings row does.

**The row changes nothing about access, and that is the point.** Every fact on
`/admin` comes from an API that checks a server-side `google_sub` allowlist and fails
closed when that allowlist is unset. Round 26's authorisation is untouched: this round
edits no worker file, no `shared/admin.ts`, and adds no admin API. The row is not
conditioned on any client belief about who is an admin, because no such flag exists —
which is exactly the property Round 26 was built to have.

Screenshot 6 is the proof rather than the claim: following the row lands on `/admin`
and what renders is the server's refusal.

Admin was deliberately **not** added to the sidebar or the mobile bottom navigation. A
test asserts it appears in no `navigation` landmark.

## VT-02 — Prep Week countdown

Before Day 1 the page said "Foundation starts in 5 days" in a small eyebrow, above a
Foundation metric reading `—`. Correct, and quietly discouraging: it framed a week of
real training as a waiting room.

> **Correction 1.** The first cut of this treated `foundationStatus().phase ===
> 'upcoming'` as a synonym for Prep Week. It is not one. The Foundation start date is
> editable, so `upcoming` only means Day 1 has not arrived — equally true 30 or 60 days
> out — and the page could therefore have rendered **"PREP WEEK · 30 days until
> Foundation Day 1"**, naming a week that is nowhere near. That is the same class of
> untruth as a confident number for something unknown, and it is fixed below.

A new `PrepWeekNote` renders while, and only while, Foundation is `upcoming`:

> **PREP WEEK**
> 5 days until Foundation Day 1
> Your training still counts — everything you log now is kept.

The third line is the reason the component exists. The Round 25 reset happened once
and is finished; everything logged between now and Day 1 is real retained history, and
nothing about Day 1 removes it. A test asserts the note contains no reset, clear, wipe,
delete or start-over vocabulary, so it can never drift into implying a second reset.

**What it refuses to invent.** The count comes from `foundationStatus` — the one
accepted Foundation calculation — via `daysUntilStart`. Nothing re-derives a date and
no number is hard-coded to a particular day. It reads the *phase* rather than comparing
dates itself, so a prep note and a Day number cannot appear together.

**Prep Week is a window, defined once.** `src/features/today/prepWeek.ts` owns it:
the last seven calendar days before Day 1, `daysUntilStart` of `1..7` inclusive. Both
the note and the eyebrow ask `prepWeekDaysRemaining` rather than each interpreting the
phase for itself — two callers separately deciding what a phase means is exactly how
the original gap opened. It is its own module, not an export beside the component,
because it is a domain rule rather than a component.

Outside the window there is no note, so the eyebrow is the only thing that can speak,
and it says the true thing: `Foundation starts in 30 days`, with correct singular
handling if it is ever reached with 1.

**No Day 0, structurally rather than by a guard.** `upcoming` means `day < 1`, which
makes `daysUntilStart` at least 1 by construction. On Day 1 the phase becomes
`foundation`, the component returns null, and the normal Foundation state takes over
with nothing to dismiss and nothing to unwind. The eyebrow refuses to print a zero
even on a path the types say is unreachable: with no trustworthy count it falls back
to a bare "Foundation" rather than "starts in 0 days".

It renders **outside** the holiday branches on purpose: whether today is a company
Holiday is a fact the page may still be waiting for, but how many days remain until
Day 1 is not, so gating one on the other would blank the note for no reason. It is
still gated on `foundationStart.status === 'ready'` — a count derived from the default
while the account's real date is in flight is a number that changes under the reader.

**Inside the window the eyebrow gives up its arithmetic.** With the note printing the
count, the eyebrow printed it twice on one screen. It reads `Foundation · Prep week`
there, keeping its job (which phase) and staying parallel with `Foundation · Day 7`.
Outside the window it keeps the count, because nothing else is carrying it.

Nothing about completion, history or progression semantics changed. No persisted state,
no Prepare Mode in the database, no migration.

## VT-04 — Card / HeroCard semantic passthrough

**The audit found a real gap, not a component already doing this.** Both primitives had
closed prop lists — `Card` took `children`, `className`, `style`, `flush`, `quiet`, and
nothing else — so a caller could not give either an `id`, a `role`, an `aria-*`
attribute or a `data-*` hook. The evidence that this cost something is in the
repository: Round 26's Admin page wanted a `data-` marker on its maintenance card,
could not put one there, and settled for the surrounding `<section>` — a different
element from the one the test was about.

Both now spread the rest of their props onto their root, typed against the real element
(`<div>` for `Card`, `<section>` for `HeroCard`).

**What keeps it safe:**

- `className` is destructured, so it can never arrive inside `rest` and replace the
  merged classes. Merging behaviour is unchanged.
- `rest` is spread **before** `className`, so nothing that slipped through could win
  against the component's own styling.
- `flush`, `quiet`, `accent` and `tone` are the components' own vocabulary and are
  destructured out. None is an HTML attribute, and tests assert none reaches the DOM.
- `style` is no longer a named prop; it arrives through `rest` as an ordinary `<div>`
  prop, and a test proves the exercise media frame's runtime `aspectRatio` still lands.
- **`ref` is deliberately absent from both types.** Nothing forwards a ref to either
  component today, and adding one would be inventing a contract nobody asked for. The
  types say `ComponentPropsWithoutRef` and mean it.

The change is used immediately rather than left theoretical: `PrepWeekNote` gives its
`Card` a `role` and an `aria-labelledby`, so the eyebrow, the count and the reassurance
are one named group instead of three loose paragraphs.

Scope held to the two primitives named. `MetricCard`, `ListRow`, `RowList`,
`PageHeader` and `SectionHeader` were left alone — no caller in Round 27's surfaces
needs them opened, and widening them would be churn.

---

## Evidence

### New tests

`src/test/layoutPassthrough.test.tsx` (9) — each block asserts both halves: the prop
lands on the right element, **and** the styling, class merging and component vocabulary
are unchanged. Includes that the passthrough target is the styled root itself and not a
new wrapper.

`src/test/round27Polish.test.tsx` (19) — driven through the real router, the real
Foundation provider and the real pages. The Foundation date is seeded and every
countdown assertion is derived from that date and a faked clock, never written into the
test; `setDaysBefore(n)` counts back from `DAY_1` itself, so a test cannot quietly
disagree with the page about which day is "8 days before".

Covers: five days before (unchanged), one day before (singular "1 day"), exactly Day 1,
well after Day 1, and a boundary sweep over days 12–15 asserting no `0 days`, no
negative count and no `Day 0` anywhere on the page.

Correction 1 adds section **2b**: seven days before is Prep Week; **eight days before is
not**, and the eyebrow reads `Foundation starts in 8 days` with no "Prep week" anywhere;
thirty days the same; a real countdown at 9/14/60 days; the boundary flipping exactly
between 8 and 7 rather than somewhere near it; and no zero or negative count at any
distance, near or far.

### Mutation testing

Each load-bearing claim was broken on purpose, the suite run, and the mutation reverted.

| Mutation | Result |
|---|---|
| prep note renders in every phase, with `1 - day` as the count | **3 fail** |
| `Card` drops the passthrough spread | **3 fail** in layout, **2** in round27 |
| the Admin row points somewhere other than `/admin` | **3 fail** |
| **C1:** the window reverts to "upcoming means Prep Week" | **4 fail** |
| **C1:** window off by one, `1..8` | **2 fail** |
| **C1:** window off by one the other way, `1..6` | **2 fail** |
| **C1:** the far-out eyebrow says "Prep week" anyway | **3 fail** |

Baseline before and after each: 9 and 19 passed.

### Gates

| Gate | Result |
|---|---|
| focused batch — passthrough, Round 27, shell, today, todayHoliday, foundation ×3, settingsFailClosed, admin ×3 | **301 passed / 12 files** |
| typecheck | clean |
| lint | clean |
| production build | clean |

### Full suite, and two flaky tests that are not this round's

Two full-suite runs, and a **different** file failed each time — the signature of
timing, not of a defect.

| Run | Result |
|---|---|
| 1 (while screenshots were being captured, so the box was loaded) | 1 failed — `trainingNavigation` |
| 2 (clean, nothing else running) | 1 failed — `calendar` |
| 3 (Correction 1, again during screenshot capture) | 1 failed — `notificationDelivery` |

Three runs, three different files — the point stands and strengthens.

Both were then run in isolation, on this candidate **and on a worktree of the
untouched baseline `7b6092b`**:

| File | Tree | Runs | Failures |
|---|---|---|---|
| `trainingNavigation` | candidate | 5 | 1 |
| `trainingNavigation` | **untouched `7b6092b`** | 5 | **2** |
| `calendar` | candidate | 5 | 1 |
| `calendar` | **untouched `7b6092b`** | 15 | **2** |

Both reproduce on the baseline, with none of Round 27's code present.
`trainingNavigation` in fact failed *more* often there than on the candidate.

`Layout.tsx` is shared, so "unrelated" needed proving rather than asserting. Two
things settle it for `calendar`:

- The failing assertion reads
  `document.querySelector('[data-holiday-training]')`. That attribute is on a plain
  `<p>` in `CalendarPage.tsx` — never on a `Card` — so the passthrough cannot reach
  it. And the change could only ever *add* a surviving `data-` attribute, never
  remove one, so it cannot turn a found element into `undefined`.
- The error, `expected undefined to be 'on'`, means the editing sheet had not
  reopened yet. It is a timing failure in the test, and it is byte-identical to the
  failure this same test produced during Round 26.

`notificationDelivery`, the Correction 1 run's failure, is the simplest of the three:
it is a 30 s **timeout**, not an assertion, it passes 3/3 in isolation, and it lives in
`worker/` — which Round 27 does not touch at all (`git diff origin/main -- worker/` is
empty). Round 26 classified the same test the same way for the same reason. Both
full-suite runs that produced it were sharing the box with a headless Chromium and a
Vite dev server capturing screenshots.

Round 27 touches no calendar, training, router, shell or worker source —
`git diff origin/main -- src/features/calendar src/features/training src/app shared/ worker/`
is empty.

**Neither test was patched, skipped, quarantined or retried into green**, and no
unrelated product code was modified. They are reported as what they are.

## Screenshots

`design/round27/screenshots/`, captured from a **throwaway harness** that mounts the
REAL router, the REAL pages, the REAL auth provider and the REAL API clients. The only
substitution is the network: `fetch` is answered by the same in-memory stand-ins the
test suite drives. The pixels are the candidate's own components.

The account is a fresh one — no logged workouts, no measurements, no notification
configuration — so `0` and `—` on those screens are the honest defaults, not invented
figures. The one seeded fact is the Foundation start date, because that is what the
countdown is about. The page clock is pinned so each shot is reproducible.

**None of this is production data or production status.** The harness is git-ignored,
imported by nothing the app builds, and was deleted after capture.

| File | |
|---|---|
| `01-mobile-390-today-prep-week.png` | Prep Week, five days out, 390 |
| `02-mobile-390-settings-admin-entry.png` | Settings with the System → Admin row, 390 |
| `03-tablet-834-today-prep-week.png` | 834 |
| `04-desktop-1440-today-prep-week.png` | 1440 — sidebar carries no Admin link |
| `05-mobile-390-day-1-prep-gone.png` | Foundation Day 1: prep note gone, metric reads 1 |
| `06-mobile-390-admin-after-settings-click.png` | after following the row — the server's refusal |
| `07-desktop-1440-settings-admin-entry.png` | the Admin row at desktop width |
| `08-mobile-390-far-out-not-prep-week.png` | **30 days out: no note; eyebrow reads "Foundation starts in 30 days"** |
| `09-mobile-390-seven-days-prep-week-starts.png` | **7 days out: the window's first day, note present** |
