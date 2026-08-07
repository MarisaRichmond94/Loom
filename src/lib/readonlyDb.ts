import Database from 'better-sqlite3'
import { resolveDbPath } from '@/lib/dbSafety'

/**
 * The one sanctioned way to open a SQLite file this process does not own
 * (LOOM-125).
 *
 * Two callers, both crossing a boundary:
 *   - the publish step reads `dev.db` (LOOM-127)
 *   - Loom reads the reader tier's `reader.db` for the comments dock (LOOM-135)
 *
 * `readonly: true` is the point. It is not a convention or a code-review rule —
 * a write through this handle throws at the SQLite layer, so "the reader tier
 * never writes to the manuscript" is enforced by the driver rather than by
 * everyone remembering. `fileMustExist: true` matters for the same reason:
 * without it, a typo'd path silently CREATES an empty database and the caller
 * reads zero rows, which looks like "the series is empty" rather than "you are
 * pointed at the wrong file".
 *
 * Deliberately NOT guarded against `dev.db` here — publish is supposed to read
 * it. The rule that the *reader app* must never open it is enforced where it
 * belongs, at that app's boot (LOOM-130), via `assertNotProductionDb`.
 */
export function openReadOnly(fileOrUrl: string): Database.Database {
  const filePath = resolveDbPath(fileOrUrl)
  try {
    return new Database(filePath, { readonly: true, fileMustExist: true })
  } catch (e) {
    // better-sqlite3's own message for a missing file is "unable to open
    // database file", which reads like a permissions problem. Say which path
    // was tried — the usual cause is a relative path resolved from an
    // unexpected cwd (a launchd service, a script run from elsewhere).
    const reason = e instanceof Error ? e.message : String(e)
    throw new Error(`Cannot open ${filePath} read-only: ${reason}`)
  }
}
