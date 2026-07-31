import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { NextResponse } from 'next/server'
import { resolveInsideBackupRoot } from '@/lib/backupPaths'

// "Show in Finder" for a finished snapshot (KAN-26).
//
// Loom runs on the writer's own machine, so revealing a file is a normal thing
// for it to do — this is not a server reaching into a client's filesystem.
//
// execFile, not exec: the path goes in as an argv element, so it is never
// parsed by a shell. Backup paths contain dates and can contain spaces, and
// `open -R $path` through a shell is how that turns into a bug.

const run = promisify(execFile)

export const dynamic = 'force-dynamic'

export async function POST(req: Request) {
  let body: { path?: string }
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ ok: false, error: 'Expected a JSON body.' }, { status: 400 })
  }

  const target = await resolveInsideBackupRoot(body.path ?? '')
  if (!target) {
    return NextResponse.json(
      { ok: false, error: 'That backup is no longer where it was written.' },
      { status: 404 },
    )
  }

  try {
    // -R reveals the file with it selected, rather than opening it. Opening a
    // .db.gz would hand it to whatever is registered for the extension, which
    // at best decompresses a 120 MB database into the writer's Downloads.
    await run('/usr/bin/open', ['-R', target])
    return NextResponse.json({ ok: true })
  } catch (err) {
    return NextResponse.json(
      { ok: false, error: err instanceof Error ? err.message : 'Could not open Finder.' },
      { status: 500 },
    )
  }
}
