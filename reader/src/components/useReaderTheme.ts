'use client'

import { useEffect, useState } from 'react'

/**
 * Light mode for the reader, applied to <body> rather than <main>.
 *
 * Loom scopes `light-body` to the page element, which is fine there: those
 * pages settle before anyone looks. Here it caused a visible dark flash on
 * every navigation — the server renders without knowing the preference,
 * localStorage is only readable after mount, and a reader notices a page that
 * blinks black before every chapter.
 *
 * So the preference is applied to <body> by an inline script before first
 * paint (see layout.tsx) and this hook keeps it in sync afterwards. The header
 * and player bars carry `chrome-dark` to stay dark inside it, which is the same
 * mechanism Loom uses for its own always-dark chrome.
 *
 * Same storage key as Loom's `useLightMode`, deliberately: one preference.
 */

const STORAGE_KEY = 'loom-light-mode'

export function useReaderTheme() {
  // Seeded from the class the inline script already set, so the first client
  // render agrees with what is on screen instead of correcting it.
  const [lightMode, setLightMode] = useState(false)
  const [mounted, setMounted] = useState(false)

  useEffect(() => {
    setLightMode(document.documentElement.classList.contains('pre-light'))
    setMounted(true)
  }, [])

  function toggleLightMode() {
    setLightMode(prev => {
      const next = !prev
      localStorage.setItem(STORAGE_KEY, String(next))
      document.documentElement.classList.toggle('pre-light', next)
      return next
    })
  }

  return { lightMode, toggleLightMode, mounted }
}
