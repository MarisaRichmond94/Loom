'use client'

import type { ExploreBook, ExplorePov } from './types'

// Shared cache behind ExplorePanel's scope read, so a page-level idle
// prefetch and the Explore tab's own mount land on the SAME in-flight
// request instead of firing the GET twice.
//
// This is the ONE request ExplorePanel's own comment marks safe to fire
// before the writer opens the tab — a pure sqlite read, no `_build_bible`
// cost, no chat warm-up. Nothing else about Explore should be prefetched.

export type ScopePayload = {
  status: 'ok' | 'not-analyzed'
  books?: ExploreBook[]
  povs?: ExplorePov[]
  lastSynced?: string | null
}

export type ScopeState = 'loading' | 'ready' | 'not-analyzed' | 'offline' | 'error'

export type ScopeResult = { state: ScopeState; data: ScopePayload | null }

const cache = new Map<string, Promise<ScopeResult>>()

function key(seriesId: string, bookId: string | null) {
  return `${seriesId}:${bookId ?? ''}`
}

async function fetchScope(seriesId: string, bookId: string | null): Promise<ScopeResult> {
  const params = new URLSearchParams({ seriesId })
  if (bookId) params.set('bookId', bookId)
  try {
    const res = await fetch(`/api/writeai/chat/scope?${params}`)
    if (res.status === 503) return { state: 'offline', data: null }
    if (!res.ok) return { state: 'error', data: null }
    const data = (await res.json()) as ScopePayload
    if (data.status === 'not-analyzed') return { state: 'not-analyzed', data: null }
    return { state: 'ready', data }
  } catch {
    return { state: 'error', data: null }
  }
}

/** Starts (or reuses) the scope fetch for this series/book pair, caching the
 *  in-flight promise so a prefetch and the Explore tab's own mount never
 *  double-request. */
export function prefetchScope(seriesId: string, bookId: string | null) {
  const k = key(seriesId, bookId)
  const existing = cache.get(k)
  if (existing) return existing
  const promise = fetchScope(seriesId, bookId)
  cache.set(k, promise)
  return promise
}
