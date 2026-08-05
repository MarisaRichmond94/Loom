'use client'

import type { SeriesWriterCharacter } from '@/lib/writerCharacterSeries'

// Shared cache behind SeriesCharactersSection, so a page-level idle prefetch
// and the Characters tab's own mount land on the SAME in-flight request
// instead of firing the GET twice.

const cache = new Map<string, Promise<SeriesWriterCharacter[] | null>>()
// Resolved values alongside the in-flight promises, so a component can read
// a synchronous answer for its OWN first render (a lazy useState initializer)
// instead of always mounting empty and waiting for an effect — that empty
// first paint, even when the effect resolves near-instantly off an already-
// warm cache, is what produced the tab-switch flash.
const resolved = new Map<string, SeriesWriterCharacter[] | null>()

async function fetchSeriesCharacters(seriesId: string): Promise<SeriesWriterCharacter[] | null> {
  try {
    const res = await fetch(`/api/series/${seriesId}/writer-characters`)
    if (!res.ok) return null
    return await res.json()
  } catch {
    return null
  }
}

/** Starts (or reuses) the fetch for this series, caching the in-flight
 *  promise so a prefetch and the Characters tab's own mount never
 *  double-request. */
export function prefetchSeriesCharacters(seriesId: string) {
  const existing = cache.get(seriesId)
  if (existing) return existing
  const promise = fetchSeriesCharacters(seriesId).then(result => {
    resolved.set(seriesId, result)
    return result
  })
  cache.set(seriesId, promise)
  return promise
}

/** Synchronous read of whatever `prefetchSeriesCharacters` has already
 *  resolved for this series, or undefined if nothing has landed yet. */
export function getCachedSeriesCharacters(seriesId: string): SeriesWriterCharacter[] | null | undefined {
  return resolved.get(seriesId)
}
