// localStorage helpers for the reader's per-browser state. Loom has no
// user accounts yet, so these intentionally live client-side and resync
// across tabs via the `storage` event when needed (see useStarredSeries).

const STARRED_SERIES_KEY = 'loom-starred-series'
const SESSION_KEY_PREFIX = 'loom-session-'

function readJSONArray(key: string): string[] {
  if (typeof window === 'undefined') return []
  try {
    const v = JSON.parse(localStorage.getItem(key) ?? '[]')
    return Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : []
  } catch { return [] }
}

// ----- Starred series -----

export function getStarredSeries(): string[] {
  return readJSONArray(STARRED_SERIES_KEY)
}

export function setStarredSeries(ids: string[]): void {
  if (typeof window === 'undefined') return
  localStorage.setItem(STARRED_SERIES_KEY, JSON.stringify(ids))
}

export function isSeriesStarred(id: string): boolean {
  return getStarredSeries().includes(id)
}

// Returns the new starred list after toggling so callers can update local
// state in one synchronous step without re-reading from storage.
export function toggleStarredSeries(id: string): string[] {
  const current = getStarredSeries()
  const next = current.includes(id) ? current.filter(x => x !== id) : [...current, id]
  setStarredSeries(next)
  return next
}

// ----- Active reader sessions -----

// Walks localStorage and returns every (seriesId, sessionId) pair the
// browser has cached from previous "Start reading" clicks. Used by the
// Continue reading section on Explore to discover what to surface.
export function getActiveReaderSessions(): Array<{ seriesId: string; sessionId: string }> {
  if (typeof window === 'undefined') return []
  const out: Array<{ seriesId: string; sessionId: string }> = []
  for (let i = 0; i < localStorage.length; i++) {
    const key = localStorage.key(i)
    if (!key || !key.startsWith(SESSION_KEY_PREFIX)) continue
    const seriesId = key.slice(SESSION_KEY_PREFIX.length)
    const sessionId = localStorage.getItem(key)
    if (sessionId) out.push({ seriesId, sessionId })
  }
  return out
}

// Drop a session from the resume index (e.g., when the server says it's
// 404; or in the future, when the reader hits a "Stop tracking this"
// action on a Continue reading card).
export function forgetReaderSession(seriesId: string): void {
  if (typeof window === 'undefined') return
  localStorage.removeItem(`${SESSION_KEY_PREFIX}${seriesId}`)
}
