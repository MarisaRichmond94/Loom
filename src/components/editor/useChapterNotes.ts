'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { notify } from '@/lib/notifications'

// Matches BlockEditor's prose debounce so notes and prose settle on the same
// rhythm — a writer switching between the two sees one consistent lag.
const SAVE_DEBOUNCE_MS = 600

/**
 * Write-behind persistence for one chapter's notes.
 *
 * Notes are not prose, so this deliberately stays out of proseSync: find &
 * replace only ever walks ContentBlock rows, so it can neither read stale
 * notes nor overwrite them, and nothing here needs to flush before it runs.
 *
 * What it does share with BlockEditor is the durability contract:
 *   - every keystroke immediately records a pending body, so the text to save
 *     never lives only in React state
 *   - saves are chained, never concurrent, so a slow PATCH can't land after a
 *     newer one and resurrect old text
 *   - a save is flushed on chapter switch, on unmount, and when the tab is
 *     hidden; the pending body carries its own chapterId so a flush racing a
 *     navigation still writes to the chapter the words were typed in
 *   - failures raise a toast rather than disappearing
 */
export function useChapterNotes(chapterId: string, onHasNotesChange?: (hasNotes: boolean) => void) {
  const [notes, setNotesState] = useState('')
  const [saving, setSaving] = useState(false)

  const pendingRef = useRef<{ chapterId: string; body: string } | null>(null)
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const chainRef = useRef<Promise<void>>(Promise.resolve())
  const chapterIdRef = useRef(chapterId)
  // Set on the first keystroke for this chapter. Guards an in-flight load from
  // overwriting words typed before it came back.
  const touchedRef = useRef(false)
  const onHasNotesChangeRef = useRef(onHasNotesChange)
  onHasNotesChangeRef.current = onHasNotesChange
  // What the sidebar's dot last reflects for this chapter, so a save only
  // fires the callback (and its series refetch) on an empty<->non-empty
  // transition rather than on every keystroke's debounced save.
  const lastNotifiedHasNotesRef = useRef<boolean | null>(null)

  const send = useCallback(() => {
    const pending = pendingRef.current
    if (!pending) return chainRef.current
    pendingRef.current = null
    setSaving(true)
    chainRef.current = chainRef.current.then(async () => {
      try {
        const res = await fetch(`/api/chapters/${pending.chapterId}/notes`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ body: pending.body }),
        })
        if (!res.ok) throw new Error(String(res.status))
        const nowHasNotes = pending.body.trim().length > 0
        if (lastNotifiedHasNotesRef.current !== nowHasNotes) {
          lastNotifiedHasNotesRef.current = nowHasNotes
          onHasNotesChangeRef.current?.(nowHasNotes)
        }
      } catch {
        notify('error', "Couldn't save this chapter's notes. The text is still on screen — copy it somewhere safe if this keeps happening.")
      } finally {
        // Only the last save in the chain clears the indicator; a newer
        // keystroke has already re-armed it.
        if (!pendingRef.current) setSaving(false)
      }
    })
    return chainRef.current
  }, [])

  const flush = useCallback(async () => {
    if (timerRef.current) {
      clearTimeout(timerRef.current)
      timerRef.current = null
    }
    send()
    await chainRef.current
  }, [send])

  const flushRef = useRef(flush)
  flushRef.current = flush

  const setNotes = useCallback((next: string) => {
    touchedRef.current = true
    setNotesState(next)
    // Recorded before the debounce, so an unload or a crash mid-timer still
    // has something concrete to hand off.
    pendingRef.current = { chapterId: chapterIdRef.current, body: next }
    if (timerRef.current) clearTimeout(timerRef.current)
    timerRef.current = setTimeout(() => {
      timerRef.current = null
      send()
    }, SAVE_DEBOUNCE_MS)
  }, [send])

  // Declared before the load effect so its cleanup flushes the outgoing
  // chapter's note before the incoming chapter's fetch is set up.
  useEffect(() => () => { void flushRef.current() }, [chapterId])

  useEffect(() => {
    chapterIdRef.current = chapterId
    touchedRef.current = false
    lastNotifiedHasNotesRef.current = null
    let cancelled = false
    setNotesState('')
    fetch(`/api/chapters/${chapterId}/notes`)
      .then(r => (r.ok ? r.json() : { body: '' }))
      .then((data: { body?: string }) => {
        if (cancelled || touchedRef.current) return
        setNotesState(data.body ?? '')
        lastNotifiedHasNotesRef.current = (data.body ?? '').trim().length > 0
      })
      .catch(() => { /* offline — the box stays empty and typing still saves */ })
    return () => { cancelled = true }
  }, [chapterId])

  useEffect(() => {
    function onVisibilityChange() {
      if (document.visibilityState === 'hidden') void flushRef.current()
    }
    function onBeforeUnload() {
      const pending = pendingRef.current
      if (!pending) return
      // The tab is going away and a normal fetch would be cancelled in flight,
      // so hand the last note to the browser to deliver. Beacons are POST-only,
      // which is why the notes route accepts POST alongside PUT.
      pendingRef.current = null
      navigator.sendBeacon(
        `/api/chapters/${pending.chapterId}/notes`,
        new Blob([JSON.stringify({ body: pending.body })], { type: 'application/json' }),
      )
    }
    document.addEventListener('visibilitychange', onVisibilityChange)
    window.addEventListener('beforeunload', onBeforeUnload)
    return () => {
      document.removeEventListener('visibilitychange', onVisibilityChange)
      window.removeEventListener('beforeunload', onBeforeUnload)
    }
  }, [])

  return { notes, setNotes, saving, hasNotes: notes.trim().length > 0, flush }
}
