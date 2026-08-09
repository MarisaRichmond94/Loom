'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { LuTriangleAlert, LuRefreshCw } from 'react-icons/lu'

import { useCanonSave } from '@/components/editor/useCanonSave'
import type { OutlineSyncState } from '@/components/editor/outlineCache'

// The Outline tab's counterpart to ExploreStalenessBanner (LOOM-117): same
// problem, scoped to one book instead of a selection. WriteAI's outline read
// runs its own auto-reconcile off the last ingest, so a chapter finished this
// morning can leave the board out of step with the manuscript — silently,
// unless this says so. Before this, the tab only showed a small pill with a
// hover tooltip; this gives it the same detail-plus-action shape Explore has.
//
// `behind` and `unknown` are different failures and get different banners:
//
//  - `behind`: WriteAI just hasn't ingested the latest chapters yet. Same
//    preview → confirm → sync flow as Explore, scoped to this one book.
//  - `unknown`: WriteAI cannot read the book's manifest at all, so its
//    reconcile is INERT rather than late — no amount of syncing content fixes
//    it. There is nothing to preview; exporting canon IS the fix, so this
//    skips straight to the action.

type SyncBook = {
  book?: number
  known?: boolean
  behind?: boolean
  missingChapters: number[]
  exportedAt: string | null
}

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

export default function OutlineStalenessBanner({
  seriesId, bookId, writeaiNumber, syncState, onSynced,
}: {
  seriesId: string
  bookId: string
  writeaiNumber: number
  syncState: OutlineSyncState
  onSynced: () => void
}) {
  const { saveCanon } = useCanonSave(seriesId)
  const [detail, setDetail] = useState<SyncBook | null>(null)
  const [preview, setPreview] = useState<{ chapters: number; costUsd: number | null } | null>(null)
  const [phase, setPhase] =
    useState<'idle' | 'previewing' | 'confirming' | 'syncing' | 'exporting' | 'done'>('idle')
  const [note, setNote] = useState<string | null>(null)
  const pollRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  const refresh = useCallback(async () => {
    try {
      const res = await fetch('/api/writeai/chat/sync')
      if (!res.ok) return
      const data = await res.json() as { books?: SyncBook[] }
      setDetail((data.books ?? []).find(b => b.book === writeaiNumber) ?? null)
    } catch {
      // Unreachable — the pill's cause (`sync_state`) already came from the
      // outline read itself, so this only ever adds detail on top of it.
    }
  }, [writeaiNumber])

  useEffect(() => { if (syncState === 'behind') void refresh() }, [syncState, refresh])
  useEffect(() => () => { if (pollRef.current) clearTimeout(pollRef.current) }, [])

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

  async function askPreview() {
    setPhase('previewing')
    setNote(null)
    try {
      const res = await fetch(`/api/writeai/chat/sync?preview=${writeaiNumber}`)
      if (!res.ok) throw new Error('preview failed')
      const d = await res.json() as {
        estimated_cost_usd?: number
        plan?: { book?: number; new?: number; updated?: number }[]
      }
      const row = d.plan?.find(p => p.book === writeaiNumber)
      setPreview({ chapters: (row?.new ?? 0) + (row?.updated ?? 0), costUsd: d.estimated_cost_usd ?? null })
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
      // Export FIRST. Re-ingesting without exporting just re-reads the same
      // stale files and the banner comes straight back.
      await saveCanon(bookId, true)

      const res = await fetch('/api/writeai/chat/sync', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ book: writeaiNumber }),
      })
      if (res.status === 409) {
        setNote('A sync is already running. It will finish on its own.')
        setPhase('idle')
        return
      }
      if (!res.ok) {
        setNote('The sync could not be started.')
        setPhase('idle')
        return
      }
      await waitForIdle()
      setPhase('done')
      onSynced()
    } catch {
      setNote('The sync did not finish.')
      setPhase('idle')
    }
  }

  async function exportCanon() {
    setPhase('exporting')
    setNote(null)
    try {
      await saveCanon(bookId, true)
      setPhase('done')
      onSynced()
    } catch {
      setNote('The export did not finish.')
      setPhase('idle')
    }
  }

  if (syncState === 'unknown') {
    return (
      <div className="mt-3 flex flex-wrap items-center gap-3 rounded-lg border border-choice-kill/30 bg-choice-kill/10 px-4 py-2.5 text-sm text-choice-kill">
        <LuTriangleAlert size={15} className="shrink-0" />
        <div className="min-w-0 flex-1">
          {phase === 'exporting' ? (
            <span>Exporting…</span>
          ) : phase === 'done' ? (
            <span>Exported. WriteAI will pick up the manifest on its next read.</span>
          ) : (
            <span>
              <strong className="font-semibold">Chapter numbering isn’t syncing.</strong>{' '}
              WriteAI can’t read this book’s manifest, so it can’t correct card numbers as chapters
              move. Export the canon manuscript to restore it.
            </span>
          )}
          {note && <span className="ml-1 opacity-80">{note}</span>}
        </div>
        {phase === 'idle' && (
          <button
            type="button"
            onClick={exportCanon}
            className="shrink-0 rounded-md border border-choice-kill/30 px-2.5 py-1 text-xs font-medium transition-colors hover:brightness-110"
          >
            Export canon
          </button>
        )}
        {phase === 'exporting' && <LuRefreshCw size={13} className="shrink-0 animate-spin" />}
      </div>
    )
  }

  return (
    <div className="flex flex-wrap items-center gap-3 rounded-lg border border-choice-amber-border bg-choice-amber-bg px-4 py-2.5 text-sm text-choice-amber">
      <LuTriangleAlert size={15} className="shrink-0" />

      <div className="min-w-0 flex-1">
        {phase === 'confirming' && preview ? (
          <span>
            <strong className="font-semibold">
              Sync {preview.chapters} chapter{preview.chapters === 1 ? '' : 's'}?
            </strong>{' '}
            {preview.costUsd !== null && preview.costUsd > 0
              ? `Estimated cost ~$${preview.costUsd.toFixed(2)}.`
              : 'No extraction cost — nothing new to analyse.'}
          </span>
        ) : phase === 'syncing' ? (
          <span>Syncing… this can take a few minutes.</span>
        ) : phase === 'done' ? (
          <span>Synced. The board now reflects the last export.</span>
        ) : (
          <span>
            <strong className="font-semibold">This outline may be behind your draft.</strong>{' '}
            {detail?.missingChapters?.length
              ? `Chapter${detail.missingChapters.length === 1 ? '' : 's'} ${chapterList(detail.missingChapters)} not indexed. `
              : 'Chapters have changed since the last sync. '}
            Last synced {ago(detail?.exportedAt ?? null)}.
          </span>
        )}
        {note && <span className="ml-1 opacity-80">{note}</span>}
      </div>

      {phase === 'idle' && (
        <button
          type="button"
          onClick={askPreview}
          className="shrink-0 rounded-md border border-choice-amber-border px-2.5 py-1 text-xs font-medium transition-colors hover:brightness-110"
        >
          Sync now
        </button>
      )}
      {phase === 'previewing' && (
        <span className="shrink-0 text-xs opacity-80">Estimating…</span>
      )}
      {phase === 'confirming' && (
        <span className="flex shrink-0 gap-1.5">
          <button
            type="button"
            onClick={() => { setPhase('idle'); setPreview(null) }}
            className="rounded-md px-2 py-1 text-xs opacity-70 transition-opacity hover:opacity-100"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={runSync}
            className="flex items-center gap-1 rounded-md border border-choice-amber-border px-2.5 py-1 text-xs font-medium transition-colors hover:brightness-110"
          >
            <LuRefreshCw size={11} /> Export &amp; sync
          </button>
        </span>
      )}
      {phase === 'syncing' && (
        <LuRefreshCw size={13} className="shrink-0 animate-spin" />
      )}
    </div>
  )
}
