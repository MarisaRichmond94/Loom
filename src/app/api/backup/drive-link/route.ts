import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { NextResponse } from 'next/server'
import { gdriveRoot } from '@/lib/backupPaths'

// Resolve a browser URL for the Drive folder a snapshot was uploaded to (KAN-26).
//
// Resolved on click rather than as part of the snapshot response, deliberately.
// The snapshot is the thing that matters and it is already verified by the time
// the writer sees it; making it wait on a second network round trip — or fail
// because Drive was briefly unreachable — would trade something important for
// a convenience link.
//
// This reads a folder id. It does not create a sharing link, so nothing here
// changes who can see the backups.

const run = promisify(execFile)

export const dynamic = 'force-dynamic'

const RCLONE_CANDIDATES = ['/opt/homebrew/bin/rclone', '/usr/local/bin/rclone']

export async function GET(req: Request) {
  const date = new URL(req.url).searchParams.get('date') ?? ''
  // The date is interpolated into a remote path, so constrain it hard rather
  // than trusting that it came from our own response.
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    return NextResponse.json({ ok: false, error: 'Expected a YYYY-MM-DD date.' }, { status: 400 })
  }

  const root = gdriveRoot()
  // In tests GDRIVE_ROOT is a plain local path, which rclone treats as a local
  // remote. That works for uploads but there is no Drive folder to link to.
  if (!root.includes(':')) {
    return NextResponse.json(
      { ok: false, error: 'Backups are not configured to go to Google Drive.' },
      { status: 400 },
    )
  }

  let rclone = ''
  for (const c of RCLONE_CANDIDATES) {
    try { await run(c, ['version']); rclone = c; break } catch { /* try the next */ }
  }
  if (!rclone) {
    return NextResponse.json({ ok: false, error: 'rclone is not installed.' }, { status: 500 })
  }

  try {
    // `--format ip` returns "<id>;<name>/"; `--dirs-only` keeps it to folders.
    // Listing the parent and matching is what gets us the id for one child.
    //
    // Retried once. This is a network call against Google, and an occasional
    // first-attempt failure was observed during development (non-zero exit,
    // empty stderr) that a retry always cleared. A convenience link is not
    // worth an error message the writer has to think about.
    let stdout = ''
    let lastErr: unknown
    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        ;({ stdout } = await run(rclone, ['lsf', '--dirs-only', '--format', 'ip', root], {
          timeout: 30_000,
        }))
        lastErr = undefined
        break
      } catch (e) {
        lastErr = e
      }
    }
    if (lastErr) throw lastErr

    const line = stdout.split('\n').find(l => l.endsWith(`;${date}/`))
    const id = line?.split(';')[0]
    if (!id) {
      return NextResponse.json(
        { ok: false, error: `No ${date} folder in Drive — the upload may not have run.` },
        { status: 404 },
      )
    }
    return NextResponse.json({ ok: true, url: `https://drive.google.com/drive/folders/${id}` })
  } catch (err) {
    const stderr = (err as { stderr?: string })?.stderr?.trim()
    return NextResponse.json(
      {
        ok: false,
        error: 'Could not reach Google Drive.',
        detail: stderr || (err instanceof Error ? err.message : String(err)),
      },
      { status: 502 },
    )
  }
}
