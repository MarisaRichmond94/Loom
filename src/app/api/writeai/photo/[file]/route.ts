import { writeaiBase } from '@/lib/writeaiProxy'

type Params = { params: Promise<{ file: string }> }

// A writer-character portrait, proxied from WriteAI (LOOM-32).
//
// Not JSON, so it cannot go through callWriteAi: the body is an image byte
// stream and is streamed straight back.
//
// WriteAI stores one photo per character under a STABLE filename and
// overwrites it in place, which is why its own route sets Cache-Control:
// no-cache — without it the browser keeps showing the previous portrait after
// an upload, since the URL never changed. That header is preserved here for
// exactly the same reason.
export async function GET(_: Request, { params }: Params) {
  const { file } = await params

  // The filename lands in a path, so anything that could climb out of the
  // photos directory is refused rather than forwarded. WriteAI's own GET is
  // already guarded (it takes Path(filename).name), but a proxy that only
  // works because the thing behind it is careful is not a guard.
  if (!/^[A-Za-z0-9._-]+$/.test(file) || file.includes('..')) {
    return Response.json({ error: 'bad filename' }, { status: 400 })
  }

  let res: Response
  try {
    res = await fetch(`${writeaiBase()}/api/plan/photos/${encodeURIComponent(file)}`)
  } catch {
    return Response.json({ error: 'WriteAI is not reachable', unreachable: true }, { status: 503 })
  }
  if (!res.ok || !res.body) {
    return Response.json({ error: `WriteAI responded ${res.status}` }, { status: 502 })
  }

  return new Response(res.body, {
    headers: {
      'Content-Type': res.headers.get('content-type') ?? 'image/png',
      'Cache-Control': res.headers.get('cache-control') ?? 'no-cache',
    },
  })
}
