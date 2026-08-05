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
// Resolved values alongside the in-flight promises, so a component can read
// a synchronous answer for its OWN first render (a lazy useState initializer)
// instead of always mounting empty and waiting for an effect — that empty
// first paint, even when the effect resolves near-instantly off an already-
// warm cache, is what produced the tab-switch flash.
const resolved = new Map<string, ScopeResult>()

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
  const promise = fetchScope(seriesId, bookId).then(result => {
    resolved.set(k, result)
    return result
  })
  cache.set(k, promise)
  return promise
}

/** Synchronous read of whatever `prefetchScope` has already resolved for
 *  this pair, or undefined if nothing has landed yet. */
export function getCachedScope(seriesId: string, bookId: string | null): ScopeResult | undefined {
  return resolved.get(key(seriesId, bookId))
}
