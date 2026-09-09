# Round 25 — the full-activity reset contract

## Stage 2 — source, tool and tests. **NOTHING WAS EXECUTED.**

Baseline `01f06da8abf47cfde4c5c18b1da2dbbd00a6f317`. Stage 1 analysis accepted at
`afd3632`; the controller's decisions are implemented here.

---

## 1. Why this is a new tool

Round 18's `shared/freshStart.ts` deletes training history **strictly before a
cutoff**, across four tables. Round 25 empties **nine tables entirely** for one
account. Different operation, different meaning.

Widening the Round 18 tool in place would silently change what a reviewed,
released tool does, and the two would be indistinguishable afterwards. So it is
left exactly as it is, and Round 25 is a separate contract, a separate operator
script and separate tests.

The one thing they share is `renderStatement` / `isEmbeddableValue`. There must
be exactly **one** implementation of "refuse to embed an unsafe value" — a
second one is a second chance to get it wrong.

---

## 2. The reset / preserve matrix

### RESET — every row for the target account, no date predicate

| # | Table | Order rationale |
|---|---|---|
| 1 | `workout_set_corrections` | FK child of `workout_occurrences` |
| 2 | `workout_calibration` | FK child |
| 3 | `workout_sets` | FK child |
| 4 | `workout_occurrences` | parent |
| 5 | `body_weight_entries` | independent |
| 6 | `today_completions` | independent |
| 7 | `training_flex` | independent |
| 8 | `holiday_overrides` | independent |
| 9 | `company_holiday_preferences` | independent |

Children before the parent because **D1 does not guarantee foreign keys are
enforced for a given statement**. All three cascades are declared, none is
relied on: in this order no orphan survives whether cascade fires or not.

### PRESERVE — never appears in a DELETE, asserted by test

`auth_sessions` · `oauth_states` · `push_subscriptions` ·
`notification_deliveries` · `exercise_media` · `exercise_input_types` ·
`programme_revisions` · `programme_exercises` · `programme_slots` ·
`company_holidays`

Two of these are protected twice over: `company_holidays` and `oauth_states`
have **no account column at all**, so an account-scoped statement is
structurally incapable of reaching them, and neither is ever named.

### WRITTEN, NOT EMPTIED — exactly one table, exactly one column

`account_settings.foundation_start_date`, through byte-for-byte the same upsert
`worker/settings/d1Store.ts` uses. `created_at` is never rewritten — a reset must
not move when the account first chose a start date.

That upsert also **creates** the row when none exists. This matters: with no row
the app falls back to `DEFAULT_FOUNDATION_START = '2026-08-31'`, so a reset that
only deleted would leave the app counting from last August over no data at all.

---

## 3. The generated SQL

One command, ten statements, atomic. D1 rejects explicit `BEGIN`/`SAVEPOINT`, and
a multi-statement command runs as a single transaction — measured against a local
D1 in Round 18, not assumed. The Foundation write is **last and inside it**, so
the operation is all-or-nothing.

```sql
DELETE FROM workout_set_corrections     WHERE google_sub = '<SUB>';
DELETE FROM workout_calibration         WHERE google_sub = '<SUB>';
DELETE FROM workout_sets                WHERE google_sub = '<SUB>';
DELETE FROM workout_occurrences         WHERE google_sub = '<SUB>';
DELETE FROM body_weight_entries         WHERE google_sub = '<SUB>';
DELETE FROM today_completions           WHERE google_sub = '<SUB>';
DELETE FROM training_flex               WHERE google_sub = '<SUB>';
DELETE FROM holiday_overrides           WHERE google_sub = '<SUB>';
DELETE FROM company_holiday_preferences WHERE google_sub = '<SUB>';
INSERT INTO account_settings
     (google_sub, foundation_start_date, created_at, updated_at)
   VALUES ('<SUB>', '<NEW_DAY_1>', <now>, <now>)
   ON CONFLICT (google_sub)
   DO UPDATE SET foundation_start_date = excluded.foundation_start_date,
                 updated_at            = excluded.updated_at;
```

Every delete is generated from **one loop** over `ROUND25_RESET_TABLES`, so an
unscoped statement cannot be introduced by editing a single line. Values are
never concatenated by the caller: `renderStatement` checks each against a narrow
allowlist and throws rather than escaping.

---

## 4. The safety contract

| | |
|---|---|
| **Inventory is the default** | With no mode flag the operator reads all nine counts, fingerprints every preserved domain, counts every other account's rows, and writes nothing. There is no path from the default mode to a mutation. |
| **The account is explicit** | Never inferred. No "the only account", no "the latest session". |
| **The date is explicit** | Never inferred. No "today". |
| **Four confirmations to execute** | `--execute`, `--i-understand-this-deletes-all-activity`, `--confirm-account <sub>` repeating the key exactly, `--confirm-foundation-start <date>` repeating the date exactly. Neither confirmation can be satisfied by repeating the other. |
| **Remote is explicit** | Without `--remote` everything runs against the LOCAL D1. |
| **One atomic command** | Nine deletes plus the Foundation write. |
| **No secrets in the file** | No account id, token or database id. |
| **Acceptance is decided, not left to the reader** | The script computes `emptied`, `noOrphans`, `preserved`, `isolated`, `foundationSet` and exits non-zero if any fails. |

---

## 5. Pre / post proofs the tool produces

- **Inventory** — all nine reset tables, for the target account.
- **Preserved fingerprint** — eleven readings, each a count *and a content
  digest* where content matters (programme revision, exercises, slots, media,
  input types, push subscriptions, auth, oauth, deliveries, global holidays, and
  `account_settings` columns **other than** the one this reset may write). Equal
  before and after is the proof.
- **Isolation** — every other account's rows across all nine tables. Equal before
  and after is the proof that one account's reset cannot reach another's.
- **Orphans** — deliberately global, not account-scoped: an orphan anywhere is a
  bug, whoever it belongs to.
- **Foundation** — read back separately, because it is the one value expected to
  change.

---

## 6. `TRAINING_HISTORY_EPOCH` — proven, not assumed. **No source change proposed.**

The worry was real and worth chasing. After a full reset the account has no rows,
the new Day 1 sits weeks after the epoch, and the Achievements window still opens
at the epoch — so the model evaluates a stretch of scheduled weekdays containing
nothing, and `outcomeFor` calls each of them a `failure`.

`src/test/round25PostResetTruth.test.ts` proves what those failures can do:

- a failure only ever **stops** a run (`currentStreak`) or **resets** it
  (`bestStreak`). Nothing counts failures, nothing subtracts them, and there is
  no missed-day tally anywhere in the app.
- `Consistency` reads `best`; the milestones read `best`, `current` and
  `qualifyingSessions`; and `qualifyingSessions` is counted from the logs
  themselves, so an empty log counts nothing.
- **the facts are byte-identical whether the window opens at the epoch, at the
  new Day 1, or one day earlier** — asserted directly, so the property is
  permanent rather than argued.
- an emptied account evaluates to `{ current: 0, best: 0, qualifyingSessions: 0 }`
  with status `ready` — not a refusal, so a fresh account does not stare at
  "could not be loaded".

**Conclusion: the epoch does not need to move, and Round 25 proposes no source
correction on this point.** Moving it would be an aesthetic change to a value
whose own comment says it is "a statement about what the DATABASE can contain,
not about what any user prefers" — and it would reintroduce exactly the coupling
Round 18 Correction 1 removed. The tests are written so that they fail if a
future surface ever starts counting failures.

---

## 7. Mutation evidence

Seven mutations were applied to the shipped source and the suite re-run. Every
one was caught:

| Mutation | Result |
|---|---|
| add `programme_slots` to the reset list (a DELETE against a protected table) | **5 tests fail** |
| drop `WHERE google_sub = ?` from every delete | **4 tests fail** |
| omit `today_completions` from the nine | **2 tests fail** |
| make the settings upsert also rewrite `created_at` | **4 tests fail** |
| remove the `--i-understand-this-deletes-all-activity` requirement | **1 test fails** |
| remove the `--confirm-account` match | **1 test fails** |
| let inventory mode fall through and execute | **1 test fails** |

---

## 8. Remaining LIVE blockers — unchanged from Stage 1

Cloudflare access is still unavailable here: no credentials, and the egress
policy denies `api.cloudflare.com`. V START must still begin with:

1. live schema confirmation — the 20 tables of ledger 0001–0015
2. the exact account list, and the target `google_sub` named explicitly
3. live row counts (the tool's default inventory mode produces them)
4. a D1 Time Travel bookmark, recorded verbatim
5. a verified offline SQL export
6. the user-approved Foundation Day 1

None of these was invented. No count, no `google_sub` and no bookmark appears
anywhere in this round's source or tests except as obviously synthetic fixtures
(`sub-mine`, `sub-theirs`).

---

## 9. No production mutation occurred

No `DELETE`, `UPDATE`, `INSERT` or DDL against any real database. No D1 reset, no
migration applied, no deploy, no schema change, no V1, no unrelated repo. The
only database touched was an in-memory SQLite built from the migration files in
this repository, inside the test process.
