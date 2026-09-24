// Review configuration options, proxied from WriteAI (same-origin, URL kept
// server-side — the same reasoning as review/run). The settings cog in the
// review panel populates its model / effort / preset dropdowns from this,
// so WriteAI stays the single source of truth for what is offerable.

export const dynamic = 'force-dynamic'

export async function GET() {
  const base = process.env.NEXT_PUBLIC_WRITEAI_URL ?? 'http://localhost:8000'
  try {
    const upstream = await fetch(`${base}/api/review/options`, { cache: 'no-store' })
    if (!upstream.ok) {
      return Response.json({ error: `WriteAI responded ${upstream.status}` }, { status: 502 })
    }
    return Response.json(await upstream.json())
  } catch (err) {
    return Response.json(
      { error: 'WriteAI is not reachable', detail: err instanceof Error ? err.message : 'unknown' },
      { status: 503 },
    )
  }
}
