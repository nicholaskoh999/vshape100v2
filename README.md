# VShape100 v2

Today-first personal daily training system. Foundation 100 runs 2026-08-31 → 2026-12-08 and continues after Day 100.

Target domain: `vshape100v2.nkmwei.de`

## Current state — Round 01

Foundation App Shell + Responsive Navigation + Design/Motion Tokens + Brand Icon.

- React 19 + TypeScript + Vite (Rolldown) app shell
- All accepted routes wired with React Router 8; `/` redirects to `/today`
- Responsive navigation:
  - **Mobile** (< 768px): 5-item bottom nav — Today / Training / Progress / Calendar / More; More opens a sheet with Achievements + Settings
  - **Tablet** (768–1279px): compact icon rail
  - **Desktop** (≥ 1280px): full sidebar with all six entries and the brand mark
- Brand palette + semantic tokens (`src/design/tokens.css`), centralized motion tokens (`src/design/motion.ts`), reduced-motion respected end to end
- Accepted Mon–Fri training skeleton rendered as static shell content so nested routes (`/training/:session`, `/exercises/:id`) are navigable
- Brand V icon shipped in `public/` (SVG canonical, PNG/ICO provided)

No backend, no persistence, no D1 schema yet — deliberate Round 01 scope.

## Local setup

```sh
npm install
npm run dev        # Vite dev server (Cloudflare plugin runs assets locally via miniflare)
```

## Quality checks

```sh
npm run typecheck  # tsc project references
npm run lint       # eslint
npm run test       # vitest (routing + navigation shell tests)
npm run build      # tsc -b && vite build → dist/
npm run check      # all of the above in sequence
npm run preview    # serve the production build locally
```

## Cloudflare workflow

The app targets **Cloudflare Workers Static Assets** via the Cloudflare Vite
plugin. `wrangler.jsonc` is assets-only for Round 01: no Worker script, no D1,
no cron, no push. `not_found_handling: single-page-application` routes all app
URLs to `index.html` for React Router.

- `npm run build` produces `dist/` including a generated deploy config
  (`dist/wrangler.json`).
- **Deployment is manual and local only**: `npx wrangler deploy` from a
  machine authenticated against the real Cloudflare account. The build
  environment never deploys, never touches production D1, and never changes
  secrets.
- Cloudflare Access protects the deployed app for personal use (configured in
  the Cloudflare dashboard, not in this repo).

## Structure

```text
src/
  app/
    router/       # route table (accepted screen map)
    shell/        # responsive AppShell
  components/
    navigation/   # BottomNav, MoreSheet, SideNav (rail/full), BrandMark
    ui/           # Card, PageHeader, EmptyShell, IntensityBadge
  design/
    tokens.css    # brand palette, semantic + motion tokens, base styles
    motion.ts     # centralized Motion-for-React tokens
  features/
    today/ training/ progress/ calendar/ achievements/ settings/
  pages/          # NotFound
  test/           # vitest setup + shell tests
public/           # favicon.svg, app-icon.svg, PNG/ICO icon set
```

## Later rounds (not in this repo yet)

Daily routine engine (NOW/NEXT/LATER), D1 persistence, set-by-set logging with
Double Progression, Holiday Mode data flow, weight logging, achievements
engine, PWA/Web Push, exercise media (external URL first, R2 optional).
