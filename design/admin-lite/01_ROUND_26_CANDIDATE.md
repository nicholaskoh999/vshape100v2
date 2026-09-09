# Round 26 — Admin Lite / System Health v1, release candidate

Formalises the accepted spike. **This candidate is not merged and not deployed. No
production D1 was read or written. No production variable was set.**

- **Authoritative `main`**: `ff6618411ad2855a511cf83c5dff7fba336865be` (the Round 25
  accepted tip), confirmed against the GitHub remote with `git ls-remote`
- Accepted spike: `232783814f23cd00d664d4ccabca1125f0635554`, sitting **directly on
  top of that `main`**
- Candidate branch: `claude/round-26-admin-lite-b3czmv`, fast-forwarded from the spike

The candidate is therefore **3 commits ahead of `main` and 0 behind**, on a single
unbroken line with no merge and no rewrite:

```
ff66184  main — Round 25 correction (accepted tip)
   ↓
2327838  Admin Lite spike (accepted)
   ↓
d11efe3  Round 26 — the copy polish
   ↓
<candidate HEAD>
```

Verified rather than assumed: `git merge-base origin/main HEAD` is `ff66184`, and
`git rev-list --left-right --count origin/main...HEAD` reports `behind=0 ahead=3`.

The spike record is `00_ADMIN_LITE_SPIKE.md` and still describes the security model,
the health semantics and the Foundation control accurately. This document records only
what Round 26 changed on top of it.

---

## 1. What changed

**Copy, and nothing else.** No route was added or removed, no query changed, no
contract field changed shape, no migration was written.

### A. Maintenance

The spike showed a status line, a greyed-out **Turn on** button, and a five-line
paragraph about persistent stores and database tables. That paragraph was an
engineering note wearing product clothes: it told the owner about our build process
in order to explain a feature they cannot use.

It now reads:

> **Maintenance mode**
> `Unavailable`
> Maintenance mode isn't available yet.

The disabled button is **gone**, not merely still disabled. A control that can never
be pressed is furniture; the honest version of it is a word. The maintenance region
now contains zero `<button>`, `<a>`, `<input>` and `<form>` elements — the same claim
the Danger Zone has always made, now asserted by a test rather than by the fact that
nobody had added one.

The reasoning behind the deferral was not deleted. It stayed in the source comments
and in §6 of the spike record, where the people who need it will look, and where no
signed-in owner ever sees it.

### B. Danger zone

Was: "Managed separately · Not available here" followed by "Run only by the Round 25
operator tool, from a machine with credentials, after an explicit go-ahead."

Now:

> **Fresh Activity Reset**
> Clears activity history while preserving configuration.
> `Unavailable`
> Activity reset isn't available from Admin Lite.

A page that cannot run a reset has no business explaining how one *could* be run. The
old copy named an internal round, an internal tool and a credential requirement — a
map of the operational surface, printed on a page whose whole point is that it is not
part of that surface.

`managedBy: 'round25-operator'` still travels on the wire and is still parsed by the
contract. It is never rendered, and a test asserts that.

### C. The `Unavailable` chip

One new component in `AdminStatus.tsx`, used by both regions.

It is deliberately **not** one of the four health words. Health describes something
that exists and might be misbehaving; `Unavailable` describes something that is not
here at all. An absent feature is not an amber warning and it is not a red error, and
letting the two vocabularies blur would undo the page's one rule. Like every chip on
this page it carries its own icon, so the meaning survives greyscale.

### D. Visual language

Unchanged. Off-white canvas, white cards, lime accent, near-black ink, soft borders,
rounded cards, the same section rhythm at 390 / 834 / 1440. The Danger Zone keeps its
red tint: the feature it names is genuinely destructive, and the tint is what stops a
skimming eye from confusing it with Maintenance.

---

## 2. What Round 26 did NOT do

No maintenance backend. No `app_flags` table. No migration — the chain is still
0001–0015, counted from disk by a test rather than from a list. No reset endpoint, no
SQL console, no table browser, no migration runner, no deploy or Cloudflare control,
no user or secret management. No import of the Round 25 reset planner or the Round 18
fresh-start tool. `/admin` is still URL-only and still absent from the navigation.

The Round 25 reset operator, its planner and its tests were not touched:
`git diff --name-only 2327838 -- shared/round25Reset.ts scripts/ worker/ …` is empty.

---

## 3. Evidence

### New tests — `src/test/adminSourceAudit.test.ts`, 10 tests

Source-level claims the behavioural suites cannot make. The behavioural proofs — a
non-admin refused, an empty allowlist failing closed, an unreadable count staying
Unknown, eight reset paths × four methods all refused — are unchanged in
`adminRoutes.test.ts` and are not restated.

| Claim | How |
|---|---|
| the client names exactly two endpoints | every `/api/…` string literal in the admin client is collected; the set is exactly `overview` + `foundation-start` |
| the only state-changing verb it uses is the Day 1 `PUT` | every `method: '…'` in `adminApi.ts` is collected |
| no reset vocabulary reaches the client | no `DELETE` method, no reset-planner identifiers, no destructive SQL |
| maintenance was not wired by the polish | no write helper on either side; `MAINTENANCE` is still a module `as const` with `controllable: false` and no `true` anywhere |
| no migration was added | the chain is globbed from disk: 15 files, `0001_auth` … `0015_programme_builder`, and none is shaped like a flags table |
| the rendered copy carries no jargon | with comments stripped, `AdminPage.tsx` contains no `Round 2x`, no `operator tool`, no `spike` |
| `managedBy` is parsed but never rendered | present in the contract, absent from the page |

### Changed tests — `src/test/adminPage.test.tsx`

`3.A` now asserts the new Danger Zone copy. `3.B` is new: the rendered Danger Zone
text matches no round, operator or credential vocabulary. `3.C` replaces the old
"the button is disabled" assertion with the stronger one — there is no button, no
link, no input and no form in the maintenance region — plus the absence of the
deferral's machinery from the copy.

### Suites

| Gate | Result |
|---|---|
| `adminRoutes.test.ts` | 51 passed |
| `adminPage.test.tsx` | 16 passed |
| `adminSourceAudit.test.ts` | 10 passed (new) |
| Round 25 / Round 18 reset regressions | `round25Reset`, `round25PostResetTruth`, `freshStart`, `freshStartOperator` — all passed |
| typecheck | clean |
| lint | clean |
| production build | clean |

### Known flaky tests — NOT caused by this round, and NOT patched by it

Three files failed across five full-suite runs, and **a different set each time**.
That is the signature of timing, not of a defect.

| # | Tree | Result |
|---|---|---|
| 1 | candidate | 3 failed — `trainingNavigation`, `notificationDelivery`, +1 |
| 2 | candidate | 2 failed — `trainingNavigation`, `notificationDelivery` |
| 3 | **untouched spike `2327838`** | **2832 passed, 0 failed** |
| 4 | candidate | 1 failed — `calendar` |
| 5 | **untouched spike `2327838`** | **2 failed — `trainingNavigation`, `notificationDelivery`** |

Run 5 settles it. The untouched spike, with none of Round 26's code present, failed
with **exactly the pair** the candidate failed with in runs 1 and 2. The flakiness is
in the tree this round inherited and in this container's scheduling, not in anything
Round 26 wrote.

Isolated, each one passes:

| File | Tree | Runs | Result |
|---|---|---|---|
| `trainingNavigation` | candidate | 3 | 2 passed, 1 failed |
| `trainingNavigation` | **untouched spike** | 5 | 4 passed, **1 failed** |
| `notificationDelivery` | untouched spike | 3 | 3 passed |
| `calendar` | candidate | 3 | 3 passed |

`trainingNavigation` reproduces its failure on the untouched baseline at roughly the
same rate as on the candidate. `notificationDelivery` only ever failed as a 30 s
timeout under full-suite parallel load and passes alone in both trees — container
contention, not a defect. `calendar` failed once, under load, and passes alone.

Round 26 changes no training, calendar, router or notification source. The diff
against the spike is four files, all of them admin or `.gitignore`. **No unrelated
product code was modified to make any of these pass**, and none of them was skipped,
quarantined or retried into green.

The admin suites — `adminRoutes` (51), `adminPage` (16), `adminSourceAudit` (10) —
passed in every run, isolated and full.

## 4. Screenshots

`design/admin-lite/screenshots/round26/`, captured from a **throwaway preview
fixture** — the real `AdminPage` rendered against a stubbed `fetch`, with no server,
no session and no database.

**The numbers in these images are invented. Only the layout and the copy are
evidence.** The fixture lived in `.admin-preview/`, is git-ignored, is imported by
nothing the app builds, and was deleted after capture.

| File | |
|---|---|
| `01-mobile-390.png` | full page, 390 × 844 |
| `02-tablet-834.png` | full page, 834 × 1112 |
| `03-desktop-1440.png` | full page, 1440 × 900 |
| `04-non-admin-refusal.png` | the 403 path — a refusal and nothing else |
| `05-maintenance-danger.png` | the two polished regions, side by side |
| `06-confirm-day-1.png` | the Foundation confirmation, naming both dates |
