import { NextRequest, NextResponse } from 'next/server'
import { readEvents } from '@/lib/eventBus'

// Cursor-based pull for external consumers: GET /api/events?since=<seq>.
// Returns events strictly after `since` in seq order plus the cursor to
// store for the next poll. Consumers that miss events (app closed, crash)
// simply resume from their stored cursor — and reconcile against the
// canon-export manifests for anything older than the outbox.
export async function GET(req: NextRequest) {
  const since = Number(req.nextUrl.searchParams.get('since') ?? '0')
  const limit = Math.min(Number(req.nextUrl.searchParams.get('limit') ?? '500'), 2000)
  if (!Number.isFinite(since) || since < 0) {
    return NextResponse.json({ error: 'since must be a non-negative number' }, { status: 400 })
  }
  const events = await readEvents(since, limit)
  return NextResponse.json({
    events,
    cursor: events.length ? events[events.length - 1].seq : since,
  })
}
