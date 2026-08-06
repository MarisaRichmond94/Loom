import path from 'node:path'
import { assertNotProductionDb, isProductionDbPath, resolveDbPath } from '@/lib/dbSafety'

/**
 * Runs before every test file, in both Jest projects (LOOM-125).
 *
 * `dev.db` IS production — the only copy of the prose. Two separate ways a test
 * run could reach it, so this closes both:
 *
 * 1. DATABASE_URL explicitly points at it. Fail loudly, immediately.
 *
 * 2. DATABASE_URL is UNSET — the quieter and more likely of the two. Jest does
 *    not load `.env`, so `process.env.DATABASE_URL` is normally undefined here,
 *    and `src/lib/prisma.ts` falls back to `'file:./dev.db'`. Today nothing is
 *    harmed: the only test that imports the client mocks it
 *    (tests/unit/reachabilityRoute.test.ts:28). But that safety is one
 *    forgotten `jest.mock` away from evaporating, and the failure would be
 *    silent — a test writing to the manuscript and passing.
 *
 *    So rather than trusting the fallback never to engage, point it somewhere
 *    harmless. A test that forgets to mock now hits the fixture.
 *
 * NOTE this guards the *application* path (Prisma / DATABASE_URL). It cannot
 * see a test that shells out to the `sqlite3` binary with a hardcoded path —
 * tests/unit/canonTemplateResolve.test.ts does exactly that, deliberately, to
 * check the export against real prose. That one is pinned read-only at its own
 * call site instead.
 */

const SANDBOX_URL = 'file:./sandbox.db'

const configured = process.env.DATABASE_URL

if (configured) {
  assertNotProductionDb(resolveDbPath(configured), 'Jest (DATABASE_URL)')
} else {
  process.env.DATABASE_URL = SANDBOX_URL
}

// Belt and braces: whatever we ended up with must not be production. Catches a
// future edit to SANDBOX_URL as much as anything else — the constant is the
// kind of thing that gets "temporarily" repointed during debugging.
const effective = resolveDbPath(process.env.DATABASE_URL as string)
if (isProductionDbPath(effective)) {
  throw new Error(`Jest DB guard resolved to production: ${effective}`)
}

// Exported for the guard's own test; also documents what the run settled on.
export const effectiveTestDbPath = effective
export const sandboxDbPath = path.resolve(process.cwd(), 'sandbox.db')
