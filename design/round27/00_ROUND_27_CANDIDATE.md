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

**No Day 0, structurally rather than by a guard.** `upcoming` means `day < 1`, which
makes `daysUntilStart` at least 1 by construction. On Day 1 the phase becomes
`foundation`, the component returns null, and the normal Foundation state takes over
with nothing to dismiss and nothing to unwind.

It renders **outside** the holiday branches on purpose: whether today is a company
Holiday is a fact the page may still be waiting for, but how many days remain until
Day 1 is not, so gating one on the other would blank the note for no reason. It is
still gated on `foundationStart.status === 'ready'` — a count derived from the default
while the account's real date is in flight is a number that changes under the reader.

**The eyebrow gave up its arithmetic.** With the note printing the count, the eyebrow
printed it twice on one screen. It now reads `Foundation · Prep week`, keeping its job
(which phase) and staying parallel with `Foundation · Day 7` on every other day.

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

`src/test/round27Polish.test.tsx` (13) — driven through the real router, the real
Foundation provider and the real pages. The Foundation date is seeded and every
countdown assertion is derived from that date and a faked clock, never written into the
test. Covers: several days before, one day before (singular "1 day"), exactly Day 1,
well after Day 1, and a boundary sweep over days 12–15 asserting no `0 days`, no
negative count and no `Day 0` anywhere on the page.

### Mutation testing

Each load-bearing claim was broken on purpose, the suite run, and the mutation reverted.

| Mutation | Result |
|---|---|
| prep note renders in every phase, with `1 - day` as the count | **3 fail** |
| `Card` drops the passthrough spread | **3 fail** in layout, **2** in round27 |
| the Admin row points somewhere other than `/admin` | **3 fail** |

Baseline before and after each: 9 and 13 passed.

### Gates

| Gate | Result |
|---|---|
| focused batch — passthrough, Round 27, shell, today, todayHoliday, foundation ×3, settingsFailClosed, admin ×3 | **301 passed / 12 files** |
| typecheck | clean |
| lint | clean |
| production build | clean |

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
