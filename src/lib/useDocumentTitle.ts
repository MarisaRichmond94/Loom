'use client'

import { useEffect } from 'react'

// Sets the browser tab title to "Loom - <suffix>", restoring the plain
// "Loom" default on unmount so navigating away (or to a page that hasn't
// loaded its own data yet) never leaves a stale title behind.
export function useDocumentTitle(suffix: string | null | undefined) {
  useEffect(() => {
    if (!suffix) return
    const previous = document.title
    document.title = `Loom - ${suffix}`
    return () => { document.title = previous }
  }, [suffix])
}
