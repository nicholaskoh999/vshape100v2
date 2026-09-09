# Round 25 — Fresh Database Reset + Clean Start v1

## Stage 1 — pre-reset analysis. **NOTHING WAS EXECUTED.**

---

## 1. Exact baseline

| | |
|---|---|
| Source baseline | `01f06da8abf47cfde4c5c18b1da2dbbd00a6f317` (`main`, live) |
| Source checkpoint | `checkpoint/pre-round24-redesign` → `7213f3b15fc0af6597e0ee236802357e16985084` |
| D1 database | `vshape100v2-auth`, id `783552ce-60e0-4685-86e1-19885cff1de9`, binding `DB` |
| Migration ledger | **0001–0015**, 15 files, highest `0015_programme_builder.sql` |
| Only persistent store | **D1.** `wrangler.jsonc` declares `d1_databases` and nothing else — no KV, R2, Durable Object, Queue or Vectorize binding exists, so there is no second place activity history could be hiding. |
| Cron | `* * * * *` — the reminder sweep. It **writes** `notification_deliveries` every minute. |

### Live access — NOT available from this session

No Cloudflare credentials are present, and the session's egress policy answers
`403` to CONNECT for `api.cloudflare.com`. **Every table name, key and constraint
below is proven from the migration ledger and Worker source, not guessed** — but
nothing that requires querying the live database could be obtained. What is
missing is marked **[LIVE]** throughout and gathered in §3.

---

## 2. Table-by-table inventory — 20 tables, proven from `migrations/0001`–`0015`

`acct` = the account-scoping column. `date` = the local-date column a
history boundary can be expressed against.

| # | Table | Migration | acct | date column | Primary key | Writes |
|---|---|---|---|---|---|---|
| 1 | `oauth_states` | 0001 | — *(none)* | — | `state_hash` | INSERT, DELETE |
| 2 | `auth_sessions` | 0001 | `google_sub` (col, not key) | — | `session_hash` | INSERT, UPDATE |
| 3 | `today_completions` | 0002 | `google_sub` | `anchor_day` | `(google_sub, occurrence_key)` | INSERT, DELETE |
| 4 | `exercise_media` | 0003 | `google_sub` | — | `(google_sub, exercise_id)` | INSERT, DELETE |
| 5 | `workout_occurrences` | 0004 | `google_sub` | `workout_date` | `(google_sub, workout_date, session_id)` | INSERT, UPDATE, DELETE |
| 6 | `workout_sets` | 0004 | `google_sub` | `workout_date` | `(google_sub, workout_date, session_id, exercise_order, set_index)` | INSERT, UPDATE, DELETE |
| 7 | `holiday_overrides` | 0005 | `google_sub` | `start_date`, `end_date` | `(google_sub, id)` | INSERT, UPDATE, DELETE |
| 8 | `company_holidays` | 0006 | **— GLOBAL** | `holiday_date` | `holiday_date` | *(no write path in the Worker)* |
| 9 | `company_holiday_preferences` | 0006 | `google_sub` | `holiday_date` | `(google_sub, holiday_date)` | INSERT |
| 10 | `push_subscriptions` | 0007 | `google_sub` | — | `(google_sub, id)` | INSERT, DELETE |
| 11 | `notification_deliveries` | 0007 | `google_sub` | — *(`trigger_minute` INTEGER)* | `(subscription_id, trigger_minute)` | INSERT, UPDATE, DELETE |
| 12 | `body_weight_entries` | 0008 | `google_sub` | `local_date` | `(google_sub, local_date)` | INSERT, DELETE |
| 13 | `workout_calibration` | 0009 | `google_sub` | `workout_date` | `(google_sub, workout_date, session_id, exercise_order)` | INSERT, DELETE |
| 14 | `account_settings` | 0011 | `google_sub` | *(holds `foundation_start_date`)* | `google_sub` | INSERT (upsert) |
| 15 | `training_flex` | 0012 | `google_sub` | `local_date` | `(google_sub, local_date)` | INSERT, DELETE |
| 16 | `exercise_input_types` | 0013 | `google_sub` | — | `(google_sub, exercise_id)` | INSERT |
| 17 | `workout_set_corrections` | 0014 | `google_sub` | `workout_date` | `correction_id` | INSERT, DELETE |
| 18 | `programme_revisions` | 0015 | `google_sub` | — | `google_sub` | INSERT, UPDATE |
| 19 | `programme_exercises` | 0015 | `google_sub` | — | `(google_sub, exercise_id)` | INSERT, DELETE |
| 20 | `programme_slots` | 0015 | `google_sub` | — | `(google_sub, session_id, exercise_id)` | INSERT, DELETE |

Migration 0010 creates no table: it adds `kind` and `source_session_id` to
`workout_occurrences`. Later ALTERs add `touched_at` (occurrences),
`input_type_snapshot` / `actual_band_label` / `actual_band_count` (sets) and
`name` / `training_on` (holiday overrides).

### Declared foreign keys — only three, all onto `workout_occurrences`

```
workout_sets            (google_sub, workout_date, session_id, snapshot_id)
                          → workout_occurrences(...)                ON DELETE CASCADE
workout_calibration     (google_sub, workout_date, session_id)
                          → workout_occurrences(...)                ON DELETE CASCADE
workout_set_corrections (google_sub, workout_date, session_id)
                          → workout_occurrences(...)                ON DELETE CASCADE
```

**Cascade must not be relied on.** D1 does not guarantee foreign-key enforcement
for a given statement, and `shared/freshStart.ts` already deletes children
explicitly for exactly this reason. The deletion order in §5 assumes cascade
does **not** fire.

### Nothing derived is persisted

There is **no** achievements, streaks or progress table. Recent Workouts,
Personal Bests, Exercise Performance, both streaks, Achievements and the
Round 16 progression lanes are all computed on every read from the surviving
rows. They correct themselves when the evidence changes and must never be
hand-edited. The one persisted *derived-from-training* table is
`workout_calibration` — progression lane evidence, and it already carries a
cascade onto the occurrence it was recorded against.

---

## 3. Row counts — **[LIVE] NOT OBTAINABLE FROM THIS SESSION**

No count in this document is real. Every one requires the live database. Run §7's
read-only inventory before approving anything.

Also unobtainable without live access, and each one is a genuine blocker:

| | What is unknown | Why it matters |
|---|---|---|
| **L1** | The set of `google_sub` values in the database | The reset tool **refuses to infer** the account. Nobody can approve a reset without knowing whose data it names, and whether more than one account exists. |
| **L2** | Actual row counts per table | The before-fingerprint, and the only way to notice that a number is wildly unlike what was expected *before* deleting it. |
| **L3** | Whether the live schema matches migrations 0001–0015 | Drift is possible in principle. `PRAGMA table_list` / `sqlite_schema` settles it. |
| **L4** | The earliest and latest `workout_date` actually present | Decides whether a cutoff-based reset removes everything, or leaves a tail. |
| **L5** | The current D1 Time Travel bookmark | The primary restore path (§6). Must be captured **immediately before** the mutation. |

---

## 4. Classification

### PRESERVE — stated intent and the shipped guard agree

| Table | Why |
|---|---|
| `auth_sessions`, `oauth_states` | Auth/session infrastructure. Deleting sessions signs the user out; deleting `oauth_states` mid-flight breaks an in-progress login. |
| `push_subscriptions` | Device registrations. Losing them silently ends reminders on a device that still thinks it is subscribed. |
| `exercise_media` | The media library — configuration about exercises, not a record of training. |
| `exercise_input_types` | Canonical input types. "Triceps Pushdown is a band" is a fact about the user's gym. |
| `programme_revisions`, `programme_exercises`, `programme_slots` | **The training week itself.** Deleting these is not "reset the history", it is "delete the programme and lose the optimistic lock that protects it". |
| `company_holidays` | Global, not account-scoped. No account-scoped reset may touch it. |

### RESET CANDIDATE — stated intent and the shipped guard agree

| Table | Boundary column | Why |
|---|---|---|
| `workout_occurrences` | `workout_date` | The activity history itself, scheduled and Extra alike. |
| `workout_sets` | `workout_date` | Owned by the occurrence. |
| `workout_calibration` | `workout_date` | Progression evidence derived from removed workouts. |
| `workout_set_corrections` | `workout_date` | Audit of sets that will no longer exist; an orphan audit describes nothing. |

These four, and only these four, are what `shared/freshStart.ts` already deletes.

### UNCLEAR / STOP — **the stated RESET INTENT contradicts the shipped contract**

This is the finding that matters. **Five tables named in this round's RESET
INTENT are explicitly PROTECTED by `FRESH_START_PRESERVED_TABLES`**, each with
recorded reasoning, and a test asserts the generated SQL never touches them.
They cannot both be true.

| # | Table | RESET INTENT says | The shipped guard says |
|---|---|---|---|
| **U1** | `body_weight_entries` | "body-weight history" is a reset candidate | PRESERVED |
| **U2** | `today_completions` | "Today completion history" is a reset candidate | PRESERVED |
| **U3** | `training_flex` | "training-flex/recovery/alternative-activity history" is a reset candidate | PRESERVED — *"a flex choice is a decision about a day, not training evidence, so a history reset has no business deleting it"* (Round 19.2) |
| **U4** | `holiday_overrides` | "user-specific activity/calendar override history" is a reset candidate | PRESERVED |
| **U5** | `company_holiday_preferences` | same | PRESERVED — *"a per-account Training On/Off decision for a company holiday is configuration about a day, not evidence of training"* |

**Executing the RESET INTENT as written requires changing shipped source** —
removing entries from `FRESH_START_PRESERVED_TABLES`, adding five DELETE
statements, and updating the test that guards them. That is a source round with
its own review, not an operator action. **STOP: the controller must decide,
table by table, which of U1–U5 are history and which are configuration.**

My reading, offered as input and not as a decision: `body_weight_entries` is
plainly *measurement history* and belongs with the reset; `today_completions` is
*routine history* and probably does too; `training_flex`,
`holiday_overrides` and `company_holiday_preferences` are *decisions about days*
and the existing reasoning for keeping them still looks right to me — but a
"full activity fresh start" that leaves last month's recovery days and holidays
in the calendar may not read as fresh to the person looking at it.

### UNCLEAR / STOP — everything else

| # | Item | Why it stops |
|---|---|---|
| **U6** | **`account_settings` is PRESERVED, but the new Foundation Day 1 lives in it.** | Writing the new Day 1 is an `UPDATE`/upsert on a protected table. Either the guard is scoped to DELETE only, or `account_settings` needs an explicit carve-out. Undecided in source today. See §9. |
| **U7** | **The existing tool is a CUTOFF reset, not a wipe.** | `shared/freshStart.ts` deletes `workout_date < cutoff` — strictly before. "Full activity fresh start" is only the same thing if no history exists on or after the cutoff. **[LIVE]** L4 settles whether that holds. If the user trains between approval and execution, a `< cutoff` reset keeps that workout. The controller must choose: (a) cutoff = new Day 1, keeping anything already recorded on/after it, or (b) a true total wipe for the account, which the tool cannot currently express. |
| **U8** | **`TRAINING_HISTORY_EPOCH` is a source constant at `2026-08-31`.** | It is the fixed floor achievements and streaks are measured from — deliberately *not* the Foundation start, so a preference cannot rewrite a training fact (Round 18). After a reset it would still open at 2026-08-31 while all surviving history begins later. Harmless for correctness (there is no history before it), but "Day 1 of 100" and "the epoch" would name different dates. Moving it is a **source** change. Decide, do not assume. |
| **U9** | `oauth_states` | Ephemeral, has **no account column at all** — it is keyed by `state_hash` and cannot be account-scoped. An account-scoped reset structurally cannot touch it. Rows self-expire. Classified: leave alone. |
| **U10** | `notification_deliveries` | Operational dedup state keyed by `(subscription_id, trigger_minute)`, self-pruned by `DELETE ... WHERE trigger_minute < ?`. Not activity history; not user configuration. Classified: leave alone, but named here so it is a decision rather than an oversight. |
| **U11** | **How many accounts exist** | **[LIVE]** L1. Every statement in the plan is account-scoped. If more than one `google_sub` has rows, the controller must name exactly which one is being reset — the tool will not guess, and neither will I. |

---

## 5. Dependency and deletion order

Children before parents, assuming cascade does **not** fire.

```
1. workout_set_corrections   (FK → workout_occurrences)
2. workout_calibration       (FK → workout_occurrences)
3. workout_sets              (FK → workout_occurrences)
4. workout_occurrences       (parent)
```

If U1–U5 are approved, they are **independent** — no foreign key on any of them —
and may be deleted in any order, before or after the block above:

```
   body_weight_entries · today_completions · training_flex
   holiday_overrides · company_holiday_preferences
```

Every statement must carry **both** `google_sub = ?` and its date predicate.
Neither is optional. This is already how `shared/freshStart.ts` is written.

---

## 6. Backup / export, and restore

### Before anything — two independent recovery paths, in this order

**A. D1 Time Travel bookmark (primary).** D1 keeps a restorable history; a
bookmark taken immediately before the mutation is the fastest and most faithful
way back.

```bash
npx wrangler d1 time-travel info vshape100v2-auth --remote
# record the bookmark string and the timestamp, verbatim, in the run log
```

**B. Full SQL export held offline (secondary).** Time Travel has a retention
window; a file does not.

```bash
npx wrangler d1 export vshape100v2-auth --remote \
  --output "vshape100v2-auth.PRE-ROUND25.$(date -u +%Y%m%dT%H%M%SZ).sql"

# prove the file is real before trusting it
wc -l  vshape100v2-auth.PRE-ROUND25.*.sql
sha256sum vshape100v2-auth.PRE-ROUND25.*.sql        # record the digest
grep -c "^INSERT INTO" vshape100v2-auth.PRE-ROUND25.*.sql
for t in workout_occurrences workout_sets workout_calibration workout_set_corrections \
         body_weight_entries today_completions training_flex holiday_overrides \
         company_holiday_preferences programme_slots exercise_input_types; do
  printf '%-30s %s\n' "$t" "$(grep -c "INSERT INTO \"\?$t\"\?" vshape100v2-auth.PRE-ROUND25.*.sql)"
done
```

An export that cannot be counted is not a backup. Do not proceed until both A
and B exist and B has been verified.

### Restore

**Preferred — Time Travel:**

```bash
npx wrangler d1 time-travel restore vshape100v2-auth --remote --bookmark=<recorded bookmark>
npx wrangler d1 execute vshape100v2-auth --remote \
  --command "SELECT COUNT(*) FROM workout_occurrences;"   # against the before-fingerprint
```

**Fallback — the SQL export.** Do **not** replay it into the live database: the
export contains `CREATE TABLE` and `INSERT` for rows that still exist, so it will
collide. Restore it into a **new** D1 database, verify it, then repoint the
binding:

```bash
npx wrangler d1 create vshape100v2-auth-restore
npx wrangler d1 execute vshape100v2-auth-restore --remote --file=vshape100v2-auth.PRE-ROUND25.*.sql
# verify counts, then update database_id in wrangler.jsonc and redeploy
```

**Source rollback is not data rollback.** Reverting `main` to the checkpoint
restores no row. The two are separate levers and must be pulled separately.

---

## 7. Pre-reset fingerprint — run this FIRST, read-only

Substitute the approved `<SUB>`. Nothing here writes.

```sql
-- Which accounts exist at all, and how much each holds. [LIVE] L1.
SELECT google_sub, COUNT(*) AS occurrences,
       MIN(workout_date) AS first_date, MAX(workout_date) AS last_date
  FROM workout_occurrences GROUP BY google_sub;

-- Per-table, for the named account, split on the boundary.
SELECT 'workout_occurrences'     t, COUNT(*) n FROM workout_occurrences     WHERE google_sub='<SUB>'
UNION ALL SELECT 'workout_sets',            COUNT(*) FROM workout_sets            WHERE google_sub='<SUB>'
UNION ALL SELECT 'workout_calibration',     COUNT(*) FROM workout_calibration     WHERE google_sub='<SUB>'
UNION ALL SELECT 'workout_set_corrections', COUNT(*) FROM workout_set_corrections WHERE google_sub='<SUB>'
UNION ALL SELECT 'body_weight_entries',     COUNT(*) FROM body_weight_entries     WHERE google_sub='<SUB>'
UNION ALL SELECT 'today_completions',       COUNT(*) FROM today_completions       WHERE google_sub='<SUB>'
UNION ALL SELECT 'training_flex',           COUNT(*) FROM training_flex           WHERE google_sub='<SUB>'
UNION ALL SELECT 'holiday_overrides',       COUNT(*) FROM holiday_overrides       WHERE google_sub='<SUB>'
UNION ALL SELECT 'company_holiday_preferences', COUNT(*) FROM company_holiday_preferences WHERE google_sub='<SUB>';

-- THE PROTECTED FINGERPRINT. Every one of these must be IDENTICAL afterwards.
SELECT 'programme_revisions'  t, COUNT(*) n FROM programme_revisions  WHERE google_sub='<SUB>'
UNION ALL SELECT 'programme_exercises',  COUNT(*) FROM programme_exercises  WHERE google_sub='<SUB>'
UNION ALL SELECT 'programme_slots',      COUNT(*) FROM programme_slots      WHERE google_sub='<SUB>'
UNION ALL SELECT 'exercise_media',       COUNT(*) FROM exercise_media       WHERE google_sub='<SUB>'
UNION ALL SELECT 'exercise_input_types', COUNT(*) FROM exercise_input_types WHERE google_sub='<SUB>'
UNION ALL SELECT 'push_subscriptions',   COUNT(*) FROM push_subscriptions   WHERE google_sub='<SUB>'
UNION ALL SELECT 'auth_sessions',        COUNT(*) FROM auth_sessions
UNION ALL SELECT 'company_holidays',     COUNT(*) FROM company_holidays;

-- The programme in full, so its content is proven unchanged, not just its count.
SELECT revision FROM programme_revisions WHERE google_sub='<SUB>';
SELECT session_id, position, exercise_id, set_count, result_kind, target_min, target_max,
       per_side, equipment
  FROM programme_slots WHERE google_sub='<SUB>'
 ORDER BY session_id, position;

-- The current Foundation Day 1 and the ledger.
SELECT google_sub, foundation_start_date FROM account_settings WHERE google_sub='<SUB>';
SELECT name FROM sqlite_schema WHERE type='table' ORDER BY name;   -- confirms L3, expect the 20
```

The repo's own `freshStartInventory()` produces the boundary-split counts for the
four workout tables, and `scripts/fresh-start.mjs` prints them in dry-run mode
without `--execute`. Use it — it is already tested.

### Expected post-reset counts

| Table | Expected after |
|---|---|
| `workout_occurrences`, `workout_sets`, `workout_calibration`, `workout_set_corrections` | **0** for the account, if cutoff ≥ latest `workout_date`; otherwise exactly the "kept" count from the before-fingerprint |
| Orphan sets / calibration / corrections | **0**, unconditionally |
| U1–U5, **if and only if approved** | 0 for the account |
| `programme_*`, `exercise_media`, `exercise_input_types`, `push_subscriptions`, `auth_sessions`, `company_holidays` | **byte-identical to before** |
| `account_settings.foundation_start_date` | the new approved Day 1, and **nothing else in the row changed** |

---

## 8. The exact proposed mutation plan — **NOT EXECUTED**

### Phase 0 — approvals (all of them, in writing)

1. The `google_sub` to reset, stated explicitly. **[LIVE] L1.**
2. A decision on **U1–U5** — which of the five contested tables are history.
3. A decision on **U7** — cutoff semantics or total wipe.
4. A decision on **U8** — does `TRAINING_HISTORY_EPOCH` move.
5. The new **Foundation Day 1** (§9).
6. Backup A and B in hand, B verified.

### Phase 1 — dry run, read-only, no flags

```bash
node scripts/fresh-start.mjs --account <SUB> --cutoff <NEW_DAY_1> --remote
```

Prints the boundary-split inventory and the SQL it *would* run. It does not
execute without `--execute`. Compare every number against §7.

### Phase 2 — the destructive command, as ONE transaction

`shared/freshStart.ts` emits exactly this, in this order — children first, and
every statement carrying both the account and the boundary:

```sql
DELETE FROM workout_set_corrections WHERE google_sub = '<SUB>' AND workout_date < '<NEW_DAY_1>';
DELETE FROM workout_calibration     WHERE google_sub = '<SUB>' AND workout_date < '<NEW_DAY_1>';
DELETE FROM workout_sets            WHERE google_sub = '<SUB>' AND workout_date < '<NEW_DAY_1>';
DELETE FROM workout_occurrences     WHERE google_sub = '<SUB>' AND workout_date < '<NEW_DAY_1>';
```

D1 executes a multi-statement command as a single transaction, and D1 rejects
explicit `BEGIN`/`SAVEPOINT` — so the command itself is the all-or-nothing
boundary. This was measured against a local D1, not assumed.

```bash
node scripts/fresh-start.mjs --account <SUB> --cutoff <NEW_DAY_1> --remote \
  --execute --i-understand-this-deletes-history --confirm-account <SUB>
```

### Phase 2b — **ONLY IF U1–U5 ARE APPROVED. DOES NOT EXIST YET.**

These statements are **not** in the codebase and **cannot** be run by the current
tool — `FRESH_START_PRESERVED_TABLES` protects all five and a test asserts it.
Written here as the proposal, not as something available:

```sql
DELETE FROM body_weight_entries         WHERE google_sub = '<SUB>' AND local_date   < '<NEW_DAY_1>';
DELETE FROM today_completions           WHERE google_sub = '<SUB>' AND anchor_day   < '<NEW_DAY_1>';
DELETE FROM training_flex               WHERE google_sub = '<SUB>' AND local_date   < '<NEW_DAY_1>';
DELETE FROM holiday_overrides           WHERE google_sub = '<SUB>' AND end_date     < '<NEW_DAY_1>';
DELETE FROM company_holiday_preferences WHERE google_sub = '<SUB>' AND holiday_date < '<NEW_DAY_1>';
```

Note `holiday_overrides` is a **range** (`start_date`, `end_date`): `end_date <
cutoff` removes only holidays that finished before the new Day 1 and correctly
keeps one spanning the boundary. That is a judgement embedded in a predicate and
needs approving on its own.

Delivering Phase 2b requires a source change with review: remove those entries
from the guard, add the statements, extend the inventory and orphan checks,
update `freshStart.test.ts` and `freshStartOperator.test.ts`.

### Phase 3 — the new Foundation Day 1

```sql
UPDATE account_settings SET foundation_start_date = '<NEW_DAY_1>', updated_at = <now>
 WHERE google_sub = '<SUB>';
```

`account_settings` is currently a protected table (**U6**). Resolve that before
running this, and prefer the existing Settings UI, which already validates the
date and writes through the tested route.

### Phase 4 — nothing else

No derived value is written by hand. Streaks, Achievements, Personal Bests,
Exercise Performance and progression are computed from the surviving rows on
every read and correct themselves. Writing one would be inventing a number the
data no longer supports.

---

## 9. Foundation Day 1 — **USER APPROVAL REQUIRED**

**The value:** `account_settings.foundation_start_date` — `TEXT`, format
`YYYY-MM-DD`, nullable, one row per `google_sub` (migration 0011).

**Why it must be given explicitly, and why I will not choose it:**

- It is the date the whole product counts from. `Day N / 100` on Today, the
  Progress window and the Calendar all derive from it.
- **When it is `NULL`, the app falls back to the source constant
  `DEFAULT_FOUNDATION_START = '2026-08-31'`.** So doing nothing is not neutral:
  after a reset, the app would silently keep counting from 31 August 2026 as
  though the last hundred days had not been erased. **The reset is not complete
  until this value is set.**
- It is also the natural **cutoff** for every statement in §8 — the same value
  appears as the boundary and as the new Day 1, which is what makes the reset
  coherent. Choosing it wrong deletes the wrong days.
- It is a real-world decision about when the user intends to restart training.
  Nothing in the source or the database implies it.

**Required from the controller:** one date, `YYYY-MM-DD`, plus confirmation that
the same value is intended as **both** the deletion boundary and the new
Foundation Day 1 — or, if they are meant to differ, both values stated
separately and the reason.

Related, and separate: **U8** — whether `TRAINING_HISTORY_EPOCH` (`2026-08-31`,
a source constant, the floor achievements measure from) moves with it.

---

## 10. Pre / post verification checklist

**Before** — all must hold, or stop:

- [ ] `main` = `01f06da…`; checkpoint = `7213f3b1…`
- [ ] Time Travel bookmark recorded verbatim **[LIVE] L5**
- [ ] SQL export taken, `sha256` recorded, per-table INSERT counts recorded
- [ ] Live schema confirmed as the 20 tables of ledger 0001–0015 **[LIVE] L3**
- [ ] `wrangler d1 migrations list vshape100v2-auth --remote` → **no pending**
- [ ] Account list obtained; the target `google_sub` named explicitly **[LIVE] L1**
- [ ] Before-fingerprint captured (§7), including the full programme content
- [ ] U1–U11 each decided in writing
- [ ] New Foundation Day 1 approved (§9)
- [ ] Dry run reviewed; its numbers match the fingerprint

**After** — all must hold, or restore:

- [ ] Reset tables at their expected counts (§7)
- [ ] All three orphan checks return **0** (`freshStartOrphanChecks()`)
- [ ] Programme revision, exercises and **every slot row** byte-identical to before
- [ ] `exercise_media`, `exercise_input_types`, `push_subscriptions` counts identical
- [ ] `company_holidays` count identical
- [ ] `auth_sessions` untouched — the user is still signed in
- [ ] `foundation_start_date` = the approved date; nothing else in the row changed
- [ ] Migration ledger still **0001–0015**, none pending
- [ ] UI: Today shows Day 1, Training shows the unchanged week, Progress and
      Achievements show empty-but-honest states, Exercise Library intact,
      `/settings/programme` intact
- [ ] Push reminders still fire on a registered device

---

## 11. No production mutation occurred

**No `DELETE`, `UPDATE`, `INSERT` or DDL was executed against any database in
producing this analysis.** No D1 reset. No migration applied. No deploy. No
schema change. No V1 repository, site or resource accessed. No unrelated repo
touched. No Round 23 work revived. No feature created.

This session could not have mutated production even by mistake: it holds no
Cloudflare credentials and its egress policy denies `api.cloudflare.com`. Every
statement above is text in a document.

Everything here is derived from `migrations/0001`–`0015`, `shared/freshStart.ts`,
`scripts/fresh-start.mjs`, `wrangler.jsonc` and the Worker source at
`01f06da8abf47cfde4c5c18b1da2dbbd00a6f317`.
