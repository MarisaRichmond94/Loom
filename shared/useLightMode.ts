'use client'

import { useEffect, useState } from 'react'

const STORAGE_KEY = 'loom-light-mode'

/**
 * Light-mode state, shared by every surface that renders <AppHeader> (KAN-2).
 *
 * This logic was duplicated verbatim in four places — the home layout, the
 * author layout, the settings page, and ReaderView — each with its own
 * useState + useEffect + localStorage write. Four copies of the same three
 * lines is four chances for them to drift.
 *
 * `mounted` is false until the effect runs, because localStorage is unreadable
 * during SSR. Callers use it to render placeholders rather than let the
 * greeting and toggle pop into position a frame late.
 *
 * Note the deliberate scoping this preserves: light mode is applied to the page
 * body only (`light-body` on <main>), never the header. Both Loom and WriteAI
 * keep their chrome dark in light mode.
 */
export function useLightMode() {
  const [lightMode, setLightMode] = useState(false)
  const [mounted, setMounted] = useState(false)

  useEffect(() => {
    setLightMode(localStorage.getItem(STORAGE_KEY) === 'true')
    setMounted(true)
  }, [])

  function toggleLightMode() {
    setLightMode(prev => {
      const next = !prev
      localStorage.setItem(STORAGE_KEY, String(next))
      return next
    })
  }

  return { lightMode, toggleLightMode, mounted }
}
