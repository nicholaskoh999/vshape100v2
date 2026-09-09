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

## 4b. The outcome state machine — an unacknowledged mutation is never re-sent

**Correction A.** The first version awaited the destructive command and only
reconciled if that call returned. A transport error propagated straight out, so
an operator who saw a failure could not tell whether the reset had happened —
and the obvious next move, running it again, is catastrophic if it did.

D1 can **durably commit and still fail to acknowledge**: a dropped connection, a
killed Wrangler process, a gateway timeout. An error means *the outcome is
unknown*, never *nothing happened*.

```
              ┌──────────────────────────────┐
              │ send the command  (attempt 1)│   ← the ONLY call site
              └───────────────┬──────────────┘
                  returns ────┴──── throws
                      │               │  (error captured, NEVER rethrown,
                      │               │   NEVER re-sent)
                      └──────┬────────┘
                             ▼
                 ┌───────────────────────┐
                 │ reconcile (READ ONLY) │
                 └───────────┬───────────┘
                 reads fail ──┴── reads succeed
                      │              │
                      ▼              ▼
                 AMBIGUOUS      ┌────────────────────────────────┐
                 reconciled:    │ nine tables all 0 AND          │
                 false          │ foundation == approved date ?  │
                 exit 3         └───┬──────────────────┬─────────┘
                                yes │               no │
                                    ▼                  ▼
                              COMMITTED      ┌──────────────────────────────┐
                              exit 0 / 2     │ was the send ACKNOWLEDGED,   │
                                             │ and is the state unchanged ? │
                                             └──┬────────────────────┬──────┘
                                            yes │                 no │
                                                ▼                    ▼
                                        NOT_COMMITTED           AMBIGUOUS
                                        exit 4                  exit 3
                                        acknowledged and        outcome unknown
                                        inert — a fault.        — restore from
                                        STOP, investigate       the bookmark.
                                        the transport.          STOP.
```

`COMMITTED` wins when both proofs could hold at once — an account that was
already empty and already carried the new date is in the intended final state,
and that is what the operator needs to know. The proof stands whether or not the
transport acknowledged, because it is a statement about the **state**, not about
the send.

### Why matching counts are not a proof of "nothing happened"

An earlier version classified `NOT_COMMITTED` from counts alone. That is not
sound after an unacknowledged send:

- the reset can have committed and **concurrent writes can have put rows back** —
  a workout started during the operator window recreates an occurrence and its
  sets
- the Foundation date **may already have equalled** the approved value, so it
  distinguishes nothing
- counts describe how many rows exist, never whether they are the **same rows**

A post-state cannot tell *never deleted* from *deleted and repopulated*. So an
unacknowledged send whose final state is not provably the intended one buys
`AMBIGUOUS` and nothing better — even when every count matches exactly, which is
its own regression case.

`NOT_COMMITTED` survives for one narrow situation only: **the send was
acknowledged and had no effect.** A command that reports success and changes
nothing is a fault in its own right, so it is reported to be investigated. **No
outcome is ever an instruction to send the destructive command again.**

**Acceptance is a stricter, separate question** from whether it committed:

```
accepted = COMMITTED
         && stable preserved content unchanged
         && every other account unchanged
         && target account owns no orphan
         && no NEW orphan anywhere
```

Exit codes: `0` committed and accepted · `1` refused before anything was sent ·
`2` committed but an acceptance condition failed · `3` **AMBIGUOUS**, the one
that must never be answered by sending the command again · `4` `NOT_COMMITTED`,
acknowledged and inert.

### Proof that the destructive command cannot run twice

- `round25Transaction(` is **called on exactly one line** of the operator — a
  regex over the script's own source asserts `callSites.length === 1`, and the
  same test asserts there is no retry construct (`for (…attempt`, `while (…retr`,
  `retry(`) anywhere in the file.
- `attempts` is incremented immediately before the send and returned. It is `0`
  for every refusal and for inventory mode, and **1** in every executing test —
  asserted against the operator's counter *and* independently against the
  transport's own counter.
- Regression **D** drives all three outcomes (clean, fail-before, fail-after) and
  asserts `mutations === 1` in each.

---

## 5. Pre / post proofs the tool produces

- **Inventory** — all nine reset tables, for the target account.
- **STABLE preserved content** — eight readings, each a count *and a content
  digest*: programme revision, exercises and slots, exercise media, input types,
  push subscriptions, global holidays, and `account_settings` columns **other
  than** the one this reset may write. Equal before and after **is** an
  acceptance condition.
- **OPERATIONAL counts** — `notification_deliveries`, `oauth_states`,
  `auth_sessions`. **Diagnostic only, never acceptance.**
- **Isolation** — every other account's rows across all nine tables. Equal before
  and after is the proof that one account's reset cannot reach another's.
- **Orphans, in two parts** — see §5b.
- **Foundation** — read back separately, because it is the one value expected to
  change.

---

## 5b. Stable vs operational, and orphans that are not ours

**Correction B, first half.** The first version required
`notification_deliveries`, `auth_sessions` and `oauth_states` to read identically
before and after. That would have failed a perfectly good reset:

- a cron fires **every minute** and the notification store legitimately inserts
  delivery claims, updates their status and prunes old rows
- `auth_sessions.last_seen_at` moves on any request the user makes, and a
  sign-in during the operator window creates a row
- `oauth_states` rows are created and consumed by any login in flight

None of that is evidence about the reset. Requiring equality there would have
taught the operator to ignore a failing check — worse than not checking.

Those three are now protected **structurally instead**, which is a stronger
guarantee than any before/after comparison because it holds *even while they are
changing*: `round25Transaction` never names them, asserted by test against the
generated SQL. Their counts are still printed, as diagnosis.

**Correction B, second half.** A single global "orphans must be zero" check lets
unrelated state fail this reset. If the database already carried one orphaned row
— from an older bug, or belonging to another account — a correct reset would
report failure *after* the destruction, which is the worst possible moment to
hand somebody a number they cannot act on.

| Proof | Rule |
|---|---|
| **Target orphans** | must be **0**. This is what says *this* reset was clean. |
| **Global orphans** | read before and after; the condition is **no NEW orphan** (`after ≤ before`), not "no orphan". |

A test writes a pre-existing orphan for the *other* account and proves the reset
still passes; another writes one for the target and proves it does not. (Both
fixtures turn foreign-key enforcement off, because `node:sqlite` enforces FKs and
D1 does not guarantee it — which is exactly why orphans can exist in production,
and why this reset deletes children explicitly rather than trusting cascade.)

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

Seven mutations were applied to the shipped source and the suite re-executed. Every
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

Five more, added by this correction:

| Mutation | Result |
|---|---|
| rethrow the transport error instead of reconciling (the reported blocker) | **5 tests fail** |
| retry the destructive command once on error | **5 tests fail** |
| treat a failed reconciliation as committed | **1 test fails** |
| put `notification_deliveries` back into the acceptance fingerprint | **1 test fails** |
| require global orphans to be 0 rather than not increased | **1 test fails** |

And three from the outcome correction:

| Mutation | Result |
|---|---|
| classify `NOT_COMMITTED` from counts after an unacknowledged send | **2 tests fail** |
| let `NOT_COMMITTED` be reachable without an acknowledgement | **2 tests fail** |
| reintroduce wording that presents re-sending as fine, in the operator or the record | **1 test fails** |

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
