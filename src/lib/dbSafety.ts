import path from 'node:path'

/**
 * Guards against pointing anything at the production manuscript (LOOM-125).
 *
 * `dev.db` IS production. There is no separate prod database, and it holds the
 * only copy of the prose — so the failure this module exists to prevent is not
 * an exotic one. It is the ordinary one: a test run, a dev server, or a
 * half-finished script pointed at the real database because that was the
 * default. `.env` ships `DATABASE_URL="file:./dev.db"`, so the default is
 * exactly what we are defending against.
 *
 * Deliberately free of `better-sqlite3` (or any native import) so the jsdom
 * test project can load it in setup without pulling in a native binding. The
 * actual connection lives in `readonlyDb.ts`.
 */

/** Basenames that mean "this is the manuscript". */
const PRODUCTION_BASENAME = 'dev.db'

/**
 * Pre-migration snapshots (`dev.db.pre-explore-20260805`, etc). These are full
 * copies of the manuscript, so treating them as safe would defeat the point —
 * a test that wipes a snapshot has still destroyed a backup.
 */
const PRODUCTION_SNAPSHOT_PREFIX = 'dev.db.'

/**
 * Turn a Prisma-style `DATABASE_URL` into an absolute filesystem path.
 *
 * Mirrors the resolution in `src/lib/prisma.ts` on purpose: a guard that
 * resolved paths differently from the client it guards would pass while the
 * client connected somewhere else entirely.
 */
export function resolveDbPath(url: string, cwd: string = process.cwd()): string {
  const raw = url.startsWith('file:') ? url.slice('file:'.length) : url
  return path.resolve(cwd, raw)
}

/**
 * True when this path is the manuscript or one of its snapshots.
 *
 * Compares the basename rather than the full path so it holds regardless of
 * where the repo lives or how the URL was written (`./dev.db`, `dev.db`, an
 * absolute path, or a relative climb).
 */
export function isProductionDbPath(filePath: string): boolean {
  const base = path.basename(filePath)
  return base === PRODUCTION_BASENAME || base.startsWith(PRODUCTION_SNAPSHOT_PREFIX)
}

/**
 * Throw if `filePath` is the manuscript. `context` names the caller so the
 * message says what to fix rather than only what went wrong.
 *
 * Used by the Jest setup (every test run) and, from LOOM-130, by the reader
 * app at boot. Both want the same answer to "am I about to touch production?",
 * and both want it to be loud rather than survivable.
 */
export function assertNotProductionDb(filePath: string, context: string): void {
  if (!isProductionDbPath(filePath)) return
  throw new Error(
    [
      '',
      '  ✗ REFUSING TO RUN AGAINST THE PRODUCTION MANUSCRIPT',
      '',
      `    context:  ${context}`,
      `    resolved: ${filePath}`,
      '',
      '    dev.db is production — it holds the only copy of the prose.',
      '    Point DATABASE_URL at sandbox.db instead:',
      '',
      '      node scripts/build-sandbox-db.mjs      # (re)build the fixture',
      '      DATABASE_URL="file:./sandbox.db" …     # then run this again',
      '',
    ].join('\n'),
  )
}
