'use client'

import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react'

export type ShortcutGroup = {
  group: string
  items: { keys: string; label: string }[]
}

type Register = (id: string, groups: ShortcutGroup[]) => () => void

// Split in two on purpose: the register function must keep a stable identity
// (it's a dependency of every caller's effect), while the group list changes
// whenever a page mounts or unmounts. One combined context would re-fire every
// registration effect on every change and never settle.
const RegisterContext = createContext<Register | null>(null)
const GroupsContext = createContext<ShortcutGroup[]>([])

/**
 * Collects the shortcuts the currently-mounted page wants shown in the header's
 * shortcut menu. The menu lives in the shared author layout but most shortcuts
 * are page-specific, so pages publish theirs here for as long as they're up.
 *
 * This is a *display* registry — it does not bind any keys. The handlers stay
 * next to the state they act on (and three of them are TipTap keymaps that
 * can't route through a document listener anyway), so a shortcut and its menu
 * entry are still kept in step by convention. Adding a shortcut means adding it
 * to that page's group list too.
 */
export function ShortcutsProvider({ children }: { children: ReactNode }) {
  const [entries, setEntries] = useState<{ id: string; groups: ShortcutGroup[] }[]>([])

  const register = useCallback<Register>((id, groups) => {
    setEntries(prev => [...prev.filter(e => e.id !== id), { id, groups }])
    return () => setEntries(prev => prev.filter(e => e.id !== id))
  }, [])

  const groups = useMemo(() => entries.flatMap(e => e.groups), [entries])

  return (
    <RegisterContext.Provider value={register}>
      <GroupsContext.Provider value={groups}>{children}</GroupsContext.Provider>
    </RegisterContext.Provider>
  )
}

/**
 * Publish this page's shortcut groups while it's mounted.
 *
 * `groups` is an effect dependency, so pass a module-level constant or a
 * memoized value — an inline array literal would re-register on every render.
 */
export function useRegisterShortcuts(id: string, groups: ShortcutGroup[]) {
  const register = useContext(RegisterContext)
  useEffect(() => {
    if (!register) return
    return register(id, groups)
  }, [register, id, groups])
}

export function usePageShortcuts() {
  return useContext(GroupsContext)
}
