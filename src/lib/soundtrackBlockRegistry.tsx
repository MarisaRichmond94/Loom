'use client'

import { createContext, useCallback, useContext, useMemo, useRef, type ReactNode } from 'react'

type Entry = { order: number; togglePlay: () => void }

type Registry = {
  register: (blockId: string, entry: Entry) => () => void
  markInteracted: (blockId: string) => void
  /** Toggles play/pause on whichever soundtrack block the chapter page's
   *  ⌥⇧Space hotkey should target. No-op if the chapter has none. */
  toggleTarget: () => void
}

const RegistryContext = createContext<Registry | null>(null)

// Backs the chapter page's ⌥⇧Space play/pause hotkey. With more than one
// soundtrack block in a chapter, "the song block" the hotkey should act on is
// ambiguous — this tracks whichever one the writer last touched and falls
// back to the first block in document order until they touch any of them.
export function SoundtrackBlockRegistryProvider({ children }: { children: ReactNode }) {
  const entriesRef = useRef(new Map<string, Entry>())
  const lastInteractedRef = useRef<string | null>(null)

  const register = useCallback((blockId: string, entry: Entry) => {
    entriesRef.current.set(blockId, entry)
    return () => {
      entriesRef.current.delete(blockId)
      if (lastInteractedRef.current === blockId) lastInteractedRef.current = null
    }
  }, [])

  const markInteracted = useCallback((blockId: string) => {
    lastInteractedRef.current = blockId
  }, [])

  const toggleTarget = useCallback(() => {
    const entries = entriesRef.current
    if (entries.size === 0) return
    const interacted = lastInteractedRef.current
    const target = interacted && entries.has(interacted)
      ? entries.get(interacted)!
      : [...entries.values()].sort((a, b) => a.order - b.order)[0]
    target.togglePlay()
  }, [])

  const value = useMemo(() => ({ register, markInteracted, toggleTarget }), [register, markInteracted, toggleTarget])

  return <RegistryContext.Provider value={value}>{children}</RegistryContext.Provider>
}

/** Null outside a chapter page (e.g. book/series preview) — callers should
 *  no-op rather than throw, since not every place SoundtrackBlock renders
 *  wants hotkey registration. */
export function useSoundtrackBlockRegistry() {
  return useContext(RegistryContext)
}
