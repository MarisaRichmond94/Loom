import { createReadStream } from 'fs'
import { stat } from 'fs/promises'
import { Readable } from 'stream'
import path from 'path'

// Serves user-uploaded files (soundtrack audio + album art, character avatars,
// book covers, profile avatars) that are written into `public/` at runtime.
//
// Why this exists: `next start` (production) snapshots the `public/` directory
// once at boot and 404s anything added afterwards, so uploads don't appear
// until a server restart. `next dev` read `public/` fresh per request, which is
// why this only broke after switching to production mode. A `beforeFiles`
// rewrite in next.config.ts points the original URLs (/music/*, /characters/*,
// /covers/*, /avatar.jpg, /pseudonym-avatar.jpg) here so they stream straight
// from disk on every request, with HTTP Range support for audio seeking.

const PUBLIC_DIR = path.join(process.cwd(), 'public')

const MIME: Record<string, string> = {
  '.mp3': 'audio/mpeg',
  '.m4a': 'audio/mp4',
  '.aac': 'audio/aac',
  '.webm': 'audio/webm',
  '.ogg': 'audio/ogg',
  '.opus': 'audio/ogg',
  '.wav': 'audio/wav',
  '.flac': 'audio/flac',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.png': 'image/png',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.svg': 'image/svg+xml',
}

type Params = { params: Promise<{ path: string[] }> }

// Resolve the request path to an absolute file inside PUBLIC_DIR, rejecting any
// traversal attempt (encoded or otherwise) that would escape the directory.
function resolveSafe(segments: string[]): string | null {
  const decoded = segments.map(s => decodeURIComponent(s))
  if (decoded.some(s => s.includes('\0') || s === '..')) return null
  const abs = path.normalize(path.join(PUBLIC_DIR, ...decoded))
  if (abs !== PUBLIC_DIR && !abs.startsWith(PUBLIC_DIR + path.sep)) return null
  return abs
}

export async function GET(req: Request, { params }: Params) {
  const { path: segments } = await params
  const abs = resolveSafe(segments)
  if (!abs) return new Response('Bad path', { status: 400 })

  let size: number
  try {
    const s = await stat(abs)
    if (!s.isFile()) return new Response('Not found', { status: 404 })
    size = s.size
  } catch {
    return new Response('Not found', { status: 404 })
  }

  const type = MIME[path.extname(abs).toLowerCase()] ?? 'application/octet-stream'
  const baseHeaders: Record<string, string> = {
    'Content-Type': type,
    'Accept-Ranges': 'bytes',
    // These files can be replaced in place (e.g. avatar.jpg), so revalidate
    // rather than let a stale copy stick. Callers also append ?t= where needed.
    'Cache-Control': 'public, max-age=0, must-revalidate',
  }

  // Honor Range requests so <audio>/<video> can seek and Safari can play.
  const range = req.headers.get('range')
  if (range) {
    const m = /^bytes=(\d*)-(\d*)$/.exec(range.trim())
    if (m) {
      let start = m[1] ? parseInt(m[1], 10) : 0
      let end = m[2] ? parseInt(m[2], 10) : size - 1
      if (Number.isNaN(start)) start = 0
      if (Number.isNaN(end) || end >= size) end = size - 1
      if (start > end || start >= size) {
        return new Response('Range not satisfiable', {
          status: 416,
          headers: { 'Content-Range': `bytes */${size}`, 'Accept-Ranges': 'bytes' },
        })
      }
      const nodeStream = createReadStream(abs, { start, end })
      const body = Readable.toWeb(nodeStream) as ReadableStream
      return new Response(body, {
        status: 206,
        headers: {
          ...baseHeaders,
          'Content-Range': `bytes ${start}-${end}/${size}`,
          'Content-Length': String(end - start + 1),
        },
      })
    }
  }

  const nodeStream = createReadStream(abs)
  const body = Readable.toWeb(nodeStream) as ReadableStream
  return new Response(body, {
    status: 200,
    headers: { ...baseHeaders, 'Content-Length': String(size) },
  })
}

export async function HEAD(req: Request, ctx: Params) {
  const res = await GET(req, ctx)
  return new Response(null, { status: res.status, headers: res.headers })
}
