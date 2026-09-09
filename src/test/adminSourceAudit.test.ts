/*
 * ROUND 26 — the source audit behind the Admin Lite polish.
 *
 * Round 26 changed copy and nothing else, and copy is exactly the kind of
 * change that quietly grows a feature: a sentence saying "not available here"
 * is one careless edit away from a button that makes it available. These tests
 * read the shipped source and assert the absences that make the polish safe.
 *
 * They are deliberately source-level, not behaviour-level. The behavioural
 * proofs — a non-admin refused, an empty allowlist failing closed, an
 * unreadable count staying Unknown, no route reaching a delete — live in
 * adminRoutes.test.ts and adminPage.test.tsx and are not restated here. What
 * these add is the claim those cannot make: that nothing in the ADMIN CLIENT
 * knows a reset path, and that the migration chain did not grow.
 *
 * `import.meta.glob` needs Vite's transform, and nothing here needs a DOM.
 *
 * @vitest-environment node
 */
import { describe, expect, it } from 'vitest'

import adminApiSource from '../features/admin/adminApi.ts?raw'
import adminPageSource from '../features/admin/AdminPage.tsx?raw'
import adminStatusSource from '../features/admin/AdminStatus.tsx?raw'
import adminContractSource from '../../shared/admin.ts?raw'
import routesSource from '../../worker/admin/routes.ts?raw'

/** The admin feature as the browser gets it. */
const CLIENT = [adminApiSource, adminPageSource, adminStatusSource]

/** Everything Round 26 was allowed to touch. */
const ADMIN_SOURCES = [...CLIENT, adminContractSource, routesSource]

function stripComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '')
}

/**
 * The migration chain, counted from disk rather than from a list a test could
 * be edited to agree with.
 */
const MIGRATIONS = import.meta.glob('../../migrations/*.sql', { query: '?raw' })

/* ================================================================== */
/* 1. The client knows no way to run anything destructive             */
/* ================================================================== */

describe('1. the admin client cannot reach a reset', () => {
  it('A. names exactly two admin endpoints, and neither is destructive', () => {
    const paths = new Set<string>()
    for (const source of CLIENT) {
      for (const match of stripComments(source).matchAll(/['"`](\/api\/[^'"`]*)['"`]/g)) {
        paths.add(match[1])
      }
    }
    expect([...paths].sort()).toEqual(['/api/admin/foundation-start', '/api/admin/overview'])
  })

  it('B. contains no reset, delete or SQL vocabulary in any request it makes', () => {
    for (const source of CLIENT) {
      const code = stripComments(source)
      expect(code).not.toMatch(/method:\s*['"]DELETE['"]/i)
      expect(code).not.toMatch(/round25Reset|freshStart|round25Transaction/)
      // `TRUNCATE` alone is not tested here: `truncate` is a Tailwind class
      // this page legitimately uses, and a rule that cannot tell a CSS utility
      // from SQL is a rule nobody will keep.
      expect(code).not.toMatch(/\bDELETE\s+FROM\b|\bDROP\s+TABLE\b|\bTRUNCATE\s+TABLE\b/i)
    }
  })

  it('C. imports nothing from the Round 25 reset planner or the Round 18 tool', () => {
    for (const source of ADMIN_SOURCES) {
      expect(source).not.toMatch(/from '[^']*round25Reset'/)
      expect(source).not.toMatch(/from '[^']*freshStart'/)
    }
  })

  it('D. the only state-changing verb the client uses is the Day 1 PUT', () => {
    const verbs = [...stripComments(adminApiSource).matchAll(/method:\s*'([A-Z]+)'/g)].map(
      (match) => match[1],
    )
    expect(verbs).toEqual(['PUT'])
  })
})

/* ================================================================== */
/* 2. Maintenance stayed a word                                        */
/* ================================================================== */

describe('2. maintenance is not wired by the polish', () => {
  it('A. no maintenance write exists on either side', () => {
    for (const source of ADMIN_SOURCES) {
      const code = stripComments(source)
      expect(code).not.toMatch(/maintenance[-/]?(mode)?['"]?\s*[,)]?\s*(?:PUT|POST)/i)
      expect(code).not.toMatch(/setMaintenance|enableMaintenance|toggleMaintenance/i)
    }
  })

  it('B. the server still reports it uncontrollable, as a module constant', () => {
    const code = stripComments(routesSource)
    expect(code).toMatch(/const MAINTENANCE = \{[\s\S]*?\} as const/)
    expect(code).toMatch(/controllable: false/)
    expect(code).not.toMatch(/controllable: true/)
    expect(code).not.toMatch(/enforced: true/)
  })
})

/* ================================================================== */
/* 3. The polish added no schema                                       */
/* ================================================================== */

describe('3. no migration was added', () => {
  it('A. the chain is still the fifteen accepted migrations', () => {
    const names = Object.keys(MIGRATIONS)
      .map((path) => path.split('/').pop() as string)
      .sort()
    expect(names).toHaveLength(15)
    expect(names[0]).toBe('0001_auth.sql')
    expect(names[14]).toBe('0015_programme_builder.sql')
    // Nothing shaped like a flags table, which is the one schema a wired
    // maintenance mode would have needed.
    expect(names.join(' ')).not.toMatch(/flag|maintenance|admin/i)
  })
})

/* ================================================================== */
/* 4. The product copy is product copy                                 */
/* ================================================================== */

describe('4. the rendered copy carries no build-process jargon', () => {
  /**
   * Only string and JSX text is read. Comments are stripped first on purpose:
   * the source comments explaining WHY maintenance is deferred are worth
   * keeping, and they are not shown to anyone signed in.
   */
  it('A. AdminPage renders no round, operator or spike vocabulary', () => {
    const code = stripComments(adminPageSource)
    expect(code).not.toMatch(/Round\s*2[0-9]/i)
    expect(code).not.toMatch(/round25-operator|operator tool/i)
    expect(code).not.toMatch(/\bspike\b/i)
  })

  it('B. the two unavailable features say so in one plain sentence each', () => {
    expect(adminPageSource).toContain('Maintenance mode isn’t available yet.')
    expect(adminPageSource).toContain('Activity reset isn’t available from Admin Lite.')
  })

  it('C. `managedBy` is parsed but never rendered', () => {
    // It exists on the wire, so the contract keeps parsing it...
    expect(adminContractSource).toMatch(/managedBy/)
    // ...and the page never puts it on screen.
    expect(adminPageSource).not.toMatch(/managedBy/)
  })
})
