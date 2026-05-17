'use client'

import { useEffect, useRef } from 'react'

type Variable = { id: string; name: string; type: string }

type Props = {
  variables: Variable[]
  selectedIdx: number
  coords: { x: number; y: number }
  onSelect: (v: Variable) => void
  emptyMessage: string
}

export default function VariableSuggestionList({ variables, selectedIdx, coords, onSelect, emptyMessage }: Props) {
  const listRef = useRef<HTMLDivElement>(null)

  // Scroll the highlighted row into view as the user navigates with arrows
  useEffect(() => {
    const container = listRef.current
    if (!container) return
    const row = container.querySelector<HTMLElement>(`[data-idx="${selectedIdx}"]`)
    if (row) row.scrollIntoView({ block: 'nearest' })
  }, [selectedIdx])

  return (
    <div
      style={{ position: 'fixed', top: coords.y + 4, left: coords.x, zIndex: 50 }}
      className="bg-surface-overlay border border-accent/20 rounded shadow-lg overflow-hidden min-w-[200px]"
    >
      {variables.length === 0 ? (
        <div className="px-3 py-2 text-xs text-ink-faint italic">{emptyMessage}</div>
      ) : (
        <div ref={listRef} className="overflow-y-auto" style={{ maxHeight: '112px' }}>
          {variables.map((v, i) => (
            <button
              key={v.id}
              data-idx={i}
              onMouseDown={e => { e.preventDefault(); onSelect(v) }}
              className={`w-full text-left px-3 py-2 text-xs flex items-center justify-between gap-3 transition ${
                i === selectedIdx
                  ? 'bg-surface-muted text-ink'
                  : 'text-ink-muted hover:text-ink hover:bg-surface-muted'
              }`}
            >
              <span className="font-mono truncate">{v.name}</span>
              <span className="text-ink-faint shrink-0">{v.type}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  )
}
