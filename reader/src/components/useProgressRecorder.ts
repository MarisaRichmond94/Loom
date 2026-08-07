'use client'

import { useEffect, useRef } from 'react'
import { PROSE_CLASS } from '@/shared/proseClass'
import { api } from '@/lib/basePath'

/**
 * The chapter's paragraphs, in document order.
 *
 * A paragraph's index IS its position in this list — nothing is written to the
 * DOM. Stamping `data-para` attributes was the previous approach and it failed
 * in a way that took three rounds to see: the attributes existed at mount and
 * were gone by the first scroll, because React owns these nodes and discards
 * foreign attributes on its first client render. Every position write was then
 * suppressed as a duplicate of the mount write, so progress only ever advanced
 * via the flush-on-leave — which is why a hard refresh looked like the fix.
 *
 * Reading the order live cannot drift from what React renders, because it asks
 * React's own DOM every time.
 */
export function proseParagraphs(): HTMLElement[] {
  const root = PROSE_CLASS.split(' ')[0]
  return Array.from(document.querySelectorAll<HTMLElement>(`.${root} p`))
}

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

export function useProgressRecorder(
  bookId: string,
  chapterId: string,
  enabled: boolean,
  /**
   * Fired once, after the "finished" position has been written.
   *
   * The comment gate is decided on the SERVER when the page renders, so
   * reaching the bottom cannot change a decision already made — without this,
   * comments only appeared after navigating away and back. The callback runs
   * after the write lands, so the re-check it triggers cannot race the very
   * position it depends on.
   */
  onFinished?: () => void,
) {
  const lastSent = useRef<number>(-1)
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const announced = useRef(false)
  // Kept in a ref so a new callback identity each render does not tear down
  // and re-arm the listeners mid-scroll.
  const finishedCb = useRef(onFinished)
  finishedCb.current = onFinished

  useEffect(() => {
    announced.current = false
  }, [chapterId])

  useEffect(() => {
    if (!enabled) return

    const paras = proseParagraphs

    /** The topmost paragraph not yet scrolled past. */
    const currentIndex = (): number => {
      const ps = paras()
      if (ps.length === 0) return 0

      // FINISHED is an explicit signal, not a threshold: once the last
      // paragraph's end is above the bottom of the viewport, the reader has
      // seen the end of the chapter. Reported as `count` — one past the final
      // index — which is what opens the comments (LOOM-134).
      const last = ps[ps.length - 1]
      if (last.getBoundingClientRect().bottom <= window.innerHeight) return ps.length

      // A small band below the top edge, so the "current" paragraph is one the
      // reader can actually see rather than one just clipped by the header.
      const line = window.innerHeight * 0.25
      let idx = 0
      for (let i = 0; i < ps.length; i++) {
        if (ps[i].getBoundingClientRect().top <= line) idx = i
        else break
      }
      return idx
    }

    const total = () => paras().length

    const send = (offset: number, beacon: boolean) => {
      // TEMPORARY: above the dedupe, so a suppressed write is distinguishable
      // from a listener that never fired.
      if (offset === lastSent.current) return
      lastSent.current = offset
      const body = JSON.stringify({ bookId, chapterId, offset })

      if (beacon && navigator.sendBeacon) {
        navigator.sendBeacon(api('/api/progress'), new Blob([body], { type: 'application/json' }))
        return
      }

      const done = fetch(api('/api/progress'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body,
        keepalive: true,
      })

      // Announce only after the write lands. Firing early would let the
      // comment re-check race the position it is asking about, and lose.
      const count = total()
      if (count > 0 && offset >= count && !announced.current) {
        announced.current = true
        void done.then(() => finishedCb.current?.())
      }
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
