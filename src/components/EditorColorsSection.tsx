'use client'

import { useEffect, useState } from 'react'
import { LuPlus, LuRotateCcw, LuX } from 'react-icons/lu'
import type { EditorColor } from '@/lib/editorColors'
import { primeEditorColors } from '@/lib/useEditorColors'

// Settings section for the text-editor color palette (the swatches in the
// TipTap toolbar). Saved as a whole list; primeEditorColors pushes changes
// into any editor opened later this session. Existing text keeps the color
// value it was written with — exports still map old shades onto the same
// template style as long as the new shade stays in the same color family.

export default function EditorColorsSection() {
  const [colors, setColors] = useState<EditorColor[] | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    fetch('/api/settings/editor-colors').then(r => r.json()).then(setColors)
  }, [])

  async function save(next: EditorColor[]) {
    setColors(next)
    const res = await fetch('/api/settings/editor-colors', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(next),
    })
    if (res.ok) {
      const saved = await res.json() as EditorColor[]
      setError(null)
      primeEditorColors(saved)
    } else {
      const { error } = await res.json().catch(() => ({ error: 'Save failed.' })) as { error?: string }
      setError(error ?? 'Save failed.')
    }
  }

  async function reset() {
    const res = await fetch('/api/settings/editor-colors', { method: 'DELETE' })
    if (res.ok) {
      const defaults = await res.json() as EditorColor[]
      setColors(defaults)
      setError(null)
      primeEditorColors(defaults)
    }
  }

  if (!colors) return null

  function update(i: number, patch: Partial<EditorColor>, persist: boolean) {
    const next = colors!.map((c, idx) => idx === i ? { ...c, ...patch } : c)
    if (persist) save(next)
    else setColors(next)
  }

  return (
    <section className="mb-8">
      <div className="flex items-center justify-between mb-4">
        <h2 className="text-xs uppercase tracking-widest text-ink-faint">Text Colors</h2>
        <button
          onClick={reset}
          className="flex items-center gap-1 text-xs text-ink-faint hover:text-ink transition"
          title="Restore the default palette"
        >
          <LuRotateCcw size={11} /> Reset to defaults
        </button>
      </div>
      <div className="bg-surface-raised border border-accent/10 rounded-xl p-6 flex flex-col gap-4">
        <p className="text-xs text-ink-faint leading-relaxed -mb-1">
          The color swatches offered in the writing toolbar. Text you've
          already colored keeps its original shade; new text uses these.
        </p>

        <div className="flex flex-col gap-2">
          {colors.map((c, i) => (
            <div key={i} className="flex items-center gap-3">
              <input
                type="color"
                value={c.value}
                onChange={e => update(i, { value: e.target.value }, false)}
                onBlur={e => update(i, { value: e.target.value }, true)}
                className="w-9 h-9 bg-surface-base border border-accent/20 rounded cursor-pointer shrink-0"
              />
              <input
                value={c.label}
                onChange={e => update(i, { label: e.target.value }, false)}
                onBlur={e => update(i, { label: e.target.value }, true)}
                placeholder="Label"
                className="w-40 bg-surface-base border border-accent/20 rounded-lg px-3 py-2 text-sm text-ink placeholder:text-ink-faint outline-none focus:border-accent"
              />
              <span className="text-xs text-ink-faint font-mono">{c.value}</span>
              <button
                onClick={() => save(colors.filter((_, idx) => idx !== i))}
                disabled={colors.length <= 1}
                title="Remove color"
                className="ml-auto text-ink-faint hover:text-ink transition disabled:opacity-30"
              >
                <LuX size={14} />
              </button>
            </div>
          ))}
        </div>

        <div>
          <button
            onClick={() => save([...colors, { label: 'New Color', value: '#888888' }])}
            disabled={colors.length >= 24}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded text-xs bg-surface-base border border-accent/20 text-ink-muted hover:text-ink transition disabled:opacity-50"
          >
            <LuPlus size={12} /> Add color
          </button>
        </div>

        {error && <p className="text-xs text-choice-kill">{error}</p>}
      </div>
    </section>
  )
}
