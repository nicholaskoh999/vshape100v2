# VShape Admin Lite / System Health v1 — spike record

Isolated preparatory spike. **Not Round 26.** Round 25 is still active, its source is
shipped at `ff6618411ad2855a511cf83c5dff7fba336865be`, and nothing in this branch
touches it.

Branch: `claude/admin-lite-spike`, cut from `main` at `ff66184`.
**Not merged. Not deployed. No production D1 was read or written.**

---

## 1. What this is

One route, `/admin`, for the person who owns this app. Five sections: System,
Account, Activity, Maintenance, Danger zone. One editable value. One refusal.

It is deliberately not a DevOps console. There is no SQL box, no table browser, no
release control, no backup UI, no user management, no RBAC framework and no
analytics. A personal training app does not need Grafana, and building it would
have created a large amount of surface with a very small amount of use.

## 2. The rule the whole page is built on

**Nothing on this page may look more certain than it is.**

That sounds like a slogan; it is actually the design constraint that decided most
of the code. This app is days away from a deliberate, irreversible history reset.
A page that showed a confident `0` for a table it could not read, on the Friday
before that reset, would be believed — and would be the single most expensive lie
this codebase could tell. So:

| Signal | Reads | Because |
|---|---|---|
| a count that could not be read | `Unknown` | `null` is not `0`, and the page never blurs them |
| a health signal with no evidence | `Unknown` | absence of proof is not proof |
| a stored Foundation date that is not a real date | `Unknown` | Round 18 Correction 1's rule, unchanged |
| an API response in an unrecognised shape | the whole page refuses | a shape we cannot read may be an error payload |

`Unknown` is styled as a quiet outline chip, not as an alarm. It is not a failure;
dressing it in red would teach the owner to ignore red.

## 3. Security model

Two gates, both server-side, in this order:

1. **`requireAccount`** — the shared session algorithm every private API in this
   codebase already uses. No cookie, or a dead one, is 401 plus a cleared cookie.
2. **`isAdminAccount`** — an allowlist of `google_sub` values in the Worker
   variable `ADMIN_GOOGLE_SUBS`. Anything not on it is 403.

Properties that are tested rather than asserted:

- **A normal authenticated user is not an admin.** The sign-in allowlist
  (`ALLOWED_GOOGLE_EMAILS`) is deliberately *not* reused — every ordinary user is
  on it, so reusing it would make every user an admin.
- **Keyed on `google_sub`, not email.** An email is a display attribute the
  identity provider can change or reassign; `google_sub` is the stable subject the
  rest of this codebase already keys every account on.
- **Closed by default.** An unset, empty or comma-only allowlist admits *nobody*,
  including the owner. An absent configuration must shut the door, not open it.
- **Nothing is observable.** A non-admin gets `{"error":"forbidden"}` and nothing
  else — no counts, no health, no hint about who is on the list or whether one
  exists. Every `/api/admin/*` path answers a non-admin identically, so the
  surface cannot be mapped by probing.
- **The client holds no admin state.** No localStorage flag, no email comparison,
  no cached boolean. `/admin` renders for any signed-in user; what it renders for
  a non-admin is a refusal, because every fact on it comes from the API.
- **The route's absence from the nav is not the security.** It is only good
  manners: `/admin` is not a destination for the person using the app.
- **No secret reaches the client.** The allowlist name appears only in the Worker
  bundle. The response echoes no `google_sub`, no allowlist, no configuration.

### Configuring it

```
wrangler secret put ADMIN_GOOGLE_SUBS      # or a plain var; it is not a secret
```

The value is the owner's Google subject. It can be read from D1 without any write:

```sql
SELECT DISTINCT google_sub, email FROM auth_sessions;
```

This is the same identifier the Round 25 operator already requires, so it is
almost certainly already to hand.

## 4. What each health signal actually proves

| Card | Healthy when | Never claims |
|---|---|---|
| **App** | the page loaded and is rendering — decided client-side, because the API answering says nothing about static assets | — |
| **API** | this response was served. The response *is* the evidence | anything about D1 or cron |
| **D1** | a trivial `SELECT 1` round-trip succeeded; `Error` when it did not | that any particular table is intact |
| **Cron** | a delivery claim was written in the last 10 minutes | see below |

The scheduler is the interesting one. **This app records no heartbeat.** The
once-a-minute sweep writes to `notification_deliveries` only when a reminder is
genuinely due, so an empty ledger is the normal state of a quiet afternoon and
proves nothing whatever about whether cron is running.

So the classification is:

| Condition | Status | Reason |
|---|---|---|
| VAPID keys absent | **Warning** | `vapid_unconfigured` — provable, and a real fixable fault: the sweep may run perfectly and still deliver nothing |
| a claim in the last 10 min | **Healthy** | `observed_sweep` — the handler cannot have written it without running |
| ledger readable, empty | **Unknown** | `no_observed_sweep` |
| newest claim is older, or dated in the future | **Unknown** | `stale_observation` |
| ledger unreadable | **Unknown** | `unreadable` |

Three of those five are Unknown. That is the honest shape of the answer, and a
green tick in any of them would have been invented.

**Build SHA** is reported only when the deployment supplies `BUILD_SHA`. Nothing
derives it, guesses it, or back-fills it from `package.json` — an Unknown SHA is
more useful than a confident wrong one. It is currently Unknown, because nothing
sets that variable yet; wiring it is a deploy-pipeline change, not a source one.

**D1 migration level** is read from Cloudflare's own `d1_migrations` ledger. That
table is created by the migration tooling, not by this repo's chain, so it is
absent locally and reads Unknown there.

## 5. The one safe control — Foundation Day 1

`PUT /api/admin/foundation-start`. Four things stand between a stray click and a
write:

1. the control is closed by default,
2. the date must be a real Gregorian date — `2026-02-30` is rejected, not rolled
   over into March,
3. an explicit confirmation step names the old value and the new one,
4. the request carries `confirm: true`, and the server refuses without it —
   checked *before* the value, so an unconfirmed request is refused whether or not
   its date was any good.

Plus the same same-origin guard every other state-changing route here applies.

**It writes through the existing account-settings store.** No new SQL was written
for the mutation, so there is exactly one upsert in the codebase that can touch
that row — the one whose `ON CONFLICT DO UPDATE` sets `foundation_start_date` and
`updated_at` and leaves `created_at` alone. A test asserts `created_at` survives
and `updated_at` moves.

**It is not the Fresh Reset, and the page says so on the confirmation.** Changing
Day 1 renumbers Foundation days and milestones and nothing else. A test counts
every activity table for the admin *and a bystander account* before and after the
write and asserts both are unchanged.

Unlike the ordinary settings route, this one does **not** accept `null`. Clearing
the preference is an everyday action that already lives on the Settings screen;
the admin control exists to set an explicit date, so the narrower surface is the
correct one.

## 6. Maintenance mode — investigated, designed, deliberately NOT wired

**The requirement was to investigate first, and not to add a migration.** Here is
what the investigation found.

A maintenance flag has to be *global* (not per account) and *durable* (it has to
survive a Worker restart, and every request is a cold read). This build has four
candidate homes, and none of them works:

| Candidate | Verdict |
|---|---|
| `account_settings` | per-account, and its only writable column is `foundation_start_date` under a `GLOB` constraint. Not a global flag, and abusing it would be worse than not having one |
| a new D1 table | the only clean answer — **and out of scope**: this spike may not add a migration, and the ledger must stay 0001–0015 |
| a Worker KV namespace | new infrastructure, a `wrangler.jsonc` binding, and a deploy. Disproportionate for one boolean in a personal app |
| a Worker environment variable | durable, but only changeable by a deploy or `wrangler secret put`. It could never be a toggle on this page, which is the entire point of the feature |

So no persistent backend control was built, and — importantly — **no env var is
read either.** Reading a `MAINTENANCE_MODE` variable that nothing enforces would
let the page report `ON` while the app behaved completely normally, which is
exactly the class of lie section 2 forbids.

What the API returns instead is the honest shape:

```json
{ "state": "off", "enforced": false, "controllable": false, "reason": "no_persistent_store" }
```

`state: 'off'` is not an assumption. Nothing in this build reads a maintenance
flag and nothing here can write one, so the app is in normal mode *by
construction*. The UI shows the state, a disabled control, and one paragraph
saying why it is disabled.

### The proposal, for whenever it is authorised

A migration `00xx_app_flags.sql` with a single-row global table:

```sql
CREATE TABLE IF NOT EXISTS app_flags (
  key        TEXT PRIMARY KEY,
  value      TEXT NOT NULL,
  updated_at INTEGER NOT NULL
);
```

Then: `GET/PUT /api/admin/maintenance` (admin-gated, confirmed, same-origin
guarded) writes `maintenance=on|off`; the Worker reads it once per request in
`fetch` and, when on, serves a maintenance screen for every non-admin path while
letting `/admin` and `/api/admin/*` through. `enforced` and `controllable` in the
contract above become `true` at that point and the UI needs no restructuring —
the fields already exist for exactly this reason.

That is one migration, one route and about twenty lines in the Worker entry. It
is small; it is just not *this* spike's to add.

## 7. Danger zone — display only

The Fresh Activity Reset is described in one sentence and offered by nothing.

- `available` is a literal `false` in `worker/admin/routes.ts`, inside a module
  scope `as const` — not a flag any request could flip.
- The region carries no `<button>`, no `<a>`, no `<input>` and no `<form>`; a test
  asserts all four counts are zero.
- Eight plausible reset paths × four methods are probed in the test suite; every
  one is refused, and the account's activity counts are identical afterwards.
- The admin source imports neither `shared/round25Reset.ts` nor
  `shared/freshStart.ts`, and contains no `DELETE`, `DROP`, `UPDATE`, `INSERT`,
  `TRUNCATE` or `PRAGMA` anywhere — asserted against the source with comments
  stripped, so a prose mention cannot pass for code.
- The Round 25 reset planner is verifiably absent from the built client bundle.

The reset stays where it was accepted: the standalone Round 25 operator, run from
a machine with credentials, under an explicit go-ahead. Never from a web page.

## 8. What was deliberately not built

- persistent maintenance control (§6)
- any reset, migration, deploy, backup or restore control
- a raw SQL console or table browser
- user management, roles, or a permissions framework
- an analytics or metrics dashboard
- a cron heartbeat. It would make the Cron card provable, but it means a write
  every minute and a table to hold it — a schema change this spike may not make.
  Recorded here as the honest reason that card says Unknown
- `BUILD_SHA` wiring. The source reads it; nothing sets it yet, because setting it
  is a deploy-pipeline change

## 9. Files

| File | |
|---|---|
| `shared/admin.ts` | the wire contract and its fail-closed parsers |
| `worker/admin/access.ts` | the allowlist — the whole authorisation model |
| `worker/admin/health.ts` | health classification, no I/O |
| `worker/admin/d1Store.ts` | read-only reads, each independently fail-closed |
| `worker/admin/routes.ts` | the two endpoints |
| `worker/auth/config.ts` | +`ADMIN_GOOGLE_SUBS`, +`BUILD_SHA` on `Env` |
| `worker/index.ts` | mounts the handler |
| `src/features/admin/AdminPage.tsx` | the page |
| `src/features/admin/AdminStatus.tsx` | status chip, system card, fact row |
| `src/features/admin/adminApi.ts` | the client |
| `src/app/router/router.tsx` | `/admin` |
| `src/test/adminRoutes.test.ts` | 51 tests, real SQLite, real migrations |
| `src/test/adminPage.test.tsx` | 15 tests, the real page |
| `src/test/workerRuntime.d.ts` | local declaration so the route test compiles in the app project |

## 10. Evidence

66 new tests. Every load-bearing claim was mutation-tested — the mutation was
applied, the suite was run, the failure was recorded, and the mutation reverted:

| Mutation | Result |
|---|---|
| remove the admin gate | **6 tests fail** |
| an empty allowlist admits everyone | **2 fail** |
| an unreadable count returns `0` | **1 fail** |
| drop `WHERE google_sub = ?` from the activity count | **2 fail** |
| drop the confirmation requirement | **1 fail** |
| set the danger zone `available: true` | **2 fail** |
| an empty delivery ledger reads healthy | **3 fail** |
| add a button to the danger zone | **1 fail** |

Baseline before and after every mutation: **66 passed**.
