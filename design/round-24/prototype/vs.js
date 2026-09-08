/* =====================================================================
   VSHAPE100 v2 — Round 24 prototype runtime
   ---------------------------------------------------------------------
   DESIGN EVIDENCE ONLY. Not part of the app.

   Three jobs:
     1. one icon set, so every screen draws the same glyphs
     2. one navigation shell, so every screen proves the same IA
     3. the minimum interactivity a static mockup needs to be judged
        (pill tabs, week strip, accordion, sheet) — nothing here writes,
        fetches or pretends to hold product truth.
   ===================================================================== */

/* ---------------------------------------------------------------- */
/* 1. Icons — one 24x24 stroke system, no external dependency        */
/* ---------------------------------------------------------------- */

const ICONS = {
  today:
    '<circle cx="12" cy="12" r="4"/><path d="M12 2v2.2M12 19.8V22M4.6 4.6l1.6 1.6M17.8 17.8l1.6 1.6M2 12h2.2M19.8 12H22M6.2 17.8l-1.6 1.6M19.4 4.6l-1.6 1.6"/>',
  training: '<path d="M4 9v6M7.5 6.5v11M16.5 6.5v11M20 9v6M7.5 12h9"/>',
  progress: '<path d="M3 17.5l6-6 4 4 7.5-7.5"/><path d="M14 8h6.5v6.5"/>',
  calendar:
    '<rect x="3" y="5" width="18" height="16" rx="3.5"/><path d="M8 2.5v4.5M16 2.5v4.5M3 10.5h18"/>',
  more: '<circle cx="5" cy="12" r="1.7" fill="currentColor" stroke="none"/><circle cx="12" cy="12" r="1.7" fill="currentColor" stroke="none"/><circle cx="19" cy="12" r="1.7" fill="currentColor" stroke="none"/>',
  trophy:
    '<path d="M7 3.5h10V9a5 5 0 0 1-10 0z"/><path d="M7 5H4v1.2a4 4 0 0 0 3 3.85M17 5h3v1.2a4 4 0 0 1-3 3.85"/><path d="M12 14v3M8.4 20.5h7.2l-.75-3.5h-5.7z"/>',
  settings:
    '<path d="M3 6h9M17.5 6H21M3 12h4.5M12.5 12H21M3 18h10.5M19 18h2"/><circle cx="14.5" cy="6" r="2.2"/><circle cx="10" cy="12" r="2.2"/><circle cx="16.5" cy="18" r="2.2"/>',
  play: '<path d="M7.5 4.8v14.4L19.5 12z" fill="currentColor" stroke="none"/>',
  check: '<path d="M4.5 12.6l5.2 5.2L19.8 7"/>',
  skip: '<path d="M5.5 5.2 14 12l-8.5 6.8z"/><path d="M18.5 5v14"/>',
  undo: '<path d="M3.5 5.5v5.5h5.5"/><path d="M4 11a8.5 8.5 0 1 1 2.4 6.8"/>',
  right: '<path d="M9 5l7 7-7 7"/>',
  left: '<path d="M15 5l-7 7 7 7"/>',
  back: '<path d="M20 12H4.2M10 5.5 3.7 12l6.3 6.5"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  minus: '<path d="M5 12h14"/>',
  flame:
    '<path d="M12 2.8s5.4 4.2 5.4 9.4a5.4 5.4 0 0 1-10.8 0c0-2.1 1.1-3.3 1.1-3.3s.6 2.1 2.2 2.1c0-4.3 2.1-8.2 2.1-8.2z"/>',
  scale:
    '<rect x="3" y="4" width="18" height="17" rx="4.5"/><path d="M12 8v3.2"/><circle cx="12" cy="13.4" r="1.2"/>',
  holiday:
    '<path d="M12 21.5V10.5"/><path d="M12 10.5c-.3-3-3.4-4.8-6.4-3.6 1.2-3 5.3-3.9 7.3-1.7 2.1-2.1 6.2-1.1 7.3 1.8-3-1.2-6 .6-6.3 3.5"/><path d="M8 21.5h8"/>',
  alert: '<path d="M12 3.2 21.4 20H2.6z"/><path d="M12 9.5v4.8M12 17.4v.4"/>',
  info: '<circle cx="12" cy="12" r="9"/><path d="M12 11.2v5M12 7.9v.4"/>',
  refresh: '<path d="M20.2 11.4A8.4 8.4 0 1 0 18 17.6"/><path d="M20.5 5v6h-6"/>',
  close: '<path d="M6 6l12 12M18 6 6 18"/>',
  pencil: '<path d="M4 20h4.2L19 9.2 14.8 5 4 15.8z"/><path d="M13.6 6.2 17.8 10.4"/>',
  library:
    '<path d="M4 5.5A2.5 2.5 0 0 1 6.5 3H20v18H6.5A2.5 2.5 0 0 1 4 18.5z"/><path d="M4 17.2h16"/>',
  list: '<path d="M8.5 6H21M8.5 12H21M8.5 18H21"/><path d="M3.6 6h.02M3.6 12h.02M3.6 18h.02" stroke-width="2.6"/>',
  timer: '<circle cx="12" cy="13.4" r="8"/><path d="M12 9.4v4.2l2.6 1.9M9.2 2.5h5.6"/>',
  moon: '<path d="M20.4 14.2A8.6 8.6 0 0 1 9.8 3.6 8.6 8.6 0 1 0 20.4 14.2z"/>',
  recovery: '<path d="M3 8h10.5a3 3 0 1 0-3-3M3 12h13.5a3 3 0 1 1-3 3M3 16h9"/>',
  lock: '<rect x="4" y="10.2" width="16" height="10.8" rx="3.2"/><path d="M8 10.2V7.4a4 4 0 0 1 8 0v2.8"/>',
  search: '<circle cx="11" cy="11" r="7"/><path d="M20 20l-3.9-3.9"/>',
  image:
    '<rect x="3" y="4" width="18" height="16" rx="3.5"/><circle cx="8.8" cy="9.8" r="1.8"/><path d="M4 18.6l5-5 3.6 3.6 3-3L20 18"/>',
  spark:
    '<path d="M12 3.2 13.9 8.1 18.8 10 13.9 11.9 12 16.8 10.1 11.9 5.2 10 10.1 8.1z"/><path d="M18 15.4l.8 2 2 .8-2 .8-.8 2-.8-2-2-.8 2-.8z"/>',
  band: '<ellipse cx="12" cy="12" rx="8.2" ry="5.2"/><ellipse cx="12" cy="12" rx="3.8" ry="2"/>',
  user: '<circle cx="12" cy="8" r="4"/><path d="M4.5 20a7.5 7.5 0 0 1 15 0"/>',
  bell: '<path d="M6.2 10.4a5.8 5.8 0 0 1 11.6 0c0 3.9 1.4 4.9 1.4 4.9H4.8s1.4-1 1.4-4.9z"/><path d="M10 18.6a2 2 0 0 0 4 0"/>',
  logout:
    '<path d="M14.5 4H18a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2h-3.5"/><path d="M9.8 16 5.8 12l4-4M6 12h9"/>',
  clock: '<circle cx="12" cy="12" r="9"/><path d="M12 6.8V12l3.6 2.2"/>',
  up: '<path d="M12 19V5M6 11l6-6 6 6"/>',
  down: '<path d="M12 5v14M6 13l6 6 6-6"/>',
  home: '<path d="M4 10.5 12 4l8 6.5V20a1 1 0 0 1-1 1h-4v-6H9v6H5a1 1 0 0 1-1-1z"/>',
  target:
    '<circle cx="12" cy="12" r="8.5"/><circle cx="12" cy="12" r="4.5"/><circle cx="12" cy="12" r="1" fill="currentColor" stroke="none"/>',
  trash: '<path d="M4.5 6.5h15M9.5 6.5V4.2h5v2.3M6.5 6.5 7.4 20h9.2l.9-13.5"/>',
  wand: '<path d="M4 20 15 9M17.5 6.5 20 4M14.2 4.4l.8 2.2 2.2.8-2.2.8-.8 2.2-.8-2.2-2.2-.8 2.2-.8z"/>',
}

function svg(name, cls) {
  const d = ICONS[name] || ''
  return (
    `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" ` +
    `stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"` +
    (cls ? ` class="${cls}"` : '') +
    `>${d}</svg>`
  )
}

/* ---------------------------------------------------------------- */
/* 2. Navigation shell — the Round 24 IA decision, rendered           */
/* ---------------------------------------------------------------- */

/* Bottom nav: four destinations + More. NO centre action — see
   ../03_NAVIGATION_IA.md for why the centre-action model was rejected. */
const TABS = [
  { id: 'today', href: 'today.html', label: 'Today', icon: 'today' },
  { id: 'training', href: 'training.html', label: 'Training', icon: 'training' },
  { id: 'progress', href: 'progress.html', label: 'Progress', icon: 'progress' },
  { id: 'calendar', href: 'calendar.html', label: 'Calendar', icon: 'calendar' },
]

const MORE = [
  { id: 'achievements', href: 'achievements.html', label: 'Achievements', icon: 'trophy' },
  { id: 'settings', href: 'settings.html', label: 'Settings', icon: 'settings' },
]

function mountShell() {
  const active = document.body.dataset.nav || ''
  const inMore = MORE.some((m) => m.id === active)

  const side = document.createElement('nav')
  side.className = 'sidenav'
  side.setAttribute('aria-label', 'Primary')
  side.innerHTML =
    `<div class="brand">
       <span class="brandmark" aria-hidden="true">V</span>
       <span class="brandtext">
         <span class="brandname">VShape<span>100</span></span>
         <span class="brandsub">Foundation</span>
       </span>
     </div>
     <ul>` +
    [...TABS, ...MORE]
      .map(
        (t) =>
          `<li><a href="${t.href}"${t.id === active ? ' aria-current="page"' : ''}>` +
          `${svg(t.icon)}<span>${t.label}</span></a></li>`,
      )
      .join('') +
    `</ul>
     <p class="foot">Foundation · v2</p>`

  const bottom = document.createElement('nav')
  bottom.className = 'bottomnav'
  bottom.setAttribute('aria-label', 'Primary')
  bottom.innerHTML =
    '<ul>' +
    TABS.map(
      (t) =>
        `<li><a href="${t.href}"${t.id === active ? ' aria-current="page"' : ''}>` +
        `${t.id === active ? '<span class="navdot" aria-hidden="true"></span>' : ''}` +
        `${svg(t.icon)}<span>${t.label}</span></a></li>`,
    ).join('') +
    `<li><a href="more.html"${inMore ? ' aria-current="page"' : ''}>` +
    `${inMore ? '<span class="navdot" aria-hidden="true"></span>' : ''}` +
    `${svg('more')}<span>More</span></a></li>` +
    '</ul>'

  document.body.prepend(side)
  document.body.appendChild(bottom)
}

/* ---------------------------------------------------------------- */
/* 3. Minimum interactivity                                          */
/* ---------------------------------------------------------------- */

function hydrateIcons() {
  document.querySelectorAll('[data-icon]').forEach((el) => {
    el.innerHTML = svg(el.dataset.icon)
  })
}

/* Single-select groups: pill tabs, week strip, calendar cells. */
function hydrateSelects() {
  document.querySelectorAll('[role="tablist"]').forEach((group) => {
    group.addEventListener('click', (e) => {
      const btn = e.target.closest('[role="tab"]')
      if (!btn || !group.contains(btn)) return
      group
        .querySelectorAll('[role="tab"]')
        .forEach((b) => b.setAttribute('aria-selected', String(b === btn)))
    })
  })

  document.querySelectorAll('[data-single]').forEach((group) => {
    const attr = group.dataset.single
    group.addEventListener('click', (e) => {
      const btn = e.target.closest('button')
      if (!btn || !group.contains(btn)) return
      group.querySelectorAll('button').forEach((b) => {
        if (b === btn) b.setAttribute(attr, attr === 'aria-current' ? 'date' : 'true')
        else b.removeAttribute(attr)
      })
    })
  })
}

/* Disclosure: a summary row that expands its panel. */
function hydrateDisclosures() {
  document.querySelectorAll('[data-disclosure]').forEach((btn) => {
    const panel = document.getElementById(btn.getAttribute('aria-controls'))
    if (!panel) return
    btn.addEventListener('click', () => {
      const open = btn.getAttribute('aria-expanded') === 'true'
      btn.setAttribute('aria-expanded', String(!open))
      panel.hidden = open
    })
  })
}

document.addEventListener('DOMContentLoaded', () => {
  mountShell()
  hydrateIcons()
  hydrateSelects()
  hydrateDisclosures()
})

window.VS = { svg, ICONS }
