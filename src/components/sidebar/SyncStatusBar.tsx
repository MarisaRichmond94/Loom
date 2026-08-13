'use client'

import { useEffect, useState } from 'react'
import { LuRefreshCw, LuSparkles } from 'react-icons/lu'

const POLL_MS = 8000
const PHRASE_MS = 3400

const SYNC_PHRASES = [
  'Syncing books…',
  'Reading your latest pages…',
  'Comparing chapters…',
  'Spotting what changed…',
  'Refreshing the index…',
]

const ENRICH_PHRASES = [
  'Enriching insights…',
  'Reading between the lines…',
  'Connecting plot threads…',
  'Studying your characters…',
  'Cataloguing revelations…',
  'Tracing story arcs…',
]

function usePhrase(phrases: string[], active: boolean): string {
  const [i, setI] = useState(0)
  useEffect(() => {
    if (!active) return
    const id = setInterval(() => setI(n => n + 1), PHRASE_MS)
    return () => clearInterval(id)
  }, [active])
  return phrases[i % phrases.length]
}

type Ingest = { running: boolean; chunksDone: number | null; chunksTotal: number | null }
type Enrich = { running: boolean; done: number; total: number }

// Always-visible-while-running indicator pinned above the sidebar footer:
// a real progress bar once chunk/unit counts exist, an indeterminate shimmer
// before they do, and nothing at all once both sync and enrichment go idle —
// so "Sync now" stops feeling like it did nothing.
export default function SyncStatusBar() {
  const [ingest, setIngest] = useState<Ingest | null>(null)
  const [enrich, setEnrich] = useState<Enrich | null>(null)

  useEffect(() => {
    let alive = true
    async function poll() {
      try {
        const res = await fetch('/api/writeai/chat/sync', { cache: 'no-store' })
        if (!res.ok || !alive) return
        const data = await res.json()
        setIngest(data?.ingest?.running ? data.ingest : null)
        setEnrich(data?.enrich?.running ? data.enrich : null)
      } catch {
        /* WriteAI briefly unreachable — keep the last known state */
      }
    }
    poll()
    const id = setInterval(poll, POLL_MS)
    return () => {
      alive = false
      clearInterval(id)
    }
  }, [])

  const ingestRunning = ingest !== null
  const enrichRunning = enrich !== null
  const syncPhrase = usePhrase(SYNC_PHRASES, ingestRunning)
  const enrichPhrase = usePhrase(ENRICH_PHRASES, enrichRunning)

  if (!ingestRunning && !enrichRunning) return null

  const hasChunkProgress = Boolean(ingest && ingest.chunksTotal !== null && ingest.chunksTotal > 0)
  const ingestPct = hasChunkProgress
    ? Math.round((ingest!.chunksDone! / ingest!.chunksTotal!) * 100)
    : 0
  const enrichPct = enrich && enrich.total > 0 ? Math.round((enrich.done / enrich.total) * 100) : 0

  return (
    <div className="pb-3">
      {ingestRunning && (
        <div>
          <div className="flex items-center gap-1.5 text-[10px] font-medium text-ink-muted">
            <LuRefreshCw className="shrink-0 animate-spin text-accent" size={11} />
            <span key={syncPhrase} className="loom-phrase-in inline-block truncate">{syncPhrase}</span>
          </div>
          <div className="mt-1.5 h-1 overflow-hidden rounded-full bg-accent/10">
            {hasChunkProgress ? (
              <div
                className="relative h-full overflow-hidden rounded-full bg-accent transition-all duration-700"
                style={{ width: `${Math.max(ingestPct, 2)}%` }}
              >
                <div className="loom-sheen absolute inset-0 bg-gradient-to-r from-transparent via-white/40 to-transparent" />
              </div>
            ) : (
              <div className="loom-indeterminate h-full w-1/3 rounded-full bg-accent" />
            )}
          </div>
          {hasChunkProgress && (
            <p className="mt-1 text-center text-[10px] text-ink-faint">
              {ingest!.chunksDone}/{ingest!.chunksTotal} chunks · {ingestPct}%
            </p>
          )}
        </div>
      )}
      {enrichRunning && (
        <div className={ingestRunning ? 'mt-2.5' : undefined}>
          <div className="flex items-center gap-1.5 text-[10px] font-medium text-ink-muted">
            <LuSparkles className="shrink-0 text-accent" size={11} />
            <span key={enrichPhrase} className="loom-phrase-in inline-block truncate">{enrichPhrase}</span>
          </div>
          <div className="mt-1.5 h-1 overflow-hidden rounded-full bg-accent/10">
            <div
              className="relative h-full overflow-hidden rounded-full bg-accent transition-all duration-700"
              style={{ width: `${Math.max(enrichPct, 2)}%` }}
            >
              <div className="loom-sheen absolute inset-0 bg-gradient-to-r from-transparent via-white/40 to-transparent" />
            </div>
          </div>
          <p className="mt-1 text-center text-[10px] text-ink-faint">
            {enrich!.done}/{enrich!.total} · {enrichPct}%
          </p>
        </div>
      )}
    </div>
  )
}
