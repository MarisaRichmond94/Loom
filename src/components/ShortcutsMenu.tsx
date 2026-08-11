'use client'

import { useEffect, useRef, useState } from 'react'
import { LuKeyboard } from 'react-icons/lu'
import { usePageShortcuts, type ShortcutGroup } from '@/lib/shortcuts'

// Rendered last, under whatever the current page contributed — these work
// everywhere in the author app, so they read as the baseline.
const GLOBAL_GROUP: ShortcutGroup = {
  group: 'Series',
  items: [
    { keys: '⌥⇧G', label: 'Find in series (global)' },
    { keys: '⌥⇧1', label: 'Toggle sidebar' },
    { keys: '⌥⇧3', label: 'Toggle context' },
  ],
}

export default function ShortcutsMenu() {
  const pageGroups = usePageShortcuts()
  const [open, setOpen] = useState(false)
  const rootRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    function onMouseDown(e: MouseEvent) {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) setOpen(false)
    }
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === 'Escape') setOpen(false)
    }
    document.addEventListener('mousedown', onMouseDown)
    document.addEventListener('keydown', onKeyDown)
    return () => {
      document.removeEventListener('mousedown', onMouseDown)
      document.removeEventListener('keydown', onKeyDown)
    }
  }, [open])

  const groups = [...pageGroups, GLOBAL_GROUP]

  return (
    <div ref={rootRef} className="relative shrink-0">
      <button
        onClick={() => setOpen(o => !o)}
        title="Keyboard shortcuts"
        aria-label="Keyboard shortcuts"
        aria-expanded={open}
        className={`flex items-center transition ${open ? 'text-ink' : 'text-ink-faint hover:text-ink'}`}
      >
        <LuKeyboard size={16} />
      </button>
      {open && (
        <div className="absolute right-0 top-full mt-2 z-50 w-72 bg-surface-raised border border-accent/20 rounded-xl shadow-xl p-4 max-h-[70vh] overflow-y-auto">
          <p className="text-[10px] uppercase tracking-widest text-ink-faint font-semibold mb-3">Keyboard Shortcuts</p>
          {groups.map(({ group, items }) => (
            <div key={group} className="mb-3 last:mb-0">
              <p className="text-[9px] uppercase tracking-widest text-ink-faint mb-1.5">{group}</p>
              <div className="flex flex-col gap-1">
                {items.map(({ keys, label }) => (
                  <div key={keys} className="flex items-center justify-between gap-3">
                    <span className="text-xs text-ink-muted">{label}</span>
                    <span className="font-mono text-[10px] bg-surface-overlay border border-accent/20 rounded px-1.5 py-0.5 text-ink-muted tracking-wider shrink-0">{keys}</span>
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
