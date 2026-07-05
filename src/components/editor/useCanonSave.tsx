'use client'

import { useRef } from 'react'
import { notify, setNotificationBusy, setNotificationSaving } from '@/lib/notifications'

// ⌥⇧E "save canon to disk" — shared by the chapter editor and the book
// page. Fires the canon export endpoint, which renders the manuscript
// under default variable values and writes it to the book's folder under
// the configured root (Settings → Export). Progress and results surface
// through the header notification bell; repeat presses are swallowed
// while a save runs (the Pages round-trip takes a few seconds).

// "/Users/you/Writing/…" reads long in a notification; show "~/Writing/…".
function shortenHome(p: string): string {
  return p.replace(/^\/Users\/[^/]+/, '~')
}

export function useCanonSave(seriesId: string) {
  const busyRef = useRef(false)
  // A save requested while one is in flight (the Pages round trip takes
  // seconds; blur autosaves fire faster than that) is coalesced here and
  // run once the current save finishes — never silently dropped.
  const pendingRef = useRef<{ bookId: string; silent: boolean } | null>(null)

  async function saveCanon(bookId: string | undefined, silent = false) {
    if (!bookId) return
    if (busyRef.current) {
      // A loud request wins over a queued silent one, never the reverse.
      pendingRef.current = { bookId, silent: silent && (pendingRef.current?.silent ?? true) }
      return
    }
    busyRef.current = true
    setNotificationSaving(true)
    if (!silent) setNotificationBusy(true)
    try {
      const res = await fetch(`/api/series/${seriesId}/books/${bookId}/export/canon`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
        // Let a navigation-away autosave outlive the page (tab close, hard
        // reload); the tiny JSON body is well under keepalive's 64KB cap.
        keepalive: true,
      })
      const data = await res.json() as { ok?: boolean; path?: string; warnings?: string[]; error?: string }
      if (res.ok && data.ok) {
        if (!silent) {
          notify('ok', `Canon saved to ${shortenHome(data.path ?? '')}`)
          if (data.warnings?.length) console.info('Canon export warnings:', data.warnings)
        }
      } else {
        notify('error', data.error ? `Canon save failed. ${data.error}` : 'Canon save failed.')
      }
    } catch {
      notify('error', 'Canon save failed.')
    } finally {
      busyRef.current = false
      setNotificationSaving(false)
      if (!silent) setNotificationBusy(false)
      const pending = pendingRef.current
      pendingRef.current = null
      if (pending) void saveCanon(pending.bookId, pending.silent)
    }
  }

  return { saveCanon }
}
