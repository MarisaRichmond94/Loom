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

// True when the client already holds this exact file. If-None-Match wins over
// If-Modified-Since when both are present, per RFC 9110.
function isFresh(req: Request, etag: string, mtimeSec: number): boolean {
  const inm = req.headers.get('if-none-match')
  if (inm) {
    // A list, and entries may be weak ("W/\"abc\""). We only ever emit one
    // strong tag, so compare on the bare value.
    return inm
      .split(',')
      .map(t => t.trim().replace(/^W\//, ''))
      .some(t => t === '*' || t === etag)
  }
  const ims = req.headers.get('if-modified-since')
  if (ims) {
    const since = Date.parse(ims)
    if (!Number.isNaN(since)) return mtimeSec <= Math.floor(since / 1000)
  }
  return false
}

export async function GET(req: Request, { params }: Params) {
  const { path: segments } = await params
  const abs = resolveSafe(segments)
  if (!abs) return new Response('Bad path', { status: 400 })

  let size: number
  let mtimeMs: number
  try {
    const s = await stat(abs)
    if (!s.isFile()) return new Response('Not found', { status: 404 })
    size = s.size
    mtimeMs = s.mtimeMs
  } catch {
    return new Response('Not found', { status: 404 })
  }

  // Validators, so `must-revalidate` can actually resolve to a 304.
  //
  // Without these the revalidation had nothing to compare against and every
  // request re-sent the whole body — book covers alone meant ~1.8MB
  // re-downloaded and re-decoded on every visit to the series page. The
  // identity is (size, mtime): both change when a file is replaced in place,
  // which is exactly the case the `must-revalidate` policy exists to catch.
  //
  // HTTP dates have one-second granularity, so Last-Modified is floored to
  // the second and If-Modified-Since is compared at that resolution.
  const mtimeSec = Math.floor(mtimeMs / 1000)
  const etag = `"${size.toString(16)}-${mtimeSec.toString(16)}"`
  const lastModified = new Date(mtimeSec * 1000).toUTCString()

  const type = MIME[path.extname(abs).toLowerCase()] ?? 'application/octet-stream'
  const baseHeaders: Record<string, string> = {
    'Content-Type': type,
    'Accept-Ranges': 'bytes',
    // These files can be replaced in place (e.g. avatar.jpg), so revalidate
    // rather than let a stale copy stick. Callers also append ?t= where needed.
    'Cache-Control': 'public, max-age=0, must-revalidate',
    ETag: etag,
    'Last-Modified': lastModified,
  }

  // Honor Range requests so <audio>/<video> can seek and Safari can play.
  const range = req.headers.get('range')

  // Conditional GET. Skipped entirely when the client asked for a range:
  // answering a seek with a bodyless 304 is a good way to break audio
  // playback, and a ranged request is never the cheap "do I still have the
  // current file?" check this branch is here to short-circuit.
  if (!range && isFresh(req, etag, mtimeSec)) {
    return new Response(null, { status: 304, headers: baseHeaders })
  }
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
