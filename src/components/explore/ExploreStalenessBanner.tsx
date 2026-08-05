'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { LuTriangleAlert, LuRefreshCw } from 'react-icons/lu'

import { useCanonSave } from '@/components/editor/useCanonSave'

// "Answers may be behind your draft" (LOOM-117).
//
// Unlike the review panel, which passes the LIVE editor text, Explore answers
// strictly from the last ingest — so a scene written this morning is answered
// as though it does not exist. Confidently, and with no signal. To the writer
// that reads as the model being wrong about her own book; it is not, it is
// reading an older copy, and the tab has to say so.
//
// ── Two rules this banner obeys ─────────────────────────────────────────────
//
//  1. It NAMES the chapters. `GET /api/sync/status` returns them, so a vague
//     "may be out of date" would be throwing away information the endpoint
//     already handed over.
//
//  2. `manifest_found: false` is UNKNOWN, not stale. A book Loom has never
//     canon-exported has nothing to compare against; reporting that as drift
//     puts a warning on screen that carries no signal and cannot be cleared.
//     Handled server-side (`known`), and never rendered here.
//
// Nothing here syncs on its own. The banner informs; the writer decides, after
// seeing what it costs.

type SyncBook = {
  number: number
  title: string
  known: boolean
  behind: boolean
  missingChapters: number[]
  extraChapters: number[]
  exportedAt: string | null
}

type Preview = { book: number; chapters: number; costUsd: number | null }

function chapterList(nums: number[]): string {
  if (nums.length === 0) return ''
  if (nums.length <= 3) return nums.join(', ')
  return `${nums[0]}–${nums[nums.length - 1]}`
}

function ago(iso: string | null): string {
  if (!iso) return 'never'
  const then = new Date(iso)
  if (Number.isNaN(then.getTime())) return 'unknown'
  const hours = (Date.now() - then.getTime()) / 3_600_000
  if (hours < 1) return 'less than an hour ago'
  if (hours < 24) return `${Math.round(hours)}h ago`
  return `${Math.round(hours / 24)}d ago`
}

export default function ExploreStalenessBanner({
  seriesId, bookIdsInScope, bookNumbersInScope, onSynced,
}: {
  seriesId: string
  /** Loom book cuids currently selected — a stale book 5 is irrelevant to a
   *  question scoped to books 1-3. */
  bookIdsInScope: Map<number, string>
  bookNumbersInScope: number[]
  onSynced: () => void
}) {
  const [stale, setStale] = useState<SyncBook[]>([])
  const [lastSynced, setLastSynced] = useState<string | null>(null)
  const [preview, setPreview] = useState<Preview[] | null>(null)
  const [phase, setPhase] = useState<'idle' | 'previewing' | 'confirming' | 'syncing' | 'done'>('idle')
  const [note, setNote] = useState<string | null>(null)
  const pollRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  const { saveCanon } = useCanonSave(seriesId)

  const refresh = useCallback(async () => {
    try {
      const res = await fetch('/api/writeai/chat/sync')
      if (!res.ok) return
      const data = await res.json() as { books?: SyncBook[]; lastSynced?: string | null }
      const inScope = new Set(bookNumbersInScope)
      setStale((data.books ?? []).filter(b => b.known && b.behind && inScope.has(b.number)))
      setLastSynced(data.lastSynced ?? null)
    } catch {
      // WriteAI unreachable. The panel already says so; a second complaint
      // about staleness on top of it would be noise.
    }
  }, [bookNumbersInScope])

  useEffect(() => { void refresh() }, [refresh])
  useEffect(() => () => { if (pollRef.current) clearTimeout(pollRef.current) }, [])

  async function askPreview() {
    setPhase('previewing')
    setNote(null)
    try {
      const results: Preview[] = []
      for (const b of stale) {
        const res = await fetch(`/api/writeai/chat/sync?preview=${b.number}`)
        if (!res.ok) continue
        const d = await res.json() as {
          changed_chunks?: number
          estimated_cost_usd?: number
          plan?: { book?: number; new?: number; updated?: number }[]
        }
        const row = d.plan?.find(p => p.book === b.number)
        results.push({
          book: b.number,
          chapters: (row?.new ?? 0) + (row?.updated ?? 0),
          costUsd: d.estimated_cost_usd ?? null,
        })
      }
      setPreview(results)
      setPhase('confirming')
    } catch {
      setNote('Could not estimate the sync.')
      setPhase('idle')
    }
  }

  async function runSync() {
    setPhase('syncing')
    setNote(null)
    try {
      for (const b of stale) {
        const bookId = bookIdsInScope.get(b.number)
        // Export FIRST. Re-ingesting without exporting just re-reads the same
        // stale files and the banner comes straight back — the export is what
        // makes the resync real.
        if (bookId) await saveCanon(bookId, true)

        const res = await fetch('/api/writeai/chat/sync', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ book: b.number }),
        })
        if (res.status === 409) {
          setNote('A sync is already running. It will finish on its own.')
          break
        }
        if (!res.ok) {
          setNote('The sync could not be started.')
          setPhase('idle')
          return
        }
        // One at a time: WriteAI refuses concurrent ingests (they contend on
        // the same SQLite database), so this must be sequential, not a fan-out.
        await waitForIdle()
      }
      setPhase('done')
      await refresh()
      onSynced()
    } catch {
      setNote('The sync did not finish.')
      setPhase('idle')
    }
  }

  function waitForIdle(): Promise<void> {
    return new Promise(resolve => {
      const tick = async () => {
        try {
          const res = await fetch('/api/writeai/chat/sync')
          const d = await res.json() as { ingest?: { running?: boolean } }
          if (!d.ingest?.running) return resolve()
        } catch {
          return resolve()
        }
        pollRef.current = setTimeout(tick, 3000)
      }
      pollRef.current = setTimeout(tick, 2000)
    })
  }

  if (stale.length === 0) return null

  const totalCost = preview?.reduce((sum, p) => sum + (p.costUsd ?? 0), 0) ?? null
  const totalChapters = preview?.reduce((sum, p) => sum + p.chapters, 0) ?? 0

  return (
    <div className="mx-4 mt-3 flex flex-wrap items-center gap-3 rounded-lg border border-choice-amber-border bg-choice-amber-bg px-3 py-2 text-[12.5px] text-choice-amber">
      <LuTriangleAlert size={13} className="shrink-0" />

      <div className="min-w-0 flex-1">
        {phase === 'confirming' && preview ? (
          <span>
            <strong className="font-semibold">Sync {totalChapters} chapter{totalChapters === 1 ? '' : 's'}?</strong>{' '}
            {totalCost !== null && totalCost > 0
              ? `Estimated cost ~$${totalCost.toFixed(2)}.`
              : 'No extraction cost — nothing new to analyse.'}
          </span>
        ) : phase === 'syncing' ? (
          <span>Syncing… this runs one book at a time and can take a few minutes.</span>
        ) : phase === 'done' ? (
          <span>Synced. New questions will use the updated index.</span>
        ) : (
          <span>
            <strong className="font-semibold">Answers may be behind your draft.</strong>{' '}
            {stale.map(b => {
              const missing = chapterList(b.missingChapters)
              return missing
                ? `${b.title}: chapter${b.missingChapters.length === 1 ? '' : 's'} ${missing} not indexed. `
                : `${b.title} has changed since the last sync. `
            })}
            Last synced {ago(lastSynced)}.
          </span>
        )}
        {note && <span className="ml-1 opacity-80">{note}</span>}
      </div>

      {phase === 'idle' && (
        <button
          type="button"
          onClick={askPreview}
          className="shrink-0 rounded-md border border-choice-amber-border px-2.5 py-1 text-[11.5px] font-medium transition-colors hover:brightness-110"
        >
          Sync now
        </button>
      )}
      {phase === 'previewing' && (
        <span className="shrink-0 text-[11.5px] opacity-80">Estimating…</span>
      )}
      {phase === 'confirming' && (
        <span className="flex shrink-0 gap-1.5">
          <button
            type="button"
            onClick={() => { setPhase('idle'); setPreview(null) }}
            className="rounded-md px-2 py-1 text-[11.5px] opacity-70 transition-opacity hover:opacity-100"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={runSync}
            className="flex items-center gap-1 rounded-md border border-choice-amber-border px-2.5 py-1 text-[11.5px] font-medium transition-colors hover:brightness-110"
          >
            <LuRefreshCw size={10} /> Export &amp; sync
          </button>
        </span>
      )}
      {phase === 'syncing' && (
        <LuRefreshCw size={12} className="shrink-0 animate-spin" />
      )}
    </div>
  )
}
