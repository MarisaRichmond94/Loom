'use client'

import { useRef } from 'react'
import { notify, setNotificationBusy } from '@/lib/notifications'

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

  async function saveCanon(bookId: string | undefined, silent = false) {
    if (!bookId || busyRef.current) return
    busyRef.current = true
    if (!silent) setNotificationBusy(true)
    try {
      const res = await fetch(`/api/series/${seriesId}/books/${bookId}/export/canon`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      })
      const data = await res.json() as { ok?: boolean; path?: string; warnings?: string[]; error?: string }
      if (res.ok && data.ok) {
        if (!silent) {
          notify('ok', `Canon saved to ${shortenHome(data.path ?? '')}`)
          if (data.warnings?.length) console.info('Canon export warnings:', data.warnings)
        }
      } else {
        notify('error', 'Canon save failed.')
      }
    } catch {
      notify('error', 'Canon save failed.')
    } finally {
      busyRef.current = false
      if (!silent) setNotificationBusy(false)
    }
  }

  return { saveCanon }
}
