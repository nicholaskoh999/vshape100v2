# Round 24 — final ship record

**V SHIP.** The login/icon polish and its correction, accepted after independent review.

| | |
|---|---|
| Pre-ship `main` | `66c783f0f106078f973ea0f412192616eab0316d` |
| Accepted candidate | `01f06da8abf47cfde4c5c18b1da2dbbd00a6f317` |
| **Resulting `main`** | `01f06da8abf47cfde4c5c18b1da2dbbd00a6f317` |
| Source checkpoint | `checkpoint/pre-round24-redesign` → `7213f3b15fc0af6597e0ee236802357e16985084` (**unmoved**) |

Deploy status: **PENDING.** See §3.

---

## 1. Promotion

The candidate has exactly one parent and `main` was already an ancestor, so the
promotion is a fast-forward. Pushed **without `--force`**, so it cannot rewrite
`main`; nothing was squashed and every accepted commit is still its own.

```
git push origin 01f06da8abf47cfde4c5c18b1da2dbbd00a6f317:refs/heads/main
66c783f..01f06da  -> main
```

Shipped tree byte-identical to the reviewed one: `16f000557d28de452aebab5dc6364f55491448cf`.

Round 24 on `main`, in order:

```
01f06da  Correction — the shield replaces the letter tile, and the login width drops its calc
6df3715  Login polish and the production icon set
66c783f  Today must describe the workout it started, not the programme it has now
19d10e0  Round 24 correction — a real Add exercise, a pinned draft, a focused workout
c0d6e7a  Round 24 — the light redesign, implemented across the app
1753862  Round 24 — UI/UX redesign blueprint, prototype and Fresh Reset contract
7213f3b  ← the checkpoint
```

---

## 2. Release gates, from the resulting `main`

| | |
|---|---|
| `npm run typecheck` | pass |
| `npm run lint` | pass |
| Targeted — auth, shell, manifest | **93 passed / 3 files** |
| `npm run build` | pass |

Clean build output, and the exact set of files a deploy would upload:

```
dist/client/assets/index-DHAn6OD6.js    806.36 kB
dist/client/assets/index-DMPa4tEc.css    56.05 kB
dist/vshape100v2/index.js               356.73 kB   (Worker)
dist/ tree digest 39b3b8efc385a0b563505a47a8a9656f0ef3efec43629996739829620af388f4
```

Checks on that artifact:

- manifest: `any` = `/icon-192.png` + `/icon-512.png`; `maskable` = the
  **dedicated** `/icon-maskable-512.png`; both colours `#F5F6F2`
- `index.html`: `.ico` at 16/32/48, SVG favicon, apple-touch 180, manifest
- CSS carries `#f5f6f2` / `#171a15` / `#cdf564`; **zero** occurrences of the
  superseded `#0B1220` / `#2F6BFF`
- **zero** goal-weight strings anywhere in the bundle

**THE WHOLE OF ROUND 24 TOUCHES NO BACKEND.**
`git diff 7213f3b1..01f06da -- migrations/ worker/ wrangler.jsonc` is **empty**.
Across every commit above, not one file under `migrations/`, `worker/` or
`wrangler.jsonc` changed. The D1 ledger is 0001–0015, identical to the
checkpoint, and there is nothing in this release that could alter a stored row.

---

## 3. Deployment — NOT performed, and not faked

Re-checked at ship time, three independent ways:

1. **No credentials.** `CLOUDFLARE_API_TOKEN`, `CLOUDFLARE_ACCOUNT_ID`,
   `CF_API_TOKEN`, `CF_ACCOUNT_ID`, `CLOUDFLARE_API_KEY`, `CLOUDFLARE_EMAIL`
   and `WRANGLER_API_KEY` all unset; no `~/.wrangler` config; no OAuth token
   file anywhere on disk.
2. **Wrangler says so itself.** `CI=1 npx wrangler whoami` →
   *"You are not authenticated. Please run `wrangler login`."*
3. **No network path.** The session's egress policy answers `403` to CONNECT
   for `api.cloudflare.com`, `dash.cloudflare.com`, `sparrow.cloudflare.com`
   and `vshapev2.nkmwei.de`. `wrangler login` needs the dashboard, which is
   also blocked.

Wrangler offers `deploy --temporary`, which publishes to a **temporary preview
account** — a different account from the one that owns `vshape100v2` and
`vshapev2.nkmwei.de`. That is not this deploy and was not run.

So there is **no deployment ID, no version ID, no `deployments list` output and
no remote D1 migrations-list result** to report. Those exist only once the
operator deploys. Production is still serving the pre-Round-24 build.

### Exact commands for the machine holding the credentials

```bash
git fetch origin main
git checkout main && git reset --hard origin/main
git rev-parse HEAD          # must print 01f06da8abf47cfde4c5c18b1da2dbbd00a6f317

npm ci
npm run typecheck && npm run lint && npm run build

# Deploys the V2 app only: Worker `vshape100v2`, route vshapev2.nkmwei.de.
# Publishing assets + Worker. It applies NO migrations.
npx wrangler deploy

# Read-only confirmations
npx wrangler deployments list
npx wrangler d1 migrations list vshape100v2-auth --remote   # expect: no pending migrations
```

**Do not run `wrangler d1 migrations apply`.** Nothing in Round 24 needs it and
the ledger must stay at 0015.

---

## 4. Explicitly NOT done

- **No D1 migration applied.** No migration exists to apply.
- **No D1 reset, no Fresh Database Reset.** Not executed, prepared or scheduled.
- **No database mutation of any kind.** No row read, written, deleted or
  corrected; no historical or activity data touched. The session cannot reach
  the account at all.
- **No V1** repository, site or source accessed, searched or referenced.
- **No unrelated repo or project** touched.
- **The checkpoint was not moved or deleted.**
- **No squash and no history rewrite.** Every accepted commit stands on `main`
  as its own commit.

---

## 5. Development Directions still open

Carried from `14_SNAPSHOT_TRUTH_SHIP.md`, neither started:

| | Direction |
|---|---|
| **D10** | Extra Workout — reuse the focused workout workspace while preserving Extra provenance and no-progression semantics. |
| **D11** | Shared `HeroCard` / `Card` — forward native section attributes (`aria-labelledby`, `data-*`) instead of silently dropping them. Today's training hero still renders with no accessible name. |

Earlier ship records: `13_SHIP_RECORD.md` (on `claude/new-session-jwc2pe`) and
`14_SNAPSHOT_TRUTH_SHIP.md` (on `claude/round24-today-snapshot-truth`). None of
the three is on `main`, deliberately: `main` is kept at exactly the reviewed and
accepted candidate SHA each time, so a documentation commit is never what
production is built from.
