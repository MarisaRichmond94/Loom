import path from 'node:path'
import os from 'node:os'
import { realpath } from 'node:fs/promises'

// Backup path resolution for the on-demand snapshot (KAN-26).
//
// BACKUP_ROOT must agree with ops/loom_db_snapshot.sh, which reads the same
// variable with the same default. If they drift, the snapshot lands somewhere
// the "Show in Finder" action refuses to open.

export function backupRoot(): string {
  return process.env.BACKUP_ROOT || path.join(os.homedir(), 'Backups')
}

/**
 * Resolve a path the client handed back to us, and confirm it is inside the
 * backup root.
 *
 * The client only ever sends a path we gave it, so this is not defending
 * against the writer. It is defending against the route becoming a general
 * "reveal any path on this machine" primitive — the snapshot response is the
 * kind of thing that gets logged, copied into a bug report, and replayed, and
 * an endpoint that runs `open -R` on arbitrary input is a worse thing to own
 * than one that runs it on paths under ~/Backups.
 *
 * Compares realpaths so a symlink out of the backup root cannot smuggle a
 * target past a prefix check, and compares with a trailing separator so
 * `~/Backups-elsewhere` does not pass as being inside `~/Backups`.
 */
export async function resolveInsideBackupRoot(candidate: string): Promise<string | null> {
  if (!candidate || typeof candidate !== 'string') return null
  try {
    const root = await realpath(backupRoot())
    const target = await realpath(candidate)
    if (target === root) return target
    return target.startsWith(root + path.sep) ? target : null
  } catch {
    // A missing path is not inside anything. Callers report this as "that
    // backup is no longer there", which is the truth and is worth knowing.
    return null
  }
}
