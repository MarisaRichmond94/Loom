// localStorage helpers for the reader's per-browser state. Loom has no
// user accounts yet, so these intentionally live client-side and resync
// across tabs via the `storage` event when needed (see useStarredSeries).

const STARRED_SERIES_KEY = 'loom-starred-series'
const FOLLOWED_AUTHORS_KEY = 'loom-followed-authors'
const SESSION_KEY_PREFIX = 'loom-session-'
// Every session for a series, not just the active one (LOOM-154).
//
// The key above holds ONE id per series and still does — it is what
// "Start reading" resumes into, and rewriting its format would drop the resume
// pointer for every reader who already has one. Branches are tracked alongside
// it instead, so an old browser with only the original key keeps working and
// simply has one branch.
const SESSION_BRANCHES_KEY_PREFIX = 'loom-session-branches-'

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

// ----- Followed authors -----
// Keyed by display name (pseudonym when active, real name otherwise) since
// Loom doesn't have author IDs yet. When multi-author lands this will swap
// to stable identifiers without changing the call sites.

export function getFollowedAuthors(): string[] {
  return readJSONArray(FOLLOWED_AUTHORS_KEY)
}

export function setFollowedAuthors(names: string[]): void {
  if (typeof window === 'undefined') return
  localStorage.setItem(FOLLOWED_AUTHORS_KEY, JSON.stringify(names))
}

export function isAuthorFollowed(name: string): boolean {
  return getFollowedAuthors().includes(name)
}

export function toggleFollowedAuthor(name: string): string[] {
  const current = getFollowedAuthors()
  const next = current.includes(name) ? current.filter(x => x !== name) : [...current, name]
  setFollowedAuthors(next)
  return next
}

// ----- Active reader sessions -----

// Walks localStorage and returns every (seriesId, sessionId) pair the
// browser has cached from previous "Start reading" clicks. Used by the
// Continue reading section on Explore to discover what to surface.
export function getActiveReaderSessions(): Array<{ seriesId: string; sessionId: string }> {
  if (typeof window === 'undefined') return []
  const bySeries = new Map<string, Set<string>>()
  const add = (seriesId: string, sessionId: string) => {
    const set = bySeries.get(seriesId) ?? new Set<string>()
    set.add(sessionId)
    bySeries.set(seriesId, set)
  }

  for (let i = 0; i < localStorage.length; i++) {
    const key = localStorage.key(i)
    if (!key) continue
    // Branches first — the prefix check below would also match these keys,
    // and slicing the shorter prefix off one would yield a bogus series id.
    if (key.startsWith(SESSION_BRANCHES_KEY_PREFIX)) {
      const seriesId = key.slice(SESSION_BRANCHES_KEY_PREFIX.length)
      for (const id of readJSONArray(key)) add(seriesId, id)
      continue
    }
    if (!key.startsWith(SESSION_KEY_PREFIX)) continue
    const seriesId = key.slice(SESSION_KEY_PREFIX.length)
    const sessionId = localStorage.getItem(key)
    if (sessionId) add(seriesId, sessionId)
  }

  return [...bySeries].flatMap(([seriesId, ids]) =>
    [...ids].map(sessionId => ({ seriesId, sessionId })),
  )
}

/**
 * Remember a session as a branch of a series, and make it the active one
 * (LOOM-154).
 *
 * Called when a rewind forks: the branch being left stays in the branch list
 * and keeps appearing in Continue Reading, which is the entire point — the
 * previous behaviour overwrote the one id and lost it.
 */
export function rememberReaderSession(seriesId: string, sessionId: string): void {
  if (typeof window === 'undefined') return
  const branchesKey = `${SESSION_BRANCHES_KEY_PREFIX}${seriesId}`
  const existing = readJSONArray(branchesKey)
  // The previously-active id may predate branch tracking, so fold it in rather
  // than assuming the branch list already knows about it.
  const active = localStorage.getItem(`${SESSION_KEY_PREFIX}${seriesId}`)
  const next = [...new Set([...existing, ...(active ? [active] : []), sessionId])]
  localStorage.setItem(branchesKey, JSON.stringify(next))
  localStorage.setItem(`${SESSION_KEY_PREFIX}${seriesId}`, sessionId)
}

// Drop a session from the resume index (e.g., when the server says it's
// 404; or in the future, when the reader hits a "Stop tracking this"
// action on a Continue reading card).
export function forgetReaderSession(seriesId: string, sessionId?: string): void {
  if (typeof window === 'undefined') return
  const branchesKey = `${SESSION_BRANCHES_KEY_PREFIX}${seriesId}`

  // Without an id this drops the series entirely, which is what the old
  // single-session callers mean.
  if (!sessionId) {
    localStorage.removeItem(`${SESSION_KEY_PREFIX}${seriesId}`)
    localStorage.removeItem(branchesKey)
    return
  }

  // One dead branch must not take its siblings with it — the server pruning a
  // deleted session is the common caller, and losing the other branches to it
  // would undo the whole feature.
  const remaining = readJSONArray(branchesKey).filter(id => id !== sessionId)
  if (remaining.length > 0) localStorage.setItem(branchesKey, JSON.stringify(remaining))
  else localStorage.removeItem(branchesKey)

  if (localStorage.getItem(`${SESSION_KEY_PREFIX}${seriesId}`) === sessionId) {
    // Promote a surviving branch rather than leaving the series with no active
    // session, which would make "Start reading" create a third one.
    if (remaining[0]) localStorage.setItem(`${SESSION_KEY_PREFIX}${seriesId}`, remaining[0])
    else localStorage.removeItem(`${SESSION_KEY_PREFIX}${seriesId}`)
  }
}
