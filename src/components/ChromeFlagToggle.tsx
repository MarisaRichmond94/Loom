'use client'

import { useEffect } from 'react'
import { toggleUnifiedChrome } from '@/lib/unifiedChrome'

/**
 * ⌥⇧U flips UNIFIED_CHROME (KAN-6). TEMPORARY SCAFFOLDING — delete with the
 * rest of the flag when KAN-8 closes.
 *
 * Deliberately NOT registered in ShortcutsMenu: that menu documents features
 * for the writer, and this is build-time scaffolding that will not exist by the
 * time Phase A lands. Flipping via devtools localStorage works too, but this is
 * meant to be hit dozens of times while judging the palette, and a shortcut is
 * the difference between actually A/B-ing it and not bothering.
 *
 * Renders nothing.
 */
export default function ChromeFlagToggle() {
  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if (e.altKey && e.shiftKey && e.code === 'KeyU') {
        e.preventDefault()
        toggleUnifiedChrome()
      }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [])

  return null
}
