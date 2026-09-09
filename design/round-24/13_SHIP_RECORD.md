# Round 24 — ship record

**V SHIP.** Accepted after independent source + UI review.

| | |
|---|---|
| Pre-ship `main` | `7213f3b15fc0af6597e0ee236802357e16985084` |
| Accepted candidate | `19d10e037792f5eb6bdce2c65f41306a591233fa` |
| Resulting `main` | `19d10e037792f5eb6bdce2c65f41306a591233fa` |
| Rollback checkpoint | `checkpoint/pre-round24-redesign` → `7213f3b15fc0af6597e0ee236802357e16985084` (**unmoved**) |

---

## 1. Promotion

`main` has never carried a merge commit; every round has landed on it as a
fast-forward. The accepted checkpoint was already an ancestor of the candidate,
so the candidate was pushed to `main` **without `--force`** — a push the server
accepts only if it is a fast-forward, and which therefore cannot rewrite `main`
or alter the accepted source.

```
git push origin 19d10e037792f5eb6bdce2c65f41306a591233fa:refs/heads/main
7213f3b..19d10e0  -> main
```

The shipped tree is byte-identical to the reviewed one:

```
main tree      5c2a56399b75c582b59d63ab16d24f51e3472697
candidate tree 5c2a56399b75c582b59d63ab16d24f51e3472697
```

Three commits moved from the checkpoint to `main`: the blueprint (`1753862`),
the implementation (`c0d6e7a`), the correction (`19d10e0`).

---

## 2. What this ship touches, and what it cannot touch

`git diff 7213f3b1..19d10e0 -- migrations/ worker/ wrangler.jsonc` is **empty**.

Round 24 changed **no migration, no Worker source and no Cloudflare
configuration**. The D1 ledger is 0001–0015 at the candidate exactly as it is at
the checkpoint, and the shipped Worker bundle is built from unchanged sources.
This is a client-source ship: there is nothing in it that could alter a schema or
a stored row.

| Migration ledger at `19d10e0` | |
|---|---|
| 0001_auth · 0002_today_completions · 0003_exercise_media · 0004_workout_logs · 0005_holiday_overrides · 0006_company_holidays · 0007_notification_push · 0008_progress_upgrade · 0009_training_progression · 0010_flexible_training · 0011_account_settings · 0012_training_flex · 0013_workout_input_types · 0014_workout_recovery_and_corrections · 0015_programme_builder | **15 files, unchanged** |

---

## 3. Deployment — not performed from this environment

`wrangler.jsonc` has said so since Round 02:

> Deployment is NOT performed from the build environment. `wrangler deploy`,
> production D1 creation, production migrations and production secrets are
> reserved for local/desktop verification against the real account.

Independently confirmed here:

- no Cloudflare credentials are present (`CLOUDFLARE_API_TOKEN`,
  `CLOUDFLARE_ACCOUNT_ID` and every alias unset; no `~/.wrangler` config)
- the session's network policy **denies** `api.cloudflare.com:443` and
  `vshapev2.nkmwei.de:443` — the proxy answers `403` to CONNECT for both

So `wrangler deploy` and any live production smoke are for the operator's own
machine. The deploy is a plain publish of the promoted `main`; it adds nothing
and migrates nothing:

```
git fetch origin main && git checkout main && git rev-parse HEAD   # expect 19d10e0…
npm ci && npm run check
npx wrangler deploy          # publishes the Worker + assets. NO d1 migrations apply.
npx wrangler d1 migrations list vshape100v2-auth --remote   # expect: none pending
```

**Do not run `wrangler d1 migrations apply`.** Nothing in this round needs it,
and the ledger must stay at 0015.

---

## 4. Pre-deploy verification of the exact shipped artifact

Built clean from the promoted `main` tree.

```
dist/client/assets/index-CHrBYt5Z.js    805.34 kB
dist/client/assets/index-BTnzvOgj.css    55.38 kB
dist/vshape100v2/index.js               356.73 kB   (Worker, from unchanged sources)
dist/ tree digest 7fc921fffca1c794fa749331a95090b53d58d496a2f29de8e8040a8354187cba
```

| Check | Result |
|---|---|
| Light system in the shipped CSS | `#f5f6f2` canvas, `#ffffff` surface, `#171a15` ink, `#cdf564` accent, `#74961f` accent edge, `color-scheme:light` |
| Old dark palette gone | no `#0b1220`, no `#3b82f6` anywhere in the CSS |
| Browser chrome follows | `<meta name="theme-color" content="#F5F6F2">`; manifest `theme_color` and `background_color` both `#F5F6F2` |
| `/settings/programme` | present in the shipped bundle |
| Goal weight | **absent** from the shipped JS, CSS, HTML and Worker bundle, and from `src/`, `worker/`, `shared/` |
| Focused workout | `Continue workout`, `Back to all exercises`, `Complete set`, `Per dumbbell` all present |

Rendered smoke of that artifact, 11 surfaces × 2 viewports, against a local stub
of the API — no production system was contacted:

- every named surface renders its own `h1`
- `body` background is `rgb(245, 246, 242)` on every one
- **0** console errors, **0** page errors, **0** failed requests
- **0** horizontal overflow
- no goal-weight text on any screen
- responsive navigation live: the mobile bar present on every ordinary screen,
  the tablet rail and desktop sidebar both present throughout
- **focused workout entry issued 0 non-GET API requests** — entering the
  workspace is a read, as designed. Nothing was completed, skipped or undone.

This is verification of the artifact that will be deployed. It is **not**
production verification, which is listed at the end of this file as the
operator's remaining step.

---

## 5. Explicitly NOT done

- **No Fresh Reset.** Not executed, not prepared, not scheduled.
- **No production D1 mutation.** No row read, written, deleted or corrected; no
  historical workout row touched. The session cannot reach the account at all.
- **No new migration.** The ledger is 0001–0015, unchanged. Nothing named 0016
  exists.
- **No V1.** No V1 repository, deployment, URL or resource was accessed,
  searched, referenced or inferred from.
- **No Round 23 correction** and no use of `d9bb9cbf`.
- **No unrelated cleanup.** The shipped tree is exactly the reviewed tree.
- **The checkpoint was not moved or deleted.**

---

## 6. Remaining operator step

Run the deploy above from the machine that holds the Cloudflare credentials,
then verify production identity and smoke the deployed experience — login /
bootstrap, Today, Training, a scheduled session, focused workout entry
(presentation only), Progress, Calendar, Achievements, Settings, Exercise
Library, `/settings/programme`.

Source rollback and D1 rollback remain separate concepts. Rolling source back is
`git push origin 7213f3b1…:refs/heads/main` followed by a redeploy; it restores
no data, because this round changed none.

---

## 7. Recorded Development Direction (non-blocking, not started)

| | Direction | Notes |
|---|---|---|
| **D10** | **Extra Workout — reuse the Round 24 focused workout workspace while preserving Extra provenance and no-progression semantics** | The Extra page currently renders the session-overview shape only. Reusing `FocusedWorkout` would give it the same one-exercise, one-set, one-action workspace. Two properties must survive intact: an Extra keeps its own provenance — the outline `Extra` chip, `kind: 'extra'`, `sourceSessionId` — and is never visually merged with a Scheduled session; and an Extra contributes no progression, so the workspace must offer no derived load suggestion and no calibration feedback on it. **Not started during V SHIP.** |
