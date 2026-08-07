import Database from 'better-sqlite3'
import { statSync } from 'node:fs'
import path from 'node:path'

/**
 * The reader app's only database access (LOOM-130).
 *
 * DELIBERATELY NOT PRISMA. Loom's schema has ~25 models and most are
 * author-only — ChapterNote, WriterCharacterSnapshot, the WriteAI surface. A
 * generated client scoped to the reader would still be a client that COULD be
 * regenerated against the wrong schema. Raw SQL against a file that only
 * contains published, canon-flattened prose is a stronger guarantee: there is
 * no model definition here to express a query the reader should not make.
 *
 * Two files, both opened read-only:
 *   content.db — the published snapshot. Rebuilt wholesale by every publish,
 *                so this process must never hold a write handle on it.
 *   reader.db  — readers, progress, comments (LOOM-132/133/134). Not yet
 *                created; this module will gain a WRITE handle for it, and
 *                only for it.
 *
 * THE MANUSCRIPT IS NOT REACHABLE FROM HERE. `assertReaderSafe` refuses at boot
 * rather than trusting configuration to stay correct.
 */

const repoRoot = path.resolve(process.cwd(), '..')

/** `content.db`, or `content-sandbox.db` when pointed at the fixture. */
export const CONTENT_DB_PATH =
  process.env.READER_CONTENT_DB ?? path.join(repoRoot, 'reader', 'content.db')

/**
 * Refuses to serve the manuscript.
 *
 * Mirrors `isProductionDbPath` in Loom's `src/lib/dbSafety.ts`. Duplicated
 * rather than imported so the reader app has no import path into Loom's `src/`
 * at all — an accidental relative import across that boundary would compile,
 * and this module is exactly where such a mistake would be most costly.
 */
export function assertReaderSafe(filePath: string): void {
  const base = path.basename(filePath)
  if (base === 'dev.db' || base.startsWith('dev.db.')) {
    throw new Error(
      `\n  ✗ The reader app was pointed at the MANUSCRIPT (${filePath}).\n` +
      `    It serves content.db — a published snapshot. Refusing to start.\n`,
    )
  }
}

let content: Database.Database | null = null
let openedStamp = ''

/**
 * Identity of the file currently on disk — inode first, because publish REPLACES
 * the snapshot rather than writing into it. A held handle follows the old inode
 * happily: same path, same queries, no error, silently the previous publish.
 */
function stamp(): string {
  try {
    const s = statSync(CONTENT_DB_PATH)
    return `${s.ino}:${s.size}:${s.mtimeMs}`
  } catch {
    // Missing for an instant mid-publish (or genuinely gone). Keep serving what
    // we have; the next call re-checks.
    return openedStamp
  }
}

/**
 * The published snapshot, opened read-only.
 *
 * REOPENED WHEN THE FILE IS REPLACED. Caching the handle alone was wrong in a
 * way that looked like nothing at all: publish rebuilds the snapshot as a new
 * file, so a long-lived reader kept serving the inode it opened at boot. Every
 * page still rendered, every query still succeeded, and a republish simply had
 * no effect until someone restarted the process — which under launchd is never.
 * The word highlight surfaced it (a chapter shipped an empty block list while
 * the snapshot on disk had one), but the same staleness applied to the PROSE.
 *
 * `fileMustExist` is deliberate: without it a typo'd path silently CREATES an
 * empty database and every page renders "no books", which reads as "nothing is
 * published" rather than "you are pointed at the wrong file".
 */
export function contentDb(): Database.Database {
  const current = stamp()
  if (content && current === openedStamp) return content
  assertReaderSafe(CONTENT_DB_PATH)
  const next = new Database(CONTENT_DB_PATH, { readonly: true, fileMustExist: true })
  // Swap only once the new handle is open, so a failed reopen leaves the
  // previous snapshot being served rather than taking the app down.
  content?.close()
  content = next
  openedStamp = current
  return content
}

/** True when a publish has happened and there is something to serve. */
export function hasContent(): boolean {
  try {
    contentDb()
    return true
  } catch {
    return false
  }
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function query<T = any>(sql: string, ...params: unknown[]): T[] {
  return contentDb().prepare(sql).all(...params) as T[]
}
