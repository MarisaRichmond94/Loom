'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { LuSave, LuTriangleAlert, LuX } from 'react-icons/lu'

// Export-to-Pages modal. The writer picks the context the manuscript should
// be flattened under — variables default to the series defaults, which is
// canon — and settles any choice points the walk can't resolve from the
// variables alone. A dry-run plan refreshes on every change so downstream
// consequences (chapters appearing/disappearing, new choice points) are
// visible before the export runs.

type Variable = { id: string; name: string; type: string; defaultValue: string }

type PlanChoice = { id: string; label: string; isBadEnding: boolean }
type PlanChoicePoint = {
  choicePointId: string
  chapterLabel: string
  prompt: string | null
  choices: PlanChoice[]
  resolvedChoiceId: string | null
  ambiguous: boolean
}
type Plan = { choicePoints: PlanChoicePoint[]; warnings: string[]; chapterCount: number }

type Props = {
  seriesId: string
  bookId: string
  bookTitle: string
  onClose: () => void
}

function parseDefault(v: Variable): string {
  try {
    const parsed = JSON.parse(v.defaultValue)
    return parsed === null ? '' : String(parsed)
  } catch {
    return ''
  }
}

export default function ExportBookModal({ seriesId, bookId, bookTitle, onClose }: Props) {
  const [variables, setVariables] = useState<Variable[]>([])
  const [varsLoaded, setVarsLoaded] = useState(false)
  const [values, setValues] = useState<Record<string, string>>({})
  const [overrides, setOverrides] = useState<Record<string, string>>({})
  const [plan, setPlan] = useState<Plan | null>(null)
  const [format, setFormat] = useState<'pages' | 'docx'>('pages')
  const [exporting, setExporting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  // Guards against out-of-order plan responses.
  const planSeq = useRef(0)

  useEffect(() => {
    fetch(`/api/series/${seriesId}/variables`)
      .then(r => r.ok ? r.json() : [])
      .then((vars: Variable[]) => {
        setVariables(vars)
        setValues(Object.fromEntries(vars.map(v => [v.name, parseDefault(v)])))
        setVarsLoaded(true)
      })
  }, [seriesId])

  const targetState = useMemo(() => {
    const out: Record<string, unknown> = {}
    for (const v of variables) {
      const raw = values[v.name]
      if (raw === undefined || raw === '') continue
      out[v.name] = v.type === 'boolean' ? raw === 'true' : v.type === 'number' ? Number(raw) : raw
    }
    return out
  }, [variables, values])

  const refreshPlan = useCallback(async (state: Record<string, unknown>, picks: Record<string, string>) => {
    const seq = ++planSeq.current
    const res = await fetch(`/api/series/${seriesId}/books/${bookId}/export/plan`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ targetState: state, choiceOverrides: picks }),
    })
    if (!res.ok || seq !== planSeq.current) return
    setPlan(await res.json())
  }, [seriesId, bookId])

  useEffect(() => {
    // Wait for variables so the first plan reflects canon defaults.
    if (!varsLoaded) return
    refreshPlan(targetState, overrides)
  }, [varsLoaded, targetState, overrides, refreshPlan])

  // A point stays unresolved until the writer explicitly picks — checked
  // against local overrides too so the button enables without waiting for
  // the plan round-trip.
  const unresolvedCount = plan?.choicePoints.filter(cp => cp.ambiguous && !overrides[cp.choicePointId]).length ?? 0

  async function handleExport() {
    setExporting(true)
    setError(null)
    try {
      const res = await fetch(`/api/series/${seriesId}/books/${bookId}/export/pages`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ targetState, choiceOverrides: overrides, format }),
      })
      if (!res.ok) {
        const payload = await res.json().catch(() => null)
        setError(payload?.error ?? 'Export failed.')
        return
      }
      const blob = await res.blob()
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = `${bookTitle}.${format}`
      a.click()
      URL.revokeObjectURL(url)
      onClose()
    } finally {
      setExporting(false)
    }
  }

  return (
    <div
      className="fixed inset-0 bg-black/60 flex items-start justify-center z-50"
      style={{ paddingTop: 'calc(60px + 6vh)', paddingLeft: '14rem' }}
      onClick={onClose}
    >
      <div
        className="bg-surface-raised border border-accent/20 rounded-xl max-w-lg w-full mx-8 shadow-2xl relative flex flex-col max-h-[calc(100vh-12vh-60px)]"
        onClick={e => e.stopPropagation()}
      >
        <div className="shrink-0 px-8 pt-7 pb-4 border-b border-accent/10">
          <button onClick={onClose} className="absolute top-4 right-4 text-ink-faint hover:text-ink transition">
            <LuX size={16} />
          </button>
          {/* "Save" throughout, matching the button that opens this. Backup is
              reserved for .loom.json data — see the note on the book page.
              (KAN-19 first split these as Export/Download; they shared a
              download icon and read as synonyms, so KAN-20 renamed them to
              Backup/Save with distinct icons.) */}
          <h2 className="text-base font-bold text-ink">Save &ldquo;{bookTitle}&rdquo;</h2>
          <p className="text-xs text-ink-faint mt-1.5 leading-relaxed">
            Flattens the book into a single Pages manuscript using the context
            below. The defaults are your canon values — change them to produce
            an alternate version.
          </p>
        </div>

        <div className="flex-1 min-h-0 px-8 py-5 flex flex-col gap-5">
          {/* Context variables — top half, scrolls on its own */}
          <div className="flex-1 basis-1/2 min-h-0 flex flex-col">
            <h3 className="shrink-0 text-xs uppercase tracking-widest text-ink-faint mb-3">Context</h3>
            {variables.length === 0 ? (
              <p className="text-xs text-ink-faint italic">This series has no context variables.</p>
            ) : (
              <div className="flex-1 min-h-0 overflow-y-auto flex flex-col gap-2 pr-1">
                {variables.map(v => (
                  <div key={v.id} className="flex items-center gap-3">
                    <span className="text-sm text-ink flex-1 truncate font-mono">{v.name}</span>
                    {v.type === 'boolean' ? (
                      <select
                        value={values[v.name] ?? ''}
                        onChange={e => setValues(s => ({ ...s, [v.name]: e.target.value }))}
                        className="w-32 bg-surface-overlay border border-accent/20 rounded px-2 py-1.5 text-xs text-ink outline-none focus:border-accent"
                      >
                        <option value="">— unset —</option>
                        <option value="true">true</option>
                        <option value="false">false</option>
                      </select>
                    ) : (
                      <input
                        type={v.type === 'number' ? 'number' : 'text'}
                        value={values[v.name] ?? ''}
                        onChange={e => setValues(s => ({ ...s, [v.name]: e.target.value }))}
                        placeholder="unset"
                        className="w-32 bg-surface-overlay border border-accent/20 rounded px-2 py-1.5 text-xs text-ink outline-none focus:border-accent"
                      />
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Choice points — bottom half, scrolls on its own */}
          {plan && plan.choicePoints.length > 0 && (
            <div className="flex-1 basis-1/2 min-h-0 flex flex-col">
              <h3 className="shrink-0 text-xs uppercase tracking-widest text-ink-faint mb-1">Branches</h3>
              <p className="shrink-0 text-[11px] text-ink-faint italic mb-3">
                Each choice point collapses to one branch in the manuscript.
                Branches matching your context are pre-selected
                {unresolvedCount > 0 && '; the highlighted ones need your call'}.
              </p>
              <div className="flex-1 min-h-0 overflow-y-auto flex flex-col gap-3 pr-1">
                {plan.choicePoints.map(cp => {
                  // An ambiguous point stays on the placeholder until the
                  // writer explicitly picks — showing the walk's fallback
                  // here would look chosen while the export stays blocked.
                  const selected = overrides[cp.choicePointId]
                    ?? (cp.ambiguous ? '' : cp.resolvedChoiceId ?? '')
                  return (
                    <div
                      key={cp.choicePointId}
                      className={`rounded-lg border px-3 py-2.5 ${cp.ambiguous ? 'border-accent/60 bg-accent/5' : 'border-accent/10 bg-surface-overlay/50'}`}
                    >
                      <p className="text-[11px] text-ink-faint mb-0.5">{cp.chapterLabel}</p>
                      {cp.prompt && <p className="text-xs text-ink-muted italic mb-1.5">{cp.prompt}</p>}
                      <select
                        value={selected}
                        onChange={e => setOverrides(s => ({ ...s, [cp.choicePointId]: e.target.value }))}
                        className="w-full bg-surface-base border border-accent/20 rounded px-2 py-1.5 text-xs text-ink outline-none focus:border-accent"
                      >
                        {cp.ambiguous && !overrides[cp.choicePointId] && <option value="">— pick a branch —</option>}
                        {cp.choices.map(c => (
                          <option key={c.id} value={c.id}>
                            {c.label}{c.isBadEnding ? ' ⚠ bad ending' : ''}
                          </option>
                        ))}
                      </select>
                    </div>
                  )
                })}
              </div>
            </div>
          )}

          {/* Warnings */}
          {plan && plan.warnings.length > 0 && (
            <div className="shrink-0 rounded-lg border border-accent/30 bg-accent/5 px-3 py-2.5 flex flex-col gap-1">
              {plan.warnings.map((w, i) => (
                <p key={i} className="text-[11px] text-ink-muted flex items-start gap-1.5">
                  <LuTriangleAlert size={12} className="shrink-0 mt-0.5 text-accent" /> {w}
                </p>
              ))}
            </div>
          )}
        </div>

        <div className="shrink-0 px-8 py-4 border-t border-accent/10 flex items-center justify-between gap-3">
          <div className="flex items-center gap-3 text-xs text-ink-muted">
            <select
              value={format}
              onChange={e => setFormat(e.target.value as 'pages' | 'docx')}
              className="bg-surface-overlay border border-accent/20 rounded px-2 py-1.5 text-xs text-ink outline-none focus:border-accent"
            >
              <option value="pages">Pages (.pages)</option>
              <option value="docx">Word (.docx)</option>
            </select>
            {plan && <span className="text-ink-faint italic">{plan.chapterCount} chapter{plan.chapterCount === 1 ? '' : 's'}</span>}
          </div>
          <div className="flex items-center gap-2">
            {error && <span className="text-xs text-choice-kill max-w-48 truncate" title={error}>{error}</span>}
            <button onClick={onClose} className="px-4 py-2 rounded-lg text-ink-muted text-sm hover:text-ink transition">Cancel</button>
            <button
              onClick={handleExport}
              disabled={exporting || unresolvedCount > 0}
              title={unresolvedCount > 0 ? 'Pick a branch for the highlighted choice points first' : undefined}
              className="flex items-center gap-1.5 px-4 py-2 rounded-lg bg-accent text-white text-sm font-semibold hover:opacity-90 transition disabled:opacity-50"
            >
              {/* Matches the "Save" button that opens this modal — the CTA
                  should say what the button the writer pressed said. */}
              <LuSave size={14} /> {exporting ? 'Saving…' : 'Save'}
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
