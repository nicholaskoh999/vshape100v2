# Round 24 — snapshot-truth ship record

**V SHIP.** The Today snapshot-truth correction, accepted after independent review.

| | |
|---|---|
| Pre-ship `main` | `19d10e037792f5eb6bdce2c65f41306a591233fa` |
| Accepted candidate | `66c783f0f106078f973ea0f412192616eab0316d` |
| Candidate parent | `19d10e037792f5eb6bdce2c65f41306a591233fa` (direct child of main) |
| Resulting `main` | `66c783f0f106078f973ea0f412192616eab0316d` |
| Safety checkpoint | `checkpoint/pre-round24-redesign` → `7213f3b15fc0af6597e0ee236802357e16985084` (**unmoved**) |

Deploy status: **PENDING.** See §4.

---

## 1. Promotion

The candidate has exactly one parent, and that parent is the pre-ship `main`, so
the promotion is a fast-forward with no merge commit. Pushed **without
`--force`** — a push the server accepts only if it fast-forwards, and which
therefore cannot rewrite `main` or alter the accepted source.

```
git push origin 66c783f0f106078f973ea0f412192616eab0316d:refs/heads/main
19d10e0..66c783f  -> main
```

The shipped tree is byte-identical to the reviewed one:

```
main tree      1c1e59b07378c0680c0ef523c1039f43b85a4843
candidate tree 1c1e59b07378c0680c0ef523c1039f43b85a4843
```

`main` remains linear: `7213f3b` → `1753862` → `c0d6e7a` → `19d10e0` → `66c783f`.

---

## 2. What shipped

Four files, `+489 / −28`, all client source:

| File | |
|---|---|
| `src/features/today/startedWorkout.ts` | **new** — the frozen summary a started workout gives of itself |
| `src/features/today/useScheduledStarted.ts` | returns that summary instead of a bare `progress` |
| `src/features/today/components/TodayTrainingHero.tsx` | chooses its source of truth from it |
| `src/test/todaySnapshotTruth.test.tsx` | **new** — 7 cases pinning the rule |

**The rule.** Before Start, Today describes the current programme. After Start,
Today describes the snapshot — occurrence focus, occurrence intensity, frozen
exercise count, frozen total, frozen progress — and the programme may not
relabel or resize it. Where the snapshot cannot establish its own size, the card
says so; it never borrows the programme's counts under a started heading.

`git diff 19d10e0..66c783f -- migrations/ worker/ wrangler.jsonc` is **empty**.
No migration, no Worker source, no Cloudflare configuration. The D1 ledger is
**0001–0015**, unchanged, and nothing in this ship could alter a stored row.

---

## 3. Gates, run from the resulting `main`

| | |
|---|---|
| Targeted — Today snapshot truth, started-snapshot UI, Today ×3, training flex, focused workout, set logging, band logging, Extra | **222 passed / 10 files** |
| `npm run typecheck` | pass |
| `npm run lint` | pass |
| `npm run build` | pass — `index-BToYVF7S.js` 805.89 kB, `index-BTnzvOgj.css` 55.38 kB, Worker `index.js` 356.73 kB |

The built artifact was then driven on the exact condition the correction is
about — a started workout whose programme has since been edited down — and
reported the workout's own identity and size, agreeing with its own progress
rail, with zero console or page errors:

```
Scheduled · HARD · In progress
Back Width + Biceps
5 exercises · 15 sets
6 / 15 sets resolved · 5 completed · 1 skipped
```

(The current programme in that run listed three exercises and nine sets. It did
not appear on the card, which is the whole point.)

---

## 4. Deployment — NOT performed, and not attempted

`wrangler.jsonc` has said so since Round 02:

> Deployment is NOT performed from the build environment.

Re-checked at ship time, twice independently:

- **No Cloudflare credentials.** `CLOUDFLARE_API_TOKEN`, `CLOUDFLARE_ACCOUNT_ID`,
  `CF_API_TOKEN`, `CF_ACCOUNT_ID`, `WRANGLER_API_KEY`, `CLOUDFLARE_EMAIL` and
  `CLOUDFLARE_API_KEY` are all unset, and there is no `~/.wrangler` config.
- **No network path.** The session's egress policy answers `403` to CONNECT for
  both `api.cloudflare.com:443` and `vshapev2.nkmwei.de:443`.

No credentials were improvised and nothing was claimed as deployed. Production
is still serving the pre-Round-24 build, so there is **no Worker identity, no
deployed-source identity and no live D1 ledger reading to report** — those exist
only after the operator deploys.

### The exact commands the controller runs locally

```bash
git fetch origin main
git checkout main && git reset --hard origin/main
git rev-parse HEAD          # must print 66c783f0f106078f973ea0f412192616eab0316d

npm ci
npm run check               # typecheck + lint + test + build

npx wrangler deploy         # publishes Worker + assets. Applies NO migrations.

# read-only confirmations, after deploying
npx wrangler deployments list
npx wrangler d1 migrations list vshape100v2-auth --remote   # expect: none pending, ledger 0001–0015
```

**Do not run `wrangler d1 migrations apply`.** Nothing in Round 24 needs it and
the ledger must stay at 0015.

### Then the smoke

Read-only navigation across Today, Training, Progress, Calendar, Achievements,
Settings, Exercise Library, `/settings/programme`, and focused workout entry
(presentation only — entering issues no write).

**Snapshot smoke, only if it can be observed without mutating anything:** if a
started workout already exists on the account, open Today and confirm the hero
states that workout's own focus, intensity and size, and that those agree with
its progress rail. **Do not start, complete, skip or correct any production
workout to manufacture this scenario.**

---

## 5. Explicitly NOT done

- **No Fresh Reset.** Not executed, not prepared, not scheduled.
- **No production D1 mutation.** No row read, written, deleted or corrected; no
  historical workout touched. The session cannot reach the account at all.
- **No new migration.** Ledger 0001–0015, unchanged. Nothing named 0016 exists.
- **No V1.** No V1 repository, deployment, URL or resource accessed, searched,
  referenced or inferred from.
- **No Round 23 work.**
- **No unrelated source change.** The shipped diff is the four files above.
- **The checkpoint was not moved or deleted.**

---

## 6. Development Directions — recorded, not implemented

| | Direction | Notes |
|---|---|---|
| **D10** | **Extra Workout — reuse the Round 24 focused workout workspace while preserving Extra provenance and no-progression semantics** | The Extra page renders the session-overview shape only. Reusing `FocusedWorkout` would give it the same one-exercise, one-set, one-action workspace. Two properties must survive: an Extra keeps its own provenance — the outline `Extra` chip, `kind: 'extra'`, `sourceSessionId` — and is never visually merged with a Scheduled session; and an Extra contributes no progression, so the workspace must offer no derived load suggestion and no calibration feedback on it. |
| **D11** | **Shared `HeroCard` accessibility — forward appropriate native section attributes instead of silently dropping them** | Found while capturing evidence for this correction. `HeroCard` accepts only `children`, `className`, `accent` and `tone`, so `TodayTrainingHero`'s `aria-labelledby="today-training"` has been dropped since Round 24: that `<section>` renders with no accessible name and is therefore not exposed as a landmark at all. `Card` has the same shape and silently drops `data-*` too (the Programme add-panel had to become a plain `<section>` for exactly this reason). The fix is to let these primitives forward the attributes they are standing in for — and to make dropping one visible rather than silent. Touches a shared primitive used by several screens, so it belongs in its own change, not in a Today correction. |

Neither was started during this ship.

---

## 7. Where the earlier records live

`13_SHIP_RECORD.md`, covering the first promotion (`7213f3b1` → `19d10e0`), is
on branch `claude/new-session-jwc2pe`. Neither record is on `main`, deliberately:
`main` is kept at exactly the reviewed and accepted candidate SHA each time, so
a documentation commit is never what production is built from.
