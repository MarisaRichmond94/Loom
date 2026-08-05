'use client'

import { useEffect, useRef, useState } from 'react'
import { LuChevronDown, LuSend, LuSquare } from 'react-icons/lu'

// The composer, its model picker, and the retrieval-depth toggle (LOOM-119).
//
// The model list is NOT hard-coded here. It is fetched from WriteAI, which is
// the only place that knows which models it will price correctly — a second
// list in Loom is one that nobody would remember to update, and the failure is
// silent: an unpriced model still answers, and only the spend figure is wrong.
// See tests/test_model_pricing.py on the WriteAI side.

export type ModelOption = { id: string; label: string }

export default function ExploreComposer({
  value, onChange, onSend, onStop, isStreaming, disabled,
  models, model, onModel, thorough, onThorough, placeholder,
}: {
  value: string
  onChange: (v: string) => void
  onSend: () => void
  onStop: () => void
  isStreaming: boolean
  disabled: boolean
  models: ModelOption[]
  model: string | null
  onModel: (id: string) => void
  thorough: boolean
  onThorough: (v: boolean) => void
  placeholder: string
}) {
  const [menuOpen, setMenuOpen] = useState(false)
  const menuRef = useRef<HTMLDivElement>(null)
  const taRef = useRef<HTMLTextAreaElement>(null)

  useEffect(() => {
    if (!menuOpen) return
    const onDown = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) setMenuOpen(false)
    }
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setMenuOpen(false) }
    document.addEventListener('mousedown', onDown)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onDown)
      document.removeEventListener('keydown', onKey)
    }
  }, [menuOpen])

  const grow = () => {
    const el = taRef.current
    if (!el) return
    el.style.height = 'auto'
    el.style.height = `${Math.min(el.scrollHeight, 160)}px`
  }

  const label = models.find(m => m.id === model)?.label ?? model ?? 'Default'

  return (
    <div className="border-t border-accent/10 px-4 pb-3 pt-2.5">
      <div className="flex items-end gap-2 rounded-lg border border-accent/20 bg-surface-base px-3 py-2 focus-within:border-accent">
        <textarea
          ref={taRef}
          rows={1}
          value={value}
          disabled={disabled}
          onChange={e => { onChange(e.target.value); grow() }}
          onKeyDown={e => {
            if (e.key === 'Enter' && !e.shiftKey) {
              e.preventDefault()
              if (!isStreaming && value.trim()) onSend()
            }
          }}
          placeholder={placeholder}
          className="flex-1 resize-none bg-transparent text-[15px] text-ink placeholder:text-ink-faint focus:outline-none disabled:opacity-50"
        />
        {isStreaming ? (
          <button
            type="button"
            onClick={onStop}
            aria-label="Stop"
            title="Stop"
            className="grid h-7 w-7 shrink-0 place-items-center rounded-md bg-surface-overlay text-ink-muted transition-colors hover:text-ink"
          >
            <LuSquare size={11} />
          </button>
        ) : (
          <button
            type="button"
            onClick={onSend}
            disabled={disabled || !value.trim()}
            aria-label="Send"
            className="grid h-7 w-7 shrink-0 place-items-center rounded-md bg-accent text-white transition-opacity disabled:opacity-30"
          >
            <LuSend size={12} />
          </button>
        )}
      </div>

      <div className="relative mt-1.5 flex items-center gap-2 text-[10.5px] text-ink-faint">
        <span>{isStreaming ? 'Thinking…' : 'Enter to send · Shift+Enter for a new line'}</span>
        <span className="ml-auto" />

        {/* Fast is the default. Thorough swaps in the full-quality reranker,
            which is markedly slower — worth offering, not worth defaulting. */}
        <button
          type="button"
          onClick={() => onThorough(!thorough)}
          aria-pressed={thorough}
          title={thorough
            ? 'Thorough: higher-quality retrieval, slower'
            : 'Fast: quicker answers'}
          className={`rounded px-1.5 py-0.5 transition-colors hover:bg-surface-overlay ${
            thorough ? 'text-accent' : 'hover:text-ink'
          }`}
        >
          {thorough ? 'Thorough' : 'Fast'}
        </button>

        <div ref={menuRef} className="relative">
          <button
            type="button"
            onClick={() => setMenuOpen(o => !o)}
            aria-expanded={menuOpen}
            className={`flex items-center gap-1 rounded px-1.5 py-0.5 transition-colors hover:bg-surface-overlay hover:text-ink ${
              menuOpen ? 'text-accent' : ''
            }`}
          >
            {label}
            <LuChevronDown size={9} />
          </button>
          {menuOpen && (
            <div className="absolute bottom-full right-0 z-50 mb-1 min-w-[150px] rounded-md border border-accent/20 bg-surface-raised py-1 shadow-lg">
              {models.length === 0 ? (
                <p className="px-3 py-1.5 text-[10.5px] text-ink-faint">WriteAI is unavailable</p>
              ) : models.map(m => (
                <button
                  key={m.id}
                  type="button"
                  onClick={() => { onModel(m.id); setMenuOpen(false) }}
                  aria-current={m.id === model}
                  className={`block w-full px-3 py-1.5 text-left text-[11px] transition-colors hover:bg-surface-overlay ${
                    m.id === model ? 'text-accent' : 'text-ink-muted'
                  }`}
                >
                  {m.label}
                </button>
              ))}
            </div>
          )}
        </div>

        <span title="WriteAI makes the model call and books the cost — Loom holds no API key">
          Billed to WriteAI
        </span>
      </div>
    </div>
  )
}
