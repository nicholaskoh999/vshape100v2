# VShape100 v2

Today-first personal daily training system. Foundation 100 runs 2026-08-31 → 2026-12-08 and continues after Day 100.

Target domain: `vshapev2.nkmwei.de`

## Current state — Round 03

**Today Daily Engine (client-side)**, on top of the Round 01 shell and Round 02 auth.

### Round 01 (accepted)
- React 19 + TypeScript + Vite app shell, Tailwind CSS v4
- All accepted routes via React Router 8; `/` redirects to `/today`
- Mobile 5-item bottom nav (More sheet), tablet rail, desktop sidebar
- Brand palette + semantic tokens, centralized motion tokens, reduced motion respected
- Brand V icon in `public/`

### Round 02 (accepted)
- Branded `/login` screen — VShape100 first, never a generic auth page. No app navigation around it.
- Google OIDC **authorization-code flow with PKCE (S256)**, unpredictable `state` and `nonce`
- ID token verified against Google's JWKS: signature, issuer, audience, expiry, nonce, `sub`, email presence and `email_verified`
- Google account **allowlist enforced server-side** from environment configuration
- **App-owned opaque session** in an `HttpOnly` cookie; D1 stores only the SHA-256 hash
- **Trust this device** → 30-day session with rolling refresh; otherwise 24 hours, fixed
- Auth guard on every app route, with the intended destination preserved safely
- Logout for the current device
- Minimal D1 auth schema and migration

### Round 03 (this round)
- `/today` is a working daily engine: the accepted Home Mode / Saturday / Sunday
  routes resolved against the local clock
- Five states — **NOW / NEXT / LATER / LATE / DONE EARLIER**
- **Time never completes a task.** The clock only changes how an item looks and
  where it sits; only an explicit tap can finish one
- Cross-midnight intervals (`23:30–00:30`) and previous-day spillover
  (Saturday's `01:00–03:00` block seen from Sunday) are modelled, not truncated.
  A spillover occurrence stays in Today only while it is still running — once
  it ends it leaves the agenda, because Today is today's actionable list
- Flexible parts of the weekend are semantic **window** items — the engine never
  invents a clock time that was not accepted
- Manual complete + undo, **in client memory only** (a refresh clears it — the
  accepted limitation for this round)
- Live recomputation on every minute boundary, no refresh needed
- Responsive Today layout: one column on mobile, wider rows and a two-up
  "Later today" grid on tablet, schedule + attention rail on desktop

No workout persistence, no Today persistence, no push, no production deploy —
those remain later rounds.

## Local setup

```sh
npm install
cp .dev.vars.example .dev.vars   # then fill in real values
npm run dev
```

`.dev.vars` is git-ignored. Never commit real credentials.

### Google OAuth client (required for real sign-in)

Sign-in needs a Google OAuth 2.0 **Web application** client. It is created and
configured locally — this repository does not ship one and the build
environment never had credentials.

Authorized redirect URIs:

| Environment | Redirect URI |
| --- | --- |
| Local dev | `http://localhost:5173/api/auth/google/callback` |
| Production | `https://vshapev2.nkmwei.de/api/auth/google/callback` |

The callback URI is derived from `APP_ORIGIN`, so it must match exactly.

### Local D1

```sh
npx wrangler d1 create vshape100v2-auth        # once; paste database_id into wrangler.jsonc
npx wrangler d1 migrations apply vshape100v2-auth --local
```

`wrangler.jsonc` currently carries a placeholder `database_id`; no real
database has been created.

## Quality checks

```sh
npm run typecheck  # tsc project references (app + worker + node)
npm run lint       # eslint
npm run test       # vitest — shell, auth logic and session behaviour
npm run build      # tsc -b && vite build → dist/
npm run check      # all of the above in sequence
npm run preview    # serve the production build locally
```

## Auth design

### Endpoints

| Method | Path | Purpose |
| --- | --- | --- |
| GET | `/api/auth/google/start` | Create the OIDC transaction, redirect to Google |
| GET | `/api/auth/google/callback` | Verify identity, mint the app session |
| GET | `/api/auth/session` | Authoritative "am I signed in?" |
| POST | `/api/auth/logout` | Revoke this device's session |

`/api/auth/session` returns only `{ authenticated, user: { email, name, picture } }`.
No Google tokens, no raw session token, no secrets are ever returned.

### Session rules

- Opaque random token (32 bytes) in a `vshape_session` cookie:
  `HttpOnly`, `SameSite=Lax`, `Path=/`, `Secure` whenever `APP_ORIGIN` is https.
- D1 stores `sha256(token)` — a database read cannot be replayed as a login.
- Trusted: 30 days, rolled forward only within 7 days of expiry, so a normal
  request does not write to D1. When it does roll forward, `/api/auth/session`
  re-issues the same token with a fresh 30-day `Max-Age`, so the cookie never
  expires before the D1 row it points at.
- Non-trusted: 24 hours, fixed — never rolled, never re-issued.
- Logout revokes the row and clears the cookie; it is POST-only and rejects a
  cross-origin `Origin`.

### Google tokens

The access token is discarded and no refresh token is requested
(`access_type=online`). Only the ID token is used, and only to establish
identity. Nothing Google-issued is persisted or exposed to the browser.

### OAuth transient state

`state`, `nonce` and the PKCE verifier live in a short-lived `oauth_states`
row (10 minutes, single-use, consumed atomically via `DELETE ... RETURNING`).
Only the hash of `state` is stored. Nothing sensitive goes in `localStorage`
or `sessionStorage`.

### Redirect safety

`?next=` accepts only same-app absolute paths. Absolute URLs,
protocol-relative values, backslash tricks, control characters and `/login`
itself are rejected and fall back to `/today`.

## Cloudflare workflow

A Worker (`worker/index.ts`) owns `/api/auth/*` and hands everything else to
Static Assets, which serves the built React app with SPA fallback.

- `npm run build` produces `dist/`.
- **Deployment is manual and local only**: `npx wrangler deploy` from a machine
  authenticated against the real Cloudflare account. The build environment
  never deploys, never creates or migrates production D1, and never sets
  production secrets.
- Production secrets are set with `wrangler secret put GOOGLE_CLIENT_ID`
  (and `GOOGLE_CLIENT_SECRET`, `ALLOWED_GOOGLE_EMAILS`, `APP_ORIGIN`).

### Cloudflare Access

App-native Google OIDC is now the primary end-user login. Cloudflare Access is
**not** the login UX and is not configured in this repository. It remains
optional later for perimeter or admin protection only.

## Structure

```text
worker/
  index.ts          # Worker entry: auth API, else static assets
  auth/
    config.ts       # env parsing, allowlist, redirect URI
    crypto.ts       # random tokens, SHA-256, PKCE challenge
    google.ts       # OIDC discovery, code exchange, ID token verification
    oauthState.ts   # short-lived state/nonce/PKCE records
    session.ts      # session model, durations, cookie rules
    d1Stores.ts     # thin D1 implementations of the store interfaces
    routes.ts       # HTTP handlers
  test/             # auth + session unit tests (mocked Google/JWKS)
shared/
  redirect.ts       # safe `next` handling, used by app and worker
migrations/
  0001_auth.sql     # oauth_states + auth_sessions
src/
  app/router/       # route table incl. /login and the guard
  app/shell/        # responsive AppShell
  components/       # navigation + ui primitives
  design/           # tokens.css, motion.ts
  features/
    auth/           # provider, guard, login screen, client
    today/
      model/        # types, accepted routes, pure engine, ordering, formatting
      components/   # hero, item row, section, completion controls
      useTodayClock.ts  # the one place the app reads the wall clock
      useToday.ts       # clock + in-memory completion + engine
      TodayPage.tsx
    training/ progress/ calendar/ achievements/ settings/
  test/             # shell, auth and Today tests
public/             # favicon.svg, app-icon.svg, PNG/ICO icon set
```

## Later rounds (not in this repo yet)

Today persistence (routine schema + completion history), workout persistence
with set-by-set logging and Double Progression, Holiday Mode data flow, weight logging,
achievements engine, PWA/Web Push, exercise media (external URL first, R2
optional), trusted-device management and sign-out-everywhere.
