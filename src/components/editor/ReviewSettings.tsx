'use client'

import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { LuSettings2 } from 'react-icons/lu'

// The review panel's settings cog: model, reasoning effort, and experience
// preset for the next run. Until this existed the panel was locked to
// WriteAI's server-side defaults and the writer had no way to trade cost
// against quality — or to A/B the review-experience presets — from the app
// where she actually reviews.
//
// The choices are DEFAULTS-FIRST: every dropdown offers "Default", which
// sends nothing and lets WriteAI's own configuration (env vars, preset
// registry) decide. Only an explicit pick rides along on the request, so
// server-side tuning keeps working for writers who never open the cog.
//
// Persisted per-browser in localStorage — these are preferences of the
// writer, not facts of the chapter, so they deliberately do not live in the
// review session.

export type ReviewSettingsState = {
  model: string | null    // null = WriteAI default
  effort: string | null   // "none" = uncapped; null = WriteAI default
  preset: string | null   // null = WriteAI default
  excerpts: number | null // background-prose passages; null = persona/preset default
}

const STORAGE_KEY = 'loom-review-settings'

export function readReviewSettings(): ReviewSettingsState {
  try {
    const raw = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? '{}')
    return {
      model: typeof raw.model === 'string' ? raw.model : null,
      effort: typeof raw.effort === 'string' ? raw.effort : null,
      preset: typeof raw.preset === 'string' ? raw.preset : null,
      excerpts: typeof raw.excerpts === 'number' ? raw.excerpts : null,
    }
  } catch {
    return { model: null, effort: null, preset: null, excerpts: null }
  }
}

type Options = {
  presets: { name: string; description: string }[]
  efforts: string[]
  models: { id: string; label: string }[]
  defaults: { preset: string; effort: string; model: string }
  excerpts?: { min: number; max: number }
}

const EFFORT_LABELS: Record<string, string> = {
  low: 'Low', medium: 'Medium', high: 'High', xhigh: 'X-High', max: 'Max',
  none: 'Unlimited',
}

export function ReviewSettings({
  value, onChange, disabled,
}: {
  value: ReviewSettingsState
  onChange: (next: ReviewSettingsState) => void
  disabled?: boolean
}) {
  const [open, setOpen] = useState(false)
  const [options, setOptions] = useState<Options | null>(null)
  const [failed, setFailed] = useState(false)
  const panelRef = useRef<HTMLDivElement>(null)
  const buttonRef = useRef<HTMLButtonElement>(null)
  // The dock is a sticky, overflow-y-auto container — it clips absolutely
  // positioned children and its stacking context loses to the page body, so
  // the popover renders through a portal to document.body (the same pattern
  // as the editor's modals) at a fixed position anchored to the cog.
  const [anchor, setAnchor] = useState<{ right: number; bottom: number } | null>(null)
  // Light mode is a `.light-body` class scoped to the writing area's <main>,
  // not to <body> — so the portaled popover escapes it and would render dark
  // over a light page. Detected from the cog's own ancestry at open time and
  // re-applied to the popover root, where the CSS variables then re-resolve.
  const [light, setLight] = useState(false)

  const toggle = () => {
    if (!open) {
      const btn = buttonRef.current
      const rect = btn?.getBoundingClientRect()
      if (rect) {
        setAnchor({
          right: window.innerWidth - rect.right,
          bottom: window.innerHeight - rect.top + 8,
        })
      }
      setLight(!!btn?.closest('.light-body'))
    }
    setOpen(o => !o)
  }

  // Options are fetched on first open, not on mount — the cog must cost
  // nothing on a page load, like everything else in this panel.
  useEffect(() => {
    if (!open || options || failed) return
    fetch('/api/writeai/review/options')
      .then(r => (r.ok ? r.json() : Promise.reject()))
      .then(setOptions)
      .catch(() => setFailed(true))
  }, [open, options, failed])

  useEffect(() => {
    if (!open) return
    function handleClick(e: MouseEvent) {
      const t = e.target as Node
      // The panel lives in a portal, so the cog button is NOT inside it —
      // without the second check, a click on the cog would close-then-reopen.
      if (panelRef.current && !panelRef.current.contains(t)
          && !buttonRef.current?.contains(t)) setOpen(false)
    }
    document.addEventListener('mousedown', handleClick)
    return () => document.removeEventListener('mousedown', handleClick)
  }, [open])

  const set = (patch: Partial<ReviewSettingsState>) => {
    const next = { ...value, ...patch }
    onChange(next)
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify(next)) } catch { /* private mode */ }
  }

  const customized = value.model !== null || value.effort !== null
    || value.preset !== null || value.excerpts !== null
  const fieldCls = 'w-full bg-surface-base border border-accent/20 rounded px-2 py-1 text-xs text-ink outline-none focus:border-accent'
  const labelCls = 'mb-0.5 block text-[10px] font-semibold uppercase tracking-wider text-ink-faint'

  return (
    <>
      <button
        ref={buttonRef}
        onClick={toggle}
        disabled={disabled}
        title="Review settings — model, effort, preset"
        className={`p-1 rounded transition disabled:opacity-50 ${
          customized ? 'text-accent hover:opacity-80' : 'text-ink-faint hover:text-ink'
        }`}
      >
        <LuSettings2 size={14} />
      </button>

      {open && anchor && createPortal(
        <div
          ref={panelRef}
          // z-[95] like the notification panel: above the sticky dock and
          // page chrome, below full-screen modal overlays (z-[100]).
          className={`${light ? 'light-body ' : ''}fixed z-[95] w-60 rounded-lg border border-accent/20 bg-surface-raised p-3 shadow-xl`}
          style={{ right: anchor.right, bottom: anchor.bottom }}
        >
          <div className="mb-2 text-[10px] font-semibold uppercase tracking-wider text-ink-muted">
            Review settings
          </div>

          {failed && (
            <div className="text-[11px] text-ink-faint">
              WriteAI isn’t reachable — settings can’t be loaded right now.
            </div>
          )}
          {!failed && !options && (
            <div className="text-[11px] text-ink-faint">Loading…</div>
          )}

          {options && (
            <div className="flex flex-col gap-2.5">
              <label className="block">
                <span className={labelCls}>Model</span>
                <select
                  value={value.model ?? ''}
                  onChange={e => set({ model: e.target.value || null })}
                  className={fieldCls}
                >
                  <option value="">Default ({options.defaults.model})</option>
                  {options.models.map(m => (
                    <option key={m.id} value={m.id}>{m.label}</option>
                  ))}
                </select>
              </label>

              <label className="block">
                <span className={labelCls}>Reasoning effort</span>
                <select
                  value={value.effort ?? ''}
                  onChange={e => set({ effort: e.target.value || null })}
                  className={fieldCls}
                >
                  <option value="">
                    Default ({EFFORT_LABELS[options.defaults.effort] ?? options.defaults.effort})
                  </option>
                  {options.efforts.map(ef => (
                    <option key={ef} value={ef}>{EFFORT_LABELS[ef] ?? ef}</option>
                  ))}
                </select>
              </label>

              <label className="block">
                <span className={labelCls}>Experience preset</span>
                <select
                  value={value.preset ?? ''}
                  onChange={e => set({ preset: e.target.value || null })}
                  className={fieldCls}
                >
                  <option value="">Default ({options.defaults.preset})</option>
                  {options.presets.map(p => (
                    <option key={p.name} value={p.name} title={p.description}>
                      {p.name}
                    </option>
                  ))}
                </select>
                {value.preset && (
                  <span className="mt-1 block text-[10px] leading-snug text-ink-faint">
                    {options.presets.find(p => p.name === value.preset)?.description}
                  </span>
                )}
              </label>

              <label className="block">
                <span className={labelCls}>Excerpts (background prose)</span>
                <select
                  value={value.excerpts ?? ''}
                  onChange={e => set({ excerpts: e.target.value ? Number(e.target.value) : null })}
                  className={fieldCls}
                >
                  <option value="">Default (per persona)</option>
                  {Array.from(
                    { length: (options.excerpts?.max ?? 17) - (options.excerpts?.min ?? 1) + 1 },
                    (_, i) => (options.excerpts?.min ?? 1) + i,
                  ).map(n => (
                    <option key={n} value={n}>{n}</option>
                  ))}
                </select>
                <span className="mt-1 block text-[10px] leading-snug text-ink-faint">
                  How many passages of earlier manuscript the reviewer reads
                  alongside the chapter.
                </span>
              </label>

              {customized && (
                <button
                  onClick={() => set({ model: null, effort: null, preset: null, excerpts: null })}
                  className="self-start text-[10px] text-ink-faint underline-offset-2 hover:text-ink hover:underline transition"
                >
                  Reset to defaults
                </button>
              )}

              <p className="text-[10px] leading-snug text-ink-faint">
                Applies to the next run. Changing model or preset re-writes the
                prompt cache once, so the first run after a switch costs a bit
                more.
              </p>
            </div>
          )}
        </div>,
        document.body,
      )}
    </>
  )
}
