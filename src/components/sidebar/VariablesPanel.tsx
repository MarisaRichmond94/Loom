'use client'

import { useState } from 'react'
import { LuPencil, LuX, LuEye, LuArrowUpDown, LuArrowRightToLine, LuRotateCcw } from 'react-icons/lu'

type Variable = { id: string; name: string; type: string; defaultValue: string }
type Chapter = { bookId: string; bookTitle: string; bookOrder: number; chapterId: string; chapterTitle: string; chapterOrder: number; count: number }
type UsageCounts = { conditions: number; text: number; total: number; chapters: Chapter[]; originBook: string | null }
type SortMode = 'occurrence' | 'usage' | 'alpha'
type Props = {
  seriesId: string
  variables: Variable[]
  onAdd: (name: string, type: string, defaultValue: unknown) => void
  onUpdate: (id: string, data: { name?: string; type?: string; defaultValue?: unknown }) => void
  onDelete: (id: string) => void
}

const TYPE_DEFAULTS: Record<string, unknown> = { boolean: false, number: 0, string: '' }
const TYPE_SHORT: Record<string, string> = { boolean: 'bool', number: 'num', string: 'str' }
const SORT_CYCLE: SortMode[] = ['occurrence', 'usage', 'alpha']
const SORT_LABEL: Record<SortMode, string> = {
  occurrence: 'sort by occurrence',
  usage: 'sort by usage',
  alpha: 'sort alphabetically',
}

function parseDefault(raw: string): unknown {
  try { return JSON.parse(raw) } catch { return null }
}

function DefaultInput({ type, value, onChange }: { type: string; value: unknown; onChange: (v: unknown) => void }) {
  // w-full so every default field fills its column slot uniformly,
  // regardless of type. The parent table cell wraps it in a flex row
  // so the optional Save button stays inline beside the field.
  const baseCls = 'w-full bg-surface-base border border-accent/20 rounded px-2 py-1 text-xs text-ink outline-none focus:border-accent'
  if (type === 'boolean') {
    return (
      <select
        value={value === true ? 'true' : 'false'}
        onChange={e => onChange(e.target.value === 'true')}
        className={baseCls}
      >
        <option value="false">false</option>
        <option value="true">true</option>
      </select>
    )
  }
  if (type === 'number') {
    return (
      <input
        type="number"
        value={typeof value === 'number' ? value : 0}
        onChange={e => onChange(e.target.value === '' ? 0 : Number(e.target.value))}
        className={baseCls}
      />
    )
  }
  return (
    <input
      type="text"
      value={typeof value === 'string' ? value : ''}
      onChange={e => onChange(e.target.value)}
      placeholder="(empty)"
      className={`${baseCls} placeholder:text-ink-faint`}
    />
  )
}

export default function VariablesPanel({ seriesId, variables, onAdd, onUpdate, onDelete }: Props) {
  const [name, setName] = useState('')
  const [type, setType] = useState('boolean')
  const [defaultValue, setDefaultValue] = useState<unknown>(false)
  const [showForm, setShowForm] = useState(false)
  const [editOpen, setEditOpen] = useState(false)
  // Local draft state for the modal: id → { name, type, defaultValue }
  const [drafts, setDrafts] = useState<Record<string, { name: string; type: string; defaultValue: unknown }>>({})
  // Per-variable usage data loaded when the modal opens. Keyed by
  // variable NAME (matches what the server emits) — id-keyed would
  // require a join client-side.
  const [usage, setUsage] = useState<Record<string, UsageCounts> | null>(null)
  const [sortMode, setSortMode] = useState<SortMode>('occurrence')
  // When set, the modal is in the per-variable drill-in view showing
  // every chapter that references this variable.
  const [drillVarName, setDrillVarName] = useState<string | null>(null)

  function openEdit() {
    const initial: Record<string, { name: string; type: string; defaultValue: unknown }> = {}
    variables.forEach(v => { initial[v.id] = { name: v.name, type: v.type, defaultValue: parseDefault(v.defaultValue) } })
    setDrafts(initial)
    setEditOpen(true)
    setUsage(null)
    // Reset to the default sort + overview view every time the modal opens.
    setSortMode('occurrence')
    setDrillVarName(null)
    fetch(`/api/series/${seriesId}/variable-usage`)
      .then(r => r.ok ? r.json() : null)
      .then(setUsage)
      .catch(() => setUsage(null))
  }

  function cycleSort() {
    const idx = SORT_CYCLE.indexOf(sortMode)
    setSortMode(SORT_CYCLE[(idx + 1) % SORT_CYCLE.length])
  }

  function navigateToChapter(bookId: string, chapterId: string) {
    // Open in a new tab so the writer doesn't lose their current
    // context (and the modal's loaded usage data) just to peek at
    // where a variable is referenced. noopener prevents the new tab
    // from gaining a reference back to this window.
    window.open(`/author/${seriesId}/chapter/${chapterId}`, '_blank', 'noopener')
    void bookId  // routed by chapter directly
  }

  function handleAdd(e: React.FormEvent) {
    e.preventDefault()
    if (!name.trim()) return
    onAdd(name.trim(), type, defaultValue)
    setName('')
    setDefaultValue(TYPE_DEFAULTS[type])
    setShowForm(false)
  }

  function changeType(newType: string) {
    setType(newType)
    setDefaultValue(TYPE_DEFAULTS[newType])
  }

  function saveDraftDefault(id: string) {
    const draft = drafts[id]
    const original = variables.find(v => v.id === id)
    if (!draft || !original) return
    if (JSON.stringify(draft.defaultValue) === original.defaultValue) return
    onUpdate(id, { defaultValue: draft.defaultValue })
  }

  return (
    <div className="flex flex-col flex-1 min-h-0">
      {/* Heading with hover pencil */}
      <div className="flex items-center gap-2 mb-2 shrink-0 group/heading">
        <div className="text-xs uppercase tracking-widest text-ink-faint">Context</div>
        {variables.length > 0 && (
          <button
            onClick={openEdit}
            className="text-ink-faint hover:text-ink transition opacity-0 group-hover/heading:opacity-100"
            title="Edit context variables"
          >
            <LuPencil size={12} />
          </button>
        )}
      </div>

      {/* Scrollable variable list */}
      <div className="flex-1 overflow-y-auto min-h-0">
        <div className="flex flex-col gap-1">
          {variables.map(v => (
            <div key={v.id} className="flex items-center gap-2 px-2 py-1" title={v.name}>
              <span className="font-mono text-xs text-accent flex-1 min-w-0 truncate">{v.name}</span>
              <span className="shrink-0 text-xs bg-accent/20 text-accent rounded-full px-2 py-0.5 leading-none">
                {TYPE_SHORT[v.type] ?? v.type}
              </span>
            </div>
          ))}
        </div>
      </div>

      {/* Add form / button — fixed at bottom */}
      <div className="shrink-0 pt-2">
      {showForm ? (
        <form onSubmit={handleAdd} className="flex flex-col gap-2">
          <input
            autoFocus
            value={name}
            onChange={e => setName(e.target.value)}
            onKeyDown={e => e.key === 'Escape' && setShowForm(false)}
            placeholder="Variable name"
            className="w-full bg-surface-base border border-accent/20 rounded px-2 py-1 text-xs text-ink placeholder:text-ink-faint outline-none focus:border-accent font-mono"
          />
          <select
            value={type}
            onChange={e => changeType(e.target.value)}
            className="w-full bg-surface-base border border-accent/20 rounded px-2 py-1 text-xs text-ink outline-none focus:border-accent"
          >
            <option value="string">String</option>
            <option value="number">Number</option>
            <option value="boolean">Boolean</option>
          </select>
          <div className="flex items-center gap-2">
            <span className="text-xs text-ink-faint shrink-0">Default:</span>
            <DefaultInput type={type} value={defaultValue} onChange={setDefaultValue} />
          </div>
          <div className="flex gap-1">
            <button type="submit" className="flex-1 py-1 rounded text-xs bg-accent text-white font-medium hover:opacity-90 transition">Add</button>
            <button type="button" onClick={() => setShowForm(false)} className="flex-1 py-1 rounded text-xs text-ink-faint hover:text-ink transition">Cancel</button>
          </div>
        </form>
      ) : (
        <button
          onClick={() => { setShowForm(true); setDefaultValue(TYPE_DEFAULTS[type]) }}
          className="w-full py-1 rounded text-xs bg-accent text-white font-medium hover:opacity-90 transition"
        >
          Add Context
        </button>
      )}
      </div>

      {/* Context modal — overview table by default, drill-in view per
          variable when the eye action is clicked on a row. */}
      {editOpen && (
        <div
          className="fixed inset-0 bg-black/60 flex items-center justify-center z-50"
          onClick={() => setEditOpen(false)}
        >
          <div
            className="bg-surface-raised border border-accent/20 rounded-xl p-6 w-full max-w-3xl mx-4 shadow-2xl flex flex-col max-h-[70vh]"
            onClick={e => e.stopPropagation()}
          >
            {drillVarName
              ? renderDrillIn(drillVarName)
              : renderOverview()}
          </div>
        </div>
      )}
    </div>
  )

  function renderOverview() {
    // Sort the variables list per the current sort mode. Occurrence =
    // creation order, which is what the variables prop already gives us
    // (the layout sorts by id ascending = cuid is timestamp-prefixed).
    const sorted = (() => {
      if (sortMode === 'alpha') return [...variables].sort((a, b) => a.name.localeCompare(b.name))
      if (sortMode === 'usage') {
        return [...variables].sort((a, b) => (usage?.[b.name]?.total ?? 0) - (usage?.[a.name]?.total ?? 0))
      }
      return variables
    })()
    return (
      <>
        <div className="flex items-center justify-between mb-4 shrink-0">
          <h2 className="text-sm font-semibold text-ink uppercase tracking-widest">Context</h2>
          <button onClick={() => setEditOpen(false)} className="text-ink-faint hover:text-ink"><LuX size={16} /></button>
        </div>

        {variables.length === 0 ? (
          <p className="text-xs text-ink-faint italic text-center py-4">No context variables yet.</p>
        ) : (
          <>
            {/* Show what clicking will do (the *next* mode), not the
                current mode. The default visible state is the
                occurrence sort, so the button reads "sort by usage"
                until the writer engages with it. */}
            {(() => {
              const next = SORT_CYCLE[(SORT_CYCLE.indexOf(sortMode) + 1) % SORT_CYCLE.length]
              return (
                <button
                  onClick={cycleSort}
                  className="self-start flex items-center gap-1.5 text-xs text-ink-muted hover:text-ink transition mb-2"
                  title="Cycle sort order"
                >
                  <LuArrowUpDown size={12} /> {SORT_LABEL[next]}
                </button>
              )
            })()}

            <div className="overflow-y-auto min-h-0 -mr-3 pr-3 border border-accent/10 rounded-lg">
              <table className="w-full text-xs">
                <thead className="bg-surface-overlay sticky top-0 z-10">
                  <tr className="text-ink-faint uppercase tracking-widest">
                    <th className="text-left font-medium px-3 py-2.5">Name</th>
                    <th className="text-left font-medium px-2 py-2.5">Type</th>
                    <th className="text-left font-medium px-2 py-2.5">Origin</th>
                    <th className="text-left font-medium px-2 py-2.5">Default</th>
                    <th className="text-left font-medium px-2 py-2.5">Usage</th>
                    <th className="px-2 py-2.5 w-16" />
                  </tr>
                </thead>
                <tbody>
                  {sorted.map(v => {
                    const draft = drafts[v.id] ?? { name: v.name, type: v.type, defaultValue: parseDefault(v.defaultValue) }
                    const counts = usage?.[v.name]
                    const usageText = usage == null ? '…' : counts?.total ?? 0
                    const usageTitle = counts
                      ? `Conditions: ${counts.conditions} · Text/templates: ${counts.text}`
                      : 'Loading usage…'
                    return (
                      <tr key={v.id} className="border-t border-accent/10 group/row hover:bg-surface-overlay/40 transition">
                        <td className="px-3 py-2 text-ink font-mono max-w-[220px]">
                          <span title={v.name} className="block truncate">{v.name}</span>
                        </td>
                        <td className="px-2 py-2">
                          <span
                            title="Type is locked — changing it would invalidate existing references"
                            className="inline-block text-[10px] uppercase tracking-widest bg-accent/15 text-accent rounded-full px-2 py-0.5 cursor-help"
                          >
                            {TYPE_SHORT[v.type] ?? v.type}
                          </span>
                        </td>
                        <td className="px-2 py-2 text-ink-muted max-w-[140px]">
                          {counts?.originBook
                            ? <span title={counts.originBook} className="block truncate">{counts.originBook}</span>
                            : <span className="text-ink-faint">—</span>}
                        </td>
                        <td className="px-2 py-2">
                          <div className="flex items-center gap-2">
                            <div className="flex-1 min-w-0">
                              <DefaultInput
                                type={draft.type}
                                value={draft.defaultValue}
                                onChange={val => {
                                  setDrafts(d => ({ ...d, [v.id]: { ...draft, defaultValue: val } }))
                                  if (draft.type === 'boolean') onUpdate(v.id, { defaultValue: val })
                                }}
                              />
                            </div>
                            {draft.type !== 'boolean' && (
                              <button
                                onClick={() => saveDraftDefault(v.id)}
                                className="shrink-0 text-[10px] text-ink-faint hover:text-ink transition"
                                title="Save default"
                              >
                                Save
                              </button>
                            )}
                          </div>
                        </td>
                        <td className="px-2 py-2 text-ink-muted" title={usageTitle}>{usageText}</td>
                        <td className="px-2 py-2">
                          <div className="flex items-center gap-2 justify-end opacity-0 group-hover/row:opacity-100 transition">
                            <button
                              onClick={() => setDrillVarName(v.name)}
                              disabled={!counts || counts.total === 0}
                              className="text-ink-faint hover:text-ink transition disabled:opacity-30 disabled:cursor-not-allowed"
                              title={counts && counts.total > 0 ? 'View usages' : 'No usages yet'}
                            >
                              <LuEye size={14} />
                            </button>
                            <button
                              onClick={() => onDelete(v.id)}
                              className="text-ink-faint hover:text-choice-kill transition"
                              title="Delete"
                            >
                              <LuX size={14} />
                            </button>
                          </div>
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          </>
        )}
      </>
    )
  }

  function renderDrillIn(varName: string) {
    const counts = usage?.[varName]
    const total = counts?.total ?? 0
    const chapters = counts?.chapters ?? []
    return (
      <>
        <div className="flex items-center justify-between mb-4 shrink-0">
          <div className="flex items-center gap-3 min-w-0">
            <h2 className="text-sm font-semibold text-ink font-mono truncate" title={varName}>{varName}</h2>
            <span className="shrink-0 text-[10px] uppercase tracking-widest bg-accent/15 text-accent rounded-full px-2 py-0.5">
              {total === 1 ? '1 usage' : `${total} usages`}
            </span>
          </div>
          <button onClick={() => setEditOpen(false)} className="text-ink-faint hover:text-ink"><LuX size={16} /></button>
        </div>

        {chapters.length === 0 ? (
          <p className="text-xs text-ink-faint italic text-center py-4">No chapters reference this variable.</p>
        ) : (
          <div className="overflow-y-auto min-h-0 -mr-3 pr-3 border border-accent/10 rounded-lg">
            <table className="w-full text-xs">
              <thead className="bg-surface-overlay sticky top-0 z-10">
                <tr className="text-ink-faint uppercase tracking-widest">
                  <th className="text-left font-medium px-3 py-2.5">Book</th>
                  <th className="text-left font-medium px-2 py-2.5">Chapter</th>
                  <th className="text-left font-medium px-2 py-2.5">Count</th>
                  <th className="px-2 py-2.5 w-12" />
                </tr>
              </thead>
              <tbody>
                {chapters.map(c => (
                  <tr key={c.chapterId} className="border-t border-accent/10 group/row hover:bg-surface-overlay/40 transition">
                    <td className="px-3 py-2 text-ink">{c.bookTitle}</td>
                    <td className="px-2 py-2 text-ink-muted">{c.chapterTitle}</td>
                    <td className="px-2 py-2 text-ink-muted">{c.count}</td>
                    <td className="px-2 py-2 text-right">
                      <button
                        onClick={() => navigateToChapter(c.bookId, c.chapterId)}
                        className="opacity-0 group-hover/row:opacity-100 text-ink-faint hover:text-ink transition"
                        title={`Open ${c.chapterTitle}`}
                      >
                        <LuArrowRightToLine size={14} />
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        <button
          onClick={() => setDrillVarName(null)}
          className="self-end mt-3 flex items-center gap-1.5 text-xs text-ink-muted hover:text-ink transition"
        >
          <LuRotateCcw size={12} /> return to all context
        </button>
      </>
    )
  }
}
