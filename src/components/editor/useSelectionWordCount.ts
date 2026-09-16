'use client'

import { useEffect, useRef, useState } from 'react'
import type { RefObject } from 'react'
import { countWords } from '@/lib/seriesStats'

export type SelectionWordCount = {
  words: number
  /**
   * The selection as a percentage of the chapter, or null when the chapter
   * text can't contain it — a selection inside a block the active path
   * excludes isn't a fraction of the canon text, so no percentage is honest.
   */
  percent: number | null
  totalWords: number
}

// selectionchange fires on every frame of a drag. Counting words (and
// resolving the whole chapter for the denominator) on each one is wasted
// work when only the settled selection is ever read.
const SETTLE_MS = 60

/**
 * Live word count for whatever prose is currently highlighted inside `rootRef`
 * (LOOM: "what percentage of the chapter is this scene?").
 *
 * Reads the DOM selection rather than any one editor's ProseMirror selection:
 * a chapter is a column of separate TipTap instances, one per block, so a drag
 * across two blocks has no single editor that knows about all of it.
 *
 * `getTotalWords` is called at measure time, not at subscribe time, so the
 * denominator is always the live chapter text — it does not need to be stable.
 */
export function useSelectionWordCount(
  rootRef: RefObject<HTMLElement | null>,
  getTotalWords: () => number,
): SelectionWordCount | null {
  const [stats, setStats] = useState<SelectionWordCount | null>(null)
  const getTotalWordsRef = useRef(getTotalWords)
  getTotalWordsRef.current = getTotalWords

  useEffect(() => {
    let timer: number | undefined

    const measure = () => {
      const root = rootRef.current
      const sel = window.getSelection()
      if (!root || !sel || sel.isCollapsed || sel.rangeCount === 0) { setStats(null); return }
      // Prose only. A drag that ends out in the chrome, or a selection in the
      // reference panel / a header field, isn't part of the chapter.
      if (!sel.anchorNode || !sel.focusNode ||
          !root.contains(sel.anchorNode) || !root.contains(sel.focusNode)) {
        setStats(null)
        return
      }
      const words = countWords(sel.toString())
      if (words === 0) { setStats(null); return }

      const totalWords = getTotalWordsRef.current()
      const raw = totalWords > 0 ? (words / totalWords) * 100 : 0
      setStats({ words, percent: totalWords > 0 && raw <= 100 ? raw : null, totalWords })
    }

    const schedule = () => {
      window.clearTimeout(timer)
      timer = window.setTimeout(measure, SETTLE_MS)
    }

    document.addEventListener('selectionchange', schedule)
    return () => {
      window.clearTimeout(timer)
      document.removeEventListener('selectionchange', schedule)
    }
  }, [rootRef])

  return stats
}

/**
 * One decimal below 10% (the difference between a 4% and a 6% scene matters),
 * whole numbers above it. Tiny-but-nonzero selections read as "<0.1" rather
 * than rounding away to a flat 0.
 */
export function formatSelectionPercent(percent: number): string {
  if (percent >= 10) return String(Math.round(percent))
  const oneDecimal = Math.round(percent * 10) / 10
  if (oneDecimal === 0) return '<0.1'
  return oneDecimal.toFixed(1)
}
