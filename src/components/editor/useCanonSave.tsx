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
  // Autosave preference (Settings → Export), read lazily and remembered.
  // Structural saves respect it for the same reason blur saves do: with
  // autosave off, nothing may write to the writer's folder unprompted.
  const autosaveRef = useRef<boolean | null>(null)
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
        if (data.error) console.error('Canon save failed:', data.error)
        notify('error', 'Save failed…')
      }
    } catch (err) {
      console.error('Canon save failed:', err)
      notify('error', 'Save failed…')
    } finally {
      busyRef.current = false
      setNotificationSaving(false)
      if (!silent) setNotificationBusy(false)
      const pending = pendingRef.current
      pendingRef.current = null
      if (pending) void saveCanon(pending.bookId, pending.silent)
    }
  }

  // Renumbering the manuscript is a change to it that no keystroke will
  // follow. Creation navigates you into an empty chapter, so the blur autosave
  // has nothing to fire on; a drag in the outline tree alters no prose at all;
  // renaming a chapter or toggling `numbered` leaves the caret where it was.
  // Without this, the manifest on disk kept describing the OLD numbering until
  // the next time the writer typed somewhere, and WriteAI stayed confidently
  // wrong in the meantime.
  //
  // Call it for anything that changes which chapter a NUMBER means:
  //
  //   * add / insert                    layout.tsx
  //   * reorder (drag)                  OutlineTree.tsx
  //   * rename, and the numbered toggle chapter/[chapterId]/page.tsx
  //
  // Canonising a bonus chapter is the last of those, and it is the one that
  // showed the cost of missing a caller: enrichment that ran while the manifest
  // lagged stamped fresh summaries with the identities of the chapters they had
  // displaced, and no resync could undo it (LOOM-98/99).
  //
  // Deleting a chapter and ⌥⇧N are deliberately NOT in that list: both navigate
  // away from the editor, so the unmount autosave already covers them.
  //
  // Safe to fire on an empty chapter: a heading with no prose produces no
  // chunks downstream, so the export costs nothing but lands the renumbering.
  async function saveCanonAfterStructuralChange(bookId: string | undefined) {
    if (!bookId) return
    if (autosaveRef.current === null) {
      autosaveRef.current = await fetch('/api/settings/canon-export')
        .then(r => r.ok ? r.json() : null)
        .then((s: { autosave?: boolean } | null) => s?.autosave !== false)
        .catch(() => false)   // can't read the preference — don't write to disk
    }
    if (!autosaveRef.current) return
    await saveCanon(bookId, true)
  }

  return { saveCanon, saveCanonAfterStructuralChange }
}
