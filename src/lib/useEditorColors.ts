'use client'

import { useEffect, useState } from 'react'
import { DEFAULT_EDITOR_COLORS, type EditorColor } from '@/lib/editorColors'

// Palette for the TipTap toolbar swatches. A chapter renders one TextBlock
// per block, so the fetch is shared module-wide: first caller loads, the
// rest reuse. Defaults render until the fetch lands (and forever if it
// fails). The settings page pushes edits into the cache via
// primeEditorColors so an editor opened later in the session sees them.

let cached: EditorColor[] | null = null
let inflight: Promise<EditorColor[]> | null = null
const listeners = new Set<(colors: EditorColor[]) => void>()

export function primeEditorColors(colors: EditorColor[]) {
  cached = colors
  listeners.forEach(l => l(colors))
}

export function useEditorColors(): EditorColor[] {
  const [colors, setColors] = useState<EditorColor[]>(cached ?? DEFAULT_EDITOR_COLORS)

  useEffect(() => {
    listeners.add(setColors)
    if (cached) setColors(cached)
    else {
      inflight ??= fetch('/api/settings/editor-colors')
        .then(r => r.ok ? r.json() : DEFAULT_EDITOR_COLORS)
        .catch(() => DEFAULT_EDITOR_COLORS)
        .then((c: EditorColor[]) => { cached = c; return c })
      inflight.then(c => listeners.forEach(l => l(c)))
    }
    return () => { listeners.delete(setColors) }
  }, [])

  return colors
}
