'use client'

import type { OutlineCard } from '@/lib/writerOutline'

// Shared cache behind useBookOutline (LOOM-96), so a page-level idle prefetch
// and the Outline tab's own mount can land on the SAME in-flight request
// instead of firing the GET twice.
//
// ⚠️ Same write-on-read caveat as before: WriteAI's `get_outline` seeds a
// missing outline from canon and saves, all on a GET. Prefetching earlier
// does not add a request that would not have happened anyway — it only moves
// the existing one off the tab click, onto page-idle instead.

export type OutlineSyncState = 'synced' | 'behind' | 'unknown'

export type BookOutline = {
  cards: OutlineCard[]
  /** WriteAI returns this as `sync_state`; normalised here so the component
   *  never has to know which side of the seam it came from. */
  syncState: OutlineSyncState
}

export type OutlineReason = 'book-not-in-writeai' | 'writeai-unavailable'

export type OutlineResult = {
  outline: BookOutline | null
  reason: OutlineReason | null
}

const cache = new Map<string, Promise<OutlineResult>>()

function key(seriesId: string, bookId: string) {
  return `${seriesId}:${bookId}`
}

async function fetchOutline(seriesId: string, bookId: string): Promise<OutlineResult> {
  try {
    const res = await fetch(`/api/writeai/outline?seriesId=${seriesId}&bookId=${bookId}`)
    const data = await res.json().catch(() => null)

    if (!res.ok) return { outline: null, reason: 'writeai-unavailable' }
    // The proxy answers "WriteAI has never ingested this book" at 200 with a
    // reason, because it is a state rather than a failure.
    if (!data?.outline) {
      return {
        outline: null,
        reason: data?.reason === 'book-not-in-writeai' ? 'book-not-in-writeai' : 'writeai-unavailable',
      }
    }

    const cards: OutlineCard[] = Array.isArray(data.outline.chapters) ? data.outline.chapters : []
    return {
      outline: {
        // Position, not array order: the store is a list WriteAI appends to,
        // so a card added between two others arrives last and sorts into
        // place here.
        cards: [...cards].sort((a, b) => a.position - b.position),
        syncState: data.outline.sync_state ?? 'unknown',
      },
      reason: null,
    }
  } catch {
    return { outline: null, reason: 'writeai-unavailable' }
  }
}

/** Starts (or reuses) the fetch for this book, caching the in-flight promise
 *  so a prefetch and the Outline tab's own mount never double-request. */
export function prefetchBookOutline(seriesId: string, bookId: string) {
  const k = key(seriesId, bookId)
  const existing = cache.get(k)
  if (existing) return existing
  const promise = fetchOutline(seriesId, bookId)
  cache.set(k, promise)
  return promise
}

/** Drops the cached entry so the next read is a genuine fetch. Call after any
 *  mutation — the cache exists to avoid a redundant read on mount, not to
 *  serve stale data back after a save. */
export function invalidateOutlineCache(seriesId: string, bookId: string) {
  cache.delete(key(seriesId, bookId))
}
