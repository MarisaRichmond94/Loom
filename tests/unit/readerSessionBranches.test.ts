/** @jest-environment jsdom */
import {
  getActiveReaderSessions,
  rememberReaderSession,
  forgetReaderSession,
} from '@/lib/readerProgress'

// LOOM-154, under LOOM-146. The store held ONE session id per series
// (`loom-session-<seriesId>`), so preserving a branch meant it had to hold
// several. Every assertion here is about not losing one: a dropped id is a
// reading position gone, with nothing to show it ever existed.

beforeEach(() => localStorage.clear())

describe('branch tracking', () => {
  it('keeps the previous session when a fork is remembered', () => {
    // The whole point. The old behaviour overwrote the single id.
    localStorage.setItem('loom-session-s1', 'sess-a')
    rememberReaderSession('s1', 'sess-b')

    const ids = getActiveReaderSessions().filter(x => x.seriesId === 's1').map(x => x.sessionId)
    expect(ids.sort()).toEqual(['sess-a', 'sess-b'])
  })

  it('makes the fork the active session', () => {
    localStorage.setItem('loom-session-s1', 'sess-a')
    rememberReaderSession('s1', 'sess-b')
    expect(localStorage.getItem('loom-session-s1')).toBe('sess-b')
  })

  it('reads a browser that predates branch tracking', () => {
    // Backwards compatibility is not cosmetic: rewriting the original key's
    // format would drop the resume pointer for every existing reader.
    localStorage.setItem('loom-session-s1', 'sess-old')
    expect(getActiveReaderSessions()).toEqual([{ seriesId: 's1', sessionId: 'sess-old' }])
  })

  it('does not mistake a branches key for a session key', () => {
    // 'loom-session-branches-s1' also starts with 'loom-session-', so a naive
    // prefix slice would yield the series id "branches-s1".
    rememberReaderSession('s1', 'sess-a')
    const seriesIds = getActiveReaderSessions().map(x => x.seriesId)
    expect(seriesIds.every(id => id === 's1')).toBe(true)
  })

  it('does not duplicate an id remembered twice', () => {
    rememberReaderSession('s1', 'sess-a')
    rememberReaderSession('s1', 'sess-a')
    expect(getActiveReaderSessions().filter(x => x.sessionId === 'sess-a')).toHaveLength(1)
  })

  it('keeps series separate', () => {
    rememberReaderSession('s1', 'sess-a')
    rememberReaderSession('s2', 'sess-b')
    expect(getActiveReaderSessions().sort((a, b) => a.seriesId.localeCompare(b.seriesId)))
      .toEqual([
        { seriesId: 's1', sessionId: 'sess-a' },
        { seriesId: 's2', sessionId: 'sess-b' },
      ])
  })
})

describe('forgetting one branch', () => {
  it('does not take its siblings with it', () => {
    // The common caller is the server pruning a deleted session. Dropping the
    // whole series there would undo the feature on the next page load.
    localStorage.setItem('loom-session-s1', 'sess-a')
    rememberReaderSession('s1', 'sess-b')
    forgetReaderSession('s1', 'sess-a')

    const ids = getActiveReaderSessions().filter(x => x.seriesId === 's1').map(x => x.sessionId)
    expect(ids).toEqual(['sess-b'])
  })

  it('promotes a survivor when the active branch is forgotten', () => {
    // Leaving the series with no active session would make "Start reading"
    // create a third one rather than resuming a branch that still exists.
    localStorage.setItem('loom-session-s1', 'sess-a')
    rememberReaderSession('s1', 'sess-b')
    expect(localStorage.getItem('loom-session-s1')).toBe('sess-b')

    forgetReaderSession('s1', 'sess-b')
    expect(localStorage.getItem('loom-session-s1')).toBe('sess-a')
  })

  it('clears the series when the last branch goes', () => {
    rememberReaderSession('s1', 'sess-a')
    forgetReaderSession('s1', 'sess-a')
    expect(getActiveReaderSessions()).toEqual([])
    expect(localStorage.getItem('loom-session-s1')).toBeNull()
  })

  it('drops the whole series when called without an id', () => {
    // The old single-session signature, still used by callers that mean it.
    rememberReaderSession('s1', 'sess-a')
    rememberReaderSession('s1', 'sess-b')
    forgetReaderSession('s1')
    expect(getActiveReaderSessions()).toEqual([])
  })
})
