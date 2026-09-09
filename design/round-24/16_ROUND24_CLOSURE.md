# Round 24 — CLOSED / LIVE

**Round 24 — UI/UX Redesign Blueprint + Fresh Reset Plan v1.**

| | |
|---|---|
| Live source | `01f06da8abf47cfde4c5c18b1da2dbbd00a6f317` (`main`) |
| Production | https://vshapev2.nkmwei.de — Worker `vshape100v2` |
| Rollback checkpoint | `checkpoint/pre-round24-redesign` → `7213f3b15fc0af6597e0ee236802357e16985084` — **preserved, must not move** |
| Outcome | **CLOSED / LIVE** |
| D1 migration ledger | **0001–0015**, unchanged from the checkpoint |
| Fresh Database Reset | **NOT performed. NOT authorized. Still pending a future authorized round.** |

---

## 1. Provenance of this record

The deploy and the production visual smoke were performed and reported by the
controller. **This session never reached production**: its egress policy denies
`api.cloudflare.com`, `dash.cloudflare.com` and `vshapev2.nkmwei.de`, and it
holds no Cloudflare credentials. Everything below that is a *source* fact was
verified here; everything that is a *production* fact is recorded as reported,
and is marked so.

| Fact | Verified here | Reported by the controller |
|---|---|---|
| `main` = `01f06da`, tree byte-identical to the reviewed candidate | ✅ | |
| Checkpoint unmoved at `7213f3b1` | ✅ | |
| No file under `migrations/`, `worker/`, `wrangler.jsonc` changed in the whole round | ✅ | |
| typecheck, lint, targeted tests (93), build | ✅ | |
| Shipped artifact carries the light system, the dedicated maskable icon, no goal weight, no superseded palette | ✅ | |
| Deployed to `vshapev2.nkmwei.de` | | ✅ |
| Production visual smoke PASS | | ✅ |
| No destructive D1 mutation in production | | ✅ |

---

## 2. What Round 24 delivered

**The light system.** The dark navy / electric-blue palette is superseded by a
warm off-white canvas, white surfaces, near-black ink and a lime accent, across
every screen, the browser chrome and the installed app.

**A focused workout.** Continue workout opens a one-exercise, one-set,
one-action workspace: session progress, the current exercise, its demo media,
the current unresolved set with modality-correct controls, Complete set owning
the bottom of the phone. It opens on the exercise holding the first pending set,
writes nothing on entry, and invents no current set when everything is resolved.

**A week-first programme editor** at `/settings/programme` — weekday → ordered
exercises → add an existing exercise → focused prescription editing, on one
all-or-nothing compare-and-swap write, with a draft that cannot be rebased onto
a revision it was not written against.

**Truth corrections found and fixed along the way**, each with a regression test
and a mutation check:

| | |
|---|---|
| Today mixed the current programme with a frozen workout | after Start, Today describes the snapshot; the programme may not relabel or resize it |
| A programme conflict could rebase a stale draft | the draft carries the revision it was authored on and can be saved against no other |
| Training could show the default week on a failed read | pinned by `trainingFailClosed.test.tsx`; it never could, and now it is proven |
| `useScheduledStarted` stated "already under way" from an unknown read | `status` is exposed; an unknown answer disables, it does not assert |
| Settings hardcoded `Mode: Home` | removed; Today and Calendar own day mode and read it |
| Extra provenance was byte-identical to the accent and reused for UI state | Extra is an outline chip; `current` is its own ink fill |
| Six SQLite suites — **both Fresh Start suites** — had never executed | 106 tests now run |
| The login CTA was ink-on-ink | unreadable label fixed at 14.9:1 |

**The production brand.** Shield-and-path symbol on login, the auth splash and
the app chrome; production favicon, apple-touch and PWA exports; a **dedicated**
maskable asset instead of the ordinary 512 wearing a second label. No
letter-based V mark remains anywhere in the app chrome.

---

## 3. History preserved — nothing deleted

| | Where |
|---|---|
| Blueprint, prototype, audit, design system, IA, blueprints, responsive rules, component inventory, accessibility, data/API matrix, **Fresh Reset plan**, deferred register | `design/round-24/00`–`10`, `prototype/`, `tokens/` — on `main` |
| Implementation and correction reports | `11`, `12` — on `main` |
| The three ship records | `13`, `14`, `15` — gathered here, and still on `claude/new-session-jwc2pe`, `claude/round24-today-snapshot-truth`, `claude/round24-login-icons` |
| Superseded Round 23 candidate | `claude/round-23-correction-outcome-truth` → `d9bb9cbf` — untouched, never used |
| Every earlier round | its own `claude/round-NN-*` branch — untouched |
| Rollback checkpoint | `checkpoint/pre-round24-redesign` → `7213f3b1` — untouched |

**Reverted-on-purpose work is recorded, not hidden:** auto-opening the current
exercise (built, then reverted — it fights the accordion's tested disclosure
contract), withdrawing the gym item from Today's agenda for the hero (reverted —
the hero and the 20:30 row are two different facts), and the flex card behind a
disclosure (reverted — the finding was its position, not its existence). The
reasoning for each is in the source it concerns.

---

## 4. Source rollback, if it is ever needed

```bash
git push origin 7213f3b15fc0af6597e0ee236802357e16985084:refs/heads/main   # then redeploy
```

**Source rollback is not data rollback.** It restores no data, because Round 24
changed none: `git diff 7213f3b1..01f06da -- migrations/ worker/ wrangler.jsonc`
is empty. Every row written since the checkpoint is real training and stays.

---

## 5. Development Directions — the register for the next-round election

Consolidated from every Round 24 document. **None is authorized; this is the
candidate list, not a plan.**

### Truth and correctness

| | Direction | Note |
|---|---|---|
| **D11** | `HeroCard` / `Card` forward native section attributes | These primitives accept a fixed prop set, so `aria-labelledby` and `data-*` passed to them are silently dropped. **Today's training hero has had no accessible name since Round 24** — its `<section>` is not exposed as a landmark at all. The Programme add-panel had to become a plain `<section>` for the same reason. Fix the primitives, and make dropping an attribute visible rather than silent. **Smallest real defect on this list.** |
| **D12** | `worker/test/notificationDelivery.test.ts` block C times out under full-suite load | Reproduced on a clean baseline worktree of `main`; passes in isolation. Pre-existing and environmental, not a Round 24 regression — but it makes the full suite unreliable as a gate, which is a cost that compounds. |
| **D13** | `trainingNavigation > leaves normal Back working through the whole trail` | Intermittent; fails on the exact accepted baseline `7213f3b1` in isolation. Older than Round 24 and never diagnosed. |

### Product

| | Direction | Note |
|---|---|---|
| **D10** | Extra Workout reuses the focused workout workspace | Preserving Extra provenance (outline chip, `kind: 'extra'`, `sourceSessionId`, never merged with Scheduled) and no-progression semantics (no derived load suggestion, no calibration feedback). The most natural next feature: the workspace exists and Extra is the one place that still only has the overview. |
| **D5** | Rest timer between sets | Approved in Round 24 (Q5) and deliberately left unbuilt so a new feature would not land in the commit that rewrote every screen. Client-only, no server persistence, never blocks completing the next set, never changes progression or history semantics. **Already approved — it needs a round, not a decision.** |
| **D4** | Richer post-workout summary | Only what was recorded. Volume cannot be summed across a band set and a kilogram set, so anything beyond counts would be fabricated. |
| **D8** | Weight entry directly on Today | Supported by the existing `PUT /api/progress/weight`; adds a second write path to Today. |
| **D9** | Stale-while-revalidate on Progress | Correcting a set or saving a weight currently unmounts surrounding cards into "loading". Fixable in `usePerformance` / `useWorkoutHistory`. |
| **D7** | Trusted-device management / sign out everywhere | Already a later-round item; the redesigned Settings leaves room for it. |

### Needs a schema change — its own round

| | Direction |
|---|---|
| **D3** | A canonical per-account band library (Round 24 solved the typing client-side with chips for bands already used in this workout) |
| **D2** | Goal weight (Q4 removed the unsupported line rather than fabricating a field) |
| **D1** | `GET /api/workouts/active` — the only API contract change the whole redesign surfaced; needed to cover an in-flight **Extra** in a resume bar |

### Design

| | Direction |
|---|---|
| **D6** | A dark theme as a user preference — a second complete palette with its own contrast pass, not a `dark:` variant bolted onto this one |
| **D14** | The sidebar brand lockup at rail width — the wordmark is hidden there, so only the symbol identifies the app; worth a deliberate look now the symbol is real |

### Not a Development Direction

**Q7 — Full Activity Fresh Start.** Planned in `09_FRESH_RESET_PLAN.md` and
**not authorized**. Round 24 closing does not authorize it. Its prerequisites,
unchanged: an exact production inventory, a protected-data fingerprint, a D1
backup/export, an explicit account, an explicit final restart date, an explicit
V START authorization, and post-reset verification. `shared/freshStart.ts` and
both Fresh Start suites are ready and — for the first time — actually execute.
