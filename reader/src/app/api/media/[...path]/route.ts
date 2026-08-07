import { createReadStream, existsSync, statSync } from 'node:fs'
import path from 'node:path'
import { Readable } from 'node:stream'
import { NextResponse } from 'next/server'
import { resolveReader } from '@/lib/readers'

/**
 * Serves published media from the reader app's own public/ (LOOM-131).
 *
 * `next start` only serves files that existed in public/ when the server
 * booted, but publish hardlinks covers, portraits, soundtracks and narration in
 * afterwards. So next.config rewrites those URLs here and this reads from disk
 * per request — the same pattern Loom uses for runtime uploads.
 *
 * Only the four published media roots are reachable, and every path is resolved
 * and checked against the root before it is opened: these URLs come from a
 * database, and "..%2F.." is the oldest trick there is.
 */

const MEDIA_ROOTS = new Set(['covers', 'characters', 'music', 'narration'])
const PUBLIC_ROOT = path.join(process.cwd(), 'public')

const MIME: Record<string, string> = {
  '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.png': 'image/png',
  '.webp': 'image/webp', '.gif': 'image/gif', '.svg': 'image/svg+xml',
  '.mp3': 'audio/mpeg', '.m4a': 'audio/mp4', '.webm': 'audio/webm',
}

export async function GET(
  req: Request,
  { params }: { params: Promise<{ path: string[] }> },
) {
  // Gated like the pages (LOOM-132). Without this the prose would be behind an
  // invite while the audiobook, the covers and the portraits sat open to anyone
  // who could reach the host — the chapter URLs are in the same snapshot the
  // media paths come from, so guessing one gets you the other.
  //
  // 404 rather than a redirect to /invite: this answers <img> and <audio>, and
  // an HTML page returned to those is a broken asset with a confusing status.
  if (!(await resolveReader())) {
    return new NextResponse('Not found', { status: 404 })
  }

  const { path: segments } = await params
  if (!segments?.length || !MEDIA_ROOTS.has(segments[0])) {
    return new NextResponse('Not found', { status: 404 })
  }

  const target = path.resolve(PUBLIC_ROOT, ...segments)
  // Resolve first, THEN compare. Checking the raw segments would miss an
  // encoded traversal that only becomes obvious after normalisation.
  if (target !== PUBLIC_ROOT && !target.startsWith(PUBLIC_ROOT + path.sep)) {
    return new NextResponse('Not found', { status: 404 })
  }
  if (!existsSync(target) || !statSync(target).isFile()) {
    return new NextResponse('Not found', { status: 404 })
  }

  const stat = statSync(target)
  const type = MIME[path.extname(target).toLowerCase()] ?? 'application/octet-stream'
  const range = req.headers.get('range')

  // Range support matters for narration: without it a browser cannot seek in a
  // chapter's audio, and scrubbing is most of how anyone uses a player.
  if (range) {
    const m = /bytes=(\d*)-(\d*)/.exec(range)
    if (m) {
      const start = m[1] ? parseInt(m[1], 10) : 0
      const end = m[2] ? parseInt(m[2], 10) : stat.size - 1
      if (start < stat.size && end < stat.size && start <= end) {
        const stream = createReadStream(target, { start, end })
        return new NextResponse(Readable.toWeb(stream) as ReadableStream, {
          status: 206,
          headers: {
            'Content-Type': type,
            'Content-Length': String(end - start + 1),
            'Content-Range': `bytes ${start}-${end}/${stat.size}`,
            'Accept-Ranges': 'bytes',
          },
        })
      }
    }
  }

  return new NextResponse(Readable.toWeb(createReadStream(target)) as ReadableStream, {
    headers: {
      'Content-Type': type,
      'Content-Length': String(stat.size),
      'Accept-Ranges': 'bytes',
      'Cache-Control': 'private, max-age=3600',
    },
  })
}
