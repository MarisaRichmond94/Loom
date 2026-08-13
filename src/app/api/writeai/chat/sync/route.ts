import { callWriteAi, writeaiBase } from '@/lib/writeaiProxy'

// Index freshness, and the guarded resync behind it (LOOM-117).
//
// ── Why this exists ─────────────────────────────────────────────────────────
//
// Unlike the review panel, which passes the LIVE editor text and therefore
// reads what the writer just typed, Explore answers strictly from the last
// ingest. Ask it about a scene written this morning and it answers as though
// that scene does not exist — confidently, and with no signal. To the writer
// that reads as the model being wrong about her own book. It is not; it is
// reading an older copy, and the tab has to say so.
//
// ── The three verbs ─────────────────────────────────────────────────────────
//
//   GET                  → freshness (pure read)
//   GET ?preview=<n>     → dry-run diff + cost estimate for one book
//   POST { book }        → run the ingest (money)
//
// The split is the guard. Nothing here runs automatically: the banner reads
// `GET`, the writer sees a cost, and only then can `POST` spend anything.

export const dynamic = 'force-dynamic'

type SyncBook = {
  book?: number
  title?: string
  manifest_found?: boolean
  behind?: boolean
  missing_chapters?: number[]
  extra_chapters?: number[]
  exported_at?: string | null
}

export async function GET(req: Request) {
  const preview = new URL(req.url).searchParams.get('preview')

  if (preview !== null) {
    const book = Number(preview)
    if (!Number.isInteger(book) || book < 0) {
      return Response.json({ error: 'preview must be a book number' }, { status: 400 })
    }
    // Dry run: what would change, and what it would cost. Takes ~30s when a
    // manuscript needs re-reading, so it is a deliberate step the writer
    // triggers — never something the banner fires as it renders.
    const result = await callWriteAi(`/api/ingest/preview?book=${book}`)
    if ('response' in result) return result.response
    return Response.json(result.data)
  }

  const status = await callWriteAi('/api/sync/status', { cache: 'no-store' })
  if ('response' in status) return status.response

  const payload = status.data as { books?: SyncBook[]; last_synced?: string | null }
  const rows = payload?.books ?? []

  // ⚠️ `manifest_found: false` means UNKNOWN, not stale — the endpoint's own
  // docstring says so. A book Loom has never canon-exported has nothing to
  // compare against, and reporting that as drift would put a warning on the
  // screen that carries no information and cannot be cleared.
  const books = rows.map(b => ({
    number: b.book,
    title: b.title,
    known: b.manifest_found === true,
    behind: b.manifest_found === true && b.behind === true,
    missingChapters: b.missing_chapters ?? [],
    extraChapters: b.extra_chapters ?? [],
    exportedAt: b.exported_at ?? null,
  }))

  const running = await callWriteAi('/api/ingest/status', { cache: 'no-store' })
  const ingest = 'response' in running
    ? { running: false }
    : {
        running: (running.data as { running?: boolean })?.running === true,
        chunksDone: (running.data as { chunks_done?: number })?.chunks_done ?? null,
        chunksTotal: (running.data as { chunks_total?: number })?.chunks_total ?? null,
      }

  const enriching = await callWriteAi('/api/enrich/status', { cache: 'no-store' })
  const enrich = 'response' in enriching
    ? { running: false }
    : {
        running: (enriching.data as { state?: string })?.state === 'running',
        done: (enriching.data as { done?: number })?.done ?? 0,
        total: (enriching.data as { total?: number })?.total ?? 0,
      }

  return Response.json({ books, lastSynced: payload?.last_synced ?? null, ingest, enrich })
}

export async function POST(req: Request) {
  let body: { book?: unknown }
  try {
    body = await req.json()
  } catch {
    return Response.json({ error: 'invalid JSON body' }, { status: 400 })
  }

  const book = Number(body.book)
  if (!Number.isInteger(book) || book < 0) {
    // Deliberately no "sync everything" form. `POST /api/ingest/run` with no
    // book re-ingests the whole series, which is a different order of cost
    // from what this button is for.
    return Response.json({ error: 'a book number is required' }, { status: 400 })
  }

  let res: Response
  try {
    // `full` is never passed. A full re-ingest ignores the stored chunk hashes
    // and re-extracts EVERY chapter — orders of magnitude more expensive than
    // catching up on what changed, and never what a staleness banner is asking
    // for. This button must not be able to offer it.
    res = await fetch(`${writeaiBase()}/api/ingest/run?book=${book}`, { method: 'POST' })
  } catch (err) {
    return Response.json(
      {
        error: 'WriteAI is not reachable',
        unreachable: true,
        detail: err instanceof Error ? err.message : 'unknown',
      },
      { status: 503 },
    )
  }

  if (res.status === 409) {
    // An ingest is already running — including while the previous run's
    // post-processing writes are still in flight, because those touch the same
    // SQLite database. Passed through as its own state so the UI can say
    // "already syncing" instead of showing a failure.
    return Response.json({ error: 'a sync is already running', alreadyRunning: true },
      { status: 409 })
  }
  if (!res.ok) {
    const detail = await res.text().catch(() => '')
    return Response.json(
      { error: `WriteAI responded ${res.status}`, detail: detail.slice(0, 500) },
      { status: 502 },
    )
  }

  return Response.json({ ok: true, book })
}
