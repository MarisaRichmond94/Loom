import { spawn } from 'node:child_process'
import path from 'node:path'
import { NextResponse } from 'next/server'

// On-demand full backup (KAN-26).
//
// Scheduled snapshots only run at 08:30, 18:00 and 22:30. This is the "I am
// about to do something risky, take one now" button — before a big
// restructure, before accepting a large edit, before letting an agent loose on
// the database.
//
// Runs ops/loom_db_snapshot.sh rather than reimplementing the snapshot in
// TypeScript. That script already does `sqlite3 .backup` (not a file copy —
// dev.db has been observed with a multi-MB WAL), validates by decompressing
// and running integrity_check plus a chapter floor, and uploads to Drive.
// A second implementation would be a second thing to get wrong, and the
// validation is the part that matters.
//
// FORCE=1 is essential: the script skips when dev.db is not newer than the
// last snapshot, which is right for a cron and wrong here — the writer asked
// for a backup, and exiting 0 having produced nothing would report success for
// work that never happened.
//
// Safe while Loom is live. `sqlite3 .backup` is designed for it; no service
// stop, and nothing here touches the database Loom is serving from.

export const dynamic = 'force-dynamic'
export const maxDuration = 300

const SNAPSHOT_TIMEOUT_MS = 4 * 60 * 1000

export async function POST() {
  // Resolve from the repo root, NOT via ~/Scripts. The symlink is a
  // convenience for launchd; the app should not depend on it existing.
  const script = path.join(process.cwd(), 'ops', 'loom_db_snapshot.sh')

  const result = await new Promise<{ code: number | null; out: string }>(resolve => {
    let out = ''
    let settled = false
    const child = spawn('/bin/bash', [script], {
      env: { ...process.env, FORCE: '1' },
      cwd: process.cwd(),
    })
    const done = (code: number | null) => {
      if (settled) return
      settled = true
      resolve({ code, out })
    }
    const timer = setTimeout(() => {
      child.kill('SIGTERM')
      out += '\n[timed out]'
      done(null)
    }, SNAPSHOT_TIMEOUT_MS)

    child.stdout.on('data', d => { out += d.toString() })
    child.stderr.on('data', d => { out += d.toString() })
    child.on('error', err => { out += `\n[spawn failed] ${err.message}`; clearTimeout(timer); done(null) })
    child.on('close', code => { clearTimeout(timer); done(code) })
  })

  // The script logs a line that names the file and what was verified in it.
  // Parse it rather than reporting a bare exit code — "it exited 0" is the
  // claim KAN-14 exists to stop trusting.
  const ok = result.code === 0
  const match = /Snapshot OK:\s*(\S+)\s+chapters=(\d+)\s+words=(\d+)\s+->\s+(\S+)/.exec(result.out)
  const skipped = /nothing new to capture, skipping/.test(result.out)

  if (!ok || !match) {
    return NextResponse.json(
      {
        ok: false,
        // Surface what the script actually said; a generic failure would send
        // the writer to a log file they should not need to find.
        error: skipped
          ? 'The snapshot was skipped, which should not happen with FORCE set.'
          : 'Snapshot failed or could not be verified.',
        log: result.out.trim().split('\n').slice(-12).join('\n'),
      },
      { status: 500 },
    )
  }

  const [, size, chapters, words, dest] = match
  return NextResponse.json({
    ok: true,
    size: humanSize(size),
    chapters: Number(chapters),
    words: Number(words),
    path: dest,
    file: path.basename(dest),
    uploaded: /Upload complete/.test(result.out),
  })
}

// `du -h` writes "25M", which reads as ambiguous — megabits, megabytes, or a
// typo. Spell out the unit.
function humanSize(raw: string): string {
  const m = /^([\d.]+)\s*([KMGT])i?B?$/i.exec(raw.trim())
  if (!m) return raw
  return `${m[1]} ${m[2].toUpperCase()}B`
}
