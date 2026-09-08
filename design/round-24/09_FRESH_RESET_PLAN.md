# Round 24 — Stage G: Fresh Reset contract

**NO DESTRUCTIVE ACTION IS AUTHORIZED OR PERFORMED BY THIS ROUND.**
Nothing in this document has been executed. No production D1 was read, written or
inspected during Round 24; every statement below is derived from
`migrations/0001–0015`, `worker/**/d1Store.ts`, `shared/freshStart.ts` and
`scripts/fresh-start.mjs` at `7213f3b1`.

---

## 0. The finding that changes this stage

The Round 24 package asks us to *prepare* a Fresh Reset contract. **One already exists, is
tested, and is stronger than the package assumed.**

`shared/freshStart.ts` + `scripts/fresh-start.mjs` are an accepted, operator-only,
account-scoped, date-bounded history reset:

- **Pure SQL builder.** `shared/freshStart.ts` opens no connection and reads no
  environment. It cannot reach production by itself.
- **No HTTP route.** Deliberately not an endpoint — "a destructive reset behind a URL is
  one authentication bug away from deleting someone's training history."
- **Inventory is the default.** Running the script with no mode flag prints counts on
  **both** sides of the cutoff and writes nothing.
- **The account is never inferred.** `--account` is mandatory, must match `--confirm-account`
  exactly, and is validated against a narrow embeddable-character allowlist twice.
- **`--remote` is required** to touch the deployed database; otherwise everything runs local.
- **Execution needs three flags**: `--execute`, `--i-understand-this-deletes-history`,
  `--confirm-account <same key>`.
- **One atomic command.** The four deletes are a single multi-statement `wrangler d1 execute
  --command`, which was *measured* to be atomic on D1. A half-reset is not reachable.
- **Children deleted explicitly, in dependency order** — corrections → calibration → sets →
  occurrences — because "D1 does not guarantee foreign keys are enforced for a given
  statement." Correct, and the right instinct.
- **Orphan proof afterwards.** `freshStartOrphanChecks()` asserts zero orphan sets,
  calibration and corrections.
- **A preserved-table assertion**, checked by `src/test/freshStart.test.ts:327` against the
  generated SQL.

**Therefore Round 24's Stage G deliverable is not "design a reset". It is: publish the
table-by-table matrix, state exactly what the existing operator does and does not cover,
and name the gaps a controller must close before authorizing anything.**

---

## 1. Table inventory and classification

20 tables across migrations 0001–0015. "Account-scoped" means the table carries
`google_sub` and every store keys on it, so a reset can be aimed at one account.

Classification: **PROTECTED** (never reset) · **DECISION** (valuable configuration; the
controller must choose) · **CANDIDATE** (real training evidence, resettable by contract).

| # | Table | Created | Scope | Holds | Class | Reason |
|---|---|---|---|---|---|---|
| 1 | `oauth_states` | 0001 | none (transient) | 10-minute single-use OIDC state | **PROTECTED** | Infrastructure. Rows expire on their own; deleting a live one breaks an in-flight sign-in. |
| 2 | `auth_sessions` | 0001 | `google_sub` col | `sha256(token)` per device | **PROTECTED** | Deleting it signs the user out of every device. Identity, not history. |
| 3 | `today_completions` | 0002 | ✅ PK | which Today occurrences were ticked | **DECISION** | Real behavioural evidence, but *not* training evidence. Currently **preserved** by the operator. |
| 4 | `exercise_media` | 0003 | ✅ PK | demo media per exercise identity | **PROTECTED** | Configuration the user curated by hand. Currently preserved. |
| 5 | `workout_occurrences` | 0004 (+0009 `kind`, `source_session_id`; +0014 `touched_at`) | ✅ PK | one started workout, with its frozen header snapshot | **CANDIDATE** | The parent of all training evidence. |
| 6 | `workout_sets` | 0004 (+0013 `input_type_snapshot`, `actual_band_*`) | ✅ PK | every expected set + what was logged | **CANDIDATE** | The training evidence itself. FK → 5, `ON DELETE CASCADE`. |
| 7 | `holiday_overrides` | 0005 (+0006 `name`, `training_on`) | ✅ PK | the user's own Holidays | **DECISION** | Calendar configuration/history. Currently preserved. |
| 8 | `company_holidays` | 0006 | **GLOBAL, seeded** | company holiday dates + names | **PROTECTED** | System seed truth, shared by every account. Deleting it breaks the Calendar for everyone. |
| 9 | `company_holiday_preferences` | 0006 | ✅ PK | Training On/Off per company holiday | **DECISION** | Per-account configuration. **Not currently named in the preserved-table assertion — gap G-3 below.** |
| 10 | `push_subscriptions` | 0007 | ✅ PK | this account's push endpoints | **PROTECTED** | Device configuration. Deleting it silently stops reminders with no user-visible cause. |
| 11 | `notification_deliveries` | 0007 | ✅ col | per-minute delivery claims | **CANDIDATE (operational)** | Delivery bookkeeping, not user data. **Has no declared FK to 10** — see gap G-2. |
| 12 | `body_weight_entries` | 0008 | ✅ PK | one weight per local date, in tenths of a kg | **DECISION** | Real historical evidence, and the thing Progress's main chart is made of. Currently preserved. |
| 13 | `workout_calibration` | 0009 | ✅ PK | "too light / good / too heavy" per exercise slot | **CANDIDATE** | Derived from a workout. FK → 5, `ON DELETE CASCADE`. |
| 14 | `account_settings` | 0011 | ✅ PK | Foundation start date | **PROTECTED** | One row that renumbers every Foundation day and milestone. Currently preserved. |
| 15 | `training_flex` | 0012 | ✅ PK | today's Recovery / Fitness Boxing 2 choice per date | **DECISION** | "A decision about a day, not training evidence" — the operator's own words. Currently preserved. |
| 16 | `exercise_input_types` | 0013 | ✅ PK | canonical modality per exercise | **PROTECTED** | Equipment configuration — "a fact about the user's gym, not a record of anything they did." Currently preserved. |
| 17 | `workout_set_corrections` | 0014 | ✅ col | immutable before/after audit of a corrected set | **CANDIDATE** | Belongs to the workout it describes. FK → 5, `ON DELETE CASCADE`. |
| 18 | `programme_revisions` | 0015 | ✅ PK | monotonic revision + write token | **PROTECTED** | The optimistic-lock anchor. Deleting it is not "reset the programme", it is "lose the concurrency control". |
| 19 | `programme_exercises` | 0015 | ✅ PK | the account's canonical exercises | **PROTECTED** | The user's programme. Deleting it orphans every historical set's exercise identity for display purposes. |
| 20 | `programme_slots` | 0015 | ✅ PK | which exercise sits where, on which weekday | **PROTECTED** | The user's training week. |

### What the existing operator actually does

`freshStartStatements()` names **exactly four tables**: 17, 13, 6, 5 — in that order, each
carrying **both** `google_sub = ?` and `workout_date < ?`.

Everything else is preserved *by construction*, because no statement mentions it.

```
DELETE FROM workout_set_corrections WHERE google_sub = ? AND workout_date < ?;
DELETE FROM workout_calibration     WHERE google_sub = ? AND workout_date < ?;
DELETE FROM workout_sets            WHERE google_sub = ? AND workout_date < ?;
DELETE FROM workout_occurrences     WHERE google_sub = ? AND workout_date < ?;
```

`< cutoff` is strict, deliberately: a workout dated exactly on the cutoff is the first day
of the new Foundation and must survive.

---

## 2. Gaps a controller must close before authorizing anything

These are the honest deltas between what exists and what a Round-24-era reset would need.
**None of them is fixed by this round** — each is a proposal requiring separate approval.

### G-1 · The operator test does not exercise the current schema
`src/test/freshStartOperator.test.ts` builds its in-memory database from a migration chain
that **stops at `0014`**. Migration `0015_programme_builder.sql` is never applied, so the
operator path has never been executed against the schema as it now stands.

**Proposed fix (small, safe, testing only):** add `migration0015` to the `CHAIN`.
This changes no production behaviour and no SQL. It is the single highest-value
pre-reset action available.

### G-2 · `notification_deliveries` has no declared foreign key
It carries `subscription_id` and `google_sub` but declares no FK to `push_subscriptions`.
Nothing in the current reset touches either table, so this is not a live bug — but any
future reset that removes push subscriptions must delete delivery rows explicitly, exactly
as the workout children are deleted explicitly today. Do not assume a cascade.

### G-3 · The preserved-table assertion is four tables out of date
`FRESH_START_PRESERVED_TABLES` (`shared/freshStart.ts:324`) does not list:

- `programme_revisions`
- `programme_exercises`
- `programme_slots`
- `company_holiday_preferences`

The reset does not touch them, so nothing is currently at risk. But the assertion in
`src/test/freshStart.test.ts:327` is the guard that stops a *future* statement from
touching a protected table, and four protected tables are outside that guard.

**Proposed fix (small, safe):** add all four to the array. It is a strengthening of an
existing test, not a behaviour change.

### G-4 · "Fresh restart" and "history cutoff reset" are not the same request
The package says the user "intends to restart before meaningful real-use history exists."
The existing operator resets **workout history before a date**. It preserves — by explicit,
reasoned design — `today_completions`, `body_weight_entries`, `training_flex`,
`holiday_overrides` and `company_holiday_preferences`.

If the controller's intent is *"Foundation Day 1 again, everything from before gone"*, then
the four DECISION tables above are in scope and **the operator does not cover them today**.
Extending it is a separate authorization with its own statements, its own inventory
counters, its own orphan checks and its own preserved-table assertion.

**This is a question for the controller, not an assumption for us.** See §5.

### G-5 · Source rollback is not data rollback
`checkpoint/pre-round24-redesign` → `7213f3b1` protects **source only**. Restoring it after
a destructive reset recreates no D1 row. Any reset authorization must carry its own
backup/export and restore procedure. This is stated again because it is the single easiest
thing to conflate.

---

## 3. Reset-safety checklist (the package's ten points, answered)

| # | Requirement | Status at `7213f3b1` |
|---|---|---|
| 1 | Exact main / source / production identity | ✅ `main` = `7213f3b1`; Worker `dacd8771-56c3-4308-a394-9b42206d0a92` |
| 2 | Exact migration ledger | ✅ `0001–0015`, listed in §1 |
| 3 | Read-only table inventory | ✅ §1 (from migrations; **no production row counts were read**) |
| 4 | Target-account scoping proof | ✅ every statement carries `google_sub = ?`; `--account` is mandatory and never inferred |
| 5 | Protected-data fingerprint | ⚠️ **partial** — `FRESH_START_PRESERVED_TABLES` exists and is asserted, but is missing four tables (G-3) |
| 6 | Backup / export | ❌ **not implemented.** No export step exists in the operator. A controller-authorized reset must add one, or accept the loss explicitly |
| 7 | Explicit controller approval | ✅ three independent flags, one of which repeats the account key |
| 8 | Bounded reset action | ✅ four named tables, one account, `workout_date < cutoff` |
| 9 | Post-reset row-count verification | ✅ `freshStartInventory()` is re-runnable after execution and reports both sides |
| 10 | Login / bootstrap smoke | ⚠️ **manual.** `auth_sessions`, `account_settings` and the `programme_*` tables are untouched, so login and bootstrap should be unaffected — but nothing automates the check |
| 11 | Today / Training / Progress / Calendar integrity smoke | ⚠️ **manual** |
| 12 | Protected-data fingerprint unchanged | ⚠️ **partial** — see 5 |

No `DROP DATABASE` / recreate strategy exists anywhere in the codebase, and none is
proposed.

---

## 4. Expected post-reset state, per table

Assuming the **existing** operator run with `cutoff = <restart date>`, one account:

| Table | After |
|---|---|
| `workout_occurrences` | only rows with `workout_date >= cutoff` |
| `workout_sets` | only rows with `workout_date >= cutoff`; zero orphans |
| `workout_calibration` | only rows with `workout_date >= cutoff`; zero orphans |
| `workout_set_corrections` | only rows with `workout_date >= cutoff`; zero orphans |
| every other table | **byte-identical** — no statement names it |

Derived surfaces need no repair and must not be hand-edited: Recent Workouts, Personal
Bests, Exercise Performance, streaks, Achievements and Round 16 progression are all
recomputed from the surviving rows on every read. Writing a counter or a PB by hand would
invent a number the data no longer supports.

---

## 5. What still needs a controller decision

These are carried into `10_DEFERRED_AND_APPROVALS.md` and are repeated here because they
gate any destructive step:

- **Q-R1 · Scope.** Is the intended restart a *workout-history cutoff* (what the operator
  does today), or a *full fresh start* that also clears `body_weight_entries`,
  `today_completions`, `training_flex`, `holiday_overrides` and
  `company_holiday_preferences`? These are different authorizations.
- **Q-R2 · Backup.** Is a D1 export required before execution, or is the loss accepted in
  writing? The operator does not export today.
- **Q-R3 · Cutoff date.** The exact local `YYYY-MM-DD`. `< cutoff` is strict.
- **Q-R4 · Account key.** The exact `google_sub`. It is never inferred, and this document
  deliberately does not contain one.
- **Q-R5 · Pre-reset hygiene.** Approve G-1 (add migration 0015 to the operator test chain)
  and G-3 (complete the preserved-table list) *before* any reset. Both are test-only or
  assertion-only, and both make the reset safer to approve.

---

## 6. Standing rule

**Round 24 does not authorize a reset. Nothing above has been executed, and the operator's
inventory mode has not been run against production either — running it would require the
account key and `--remote`, neither of which this round has or wants.**
