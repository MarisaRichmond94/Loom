'use client'

import { useEffect, useRef } from 'react'

/**
 * Records the reader's position while they read (LOOM-133).
 *
 * THE UNIT IS A PARAGRAPH INDEX, counted across the chapter's prose in document
 * order. Not a pixel offset: the whole reason progress is server-side is that a
 * position set on a laptop has to mean something on a phone, and pixels do not
 * survive a change of viewport width, font size, or orientation.
 *
 * Writes are throttled and de-duplicated — scrolling fires continuously, and
 * the position is only interesting when it CHANGES. The last write goes out via
 * `sendBeacon` on the way out, because a normal fetch is cancelled when the
 * page unloads and that is precisely the write worth keeping.
 */

/** How long the reader must settle before a scroll counts as a position. */
const SETTLE_MS = 1500

export function useProgressRecorder(bookId: string, chapterId: string, enabled: boolean) {
  const lastSent = useRef<number>(-1)
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => {
    if (!enabled) return

    /** The topmost paragraph not yet scrolled past. */
    const currentIndex = (): number => {
      const paras = document.querySelectorAll<HTMLElement>('[data-para]')
      if (paras.length === 0) return 0

      // FINISHED is an explicit signal, not a threshold: once the last
      // paragraph's end is above the bottom of the viewport, the reader has
      // seen the end of the chapter. Reported as `count` — one past the final
      // index — which is what opens the comments (LOOM-134).
      //
      // A heuristic cannot do this. The index below is the topmost paragraph
      // above the reading line, so at the true bottom of a chapter it sits
      // several short of the end by an amount that depends on screen height —
      // there is no fixed slack that is right for both a phone and a monitor.
      const last = paras[paras.length - 1]
      if (last.getBoundingClientRect().bottom <= window.innerHeight) return paras.length

      // A small band below the top edge, so the "current" paragraph is one the
      // reader can actually see rather than one just clipped by the header.
      const line = window.innerHeight * 0.25
      let idx = 0
      for (const p of paras) {
        const r = p.getBoundingClientRect()
        if (r.top <= line) idx = Number(p.dataset.para ?? 0)
        else break
      }
      return idx
    }

    const send = (offset: number, beacon: boolean) => {
      if (offset === lastSent.current) return
      lastSent.current = offset
      const body = JSON.stringify({ bookId, chapterId, offset })
      if (beacon && navigator.sendBeacon) {
        navigator.sendBeacon('/api/progress', new Blob([body], { type: 'application/json' }))
        return
      }
      void fetch('/api/progress', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body,
        keepalive: true,
      })
    }

    const onScroll = () => {
      if (timer.current) clearTimeout(timer.current)
      timer.current = setTimeout(() => send(currentIndex(), false), SETTLE_MS)
    }

    // Opening the chapter IS progress — someone who reads one page and closes
    // the tab should still come back here, not to wherever they were before.
    send(currentIndex(), false)

    const onHide = () => {
      if (document.visibilityState === 'hidden') send(currentIndex(), true)
    }

    window.addEventListener('scroll', onScroll, { passive: true })
    // `visibilitychange`, not `unload`: mobile browsers routinely discard a tab
    // without ever firing unload, and that is the common way a phone reader
    // leaves a page.
    document.addEventListener('visibilitychange', onHide)
    return () => {
      if (timer.current) clearTimeout(timer.current)
      window.removeEventListener('scroll', onScroll)
      document.removeEventListener('visibilitychange', onHide)
      send(currentIndex(), true)
    }
  }, [bookId, chapterId, enabled])
}
