'use client'

import { useState } from 'react'
import { LuPencil, LuX, LuEye, LuArrowUpDown, LuArrowRightToLine, LuRotateCcw, LuSearch } from 'react-icons/lu'

type Variable = { id: string; name: string; type: string; defaultValue: string }
type Chapter = { bookId: string; bookTitle: string; bookOrder: number; chapterId: string; chapterTitle: string; chapterOrder: number; count: number; firstBlockId: string | null }
type Origin = {
  bookTitle: string
  chapterId: string
  chapterTitle: string
  blockId: string | null
}
type UsageCounts = {
  conditions: number; text: number; total: number
  chapters: Chapter[]       // read-only locations — drives drill-in
  writeChapters: Chapter[]  // write locations — surfaced in delete confirmation alongside reads
  origin: Origin | null
  // First time the variable appears in the natural book/chapter walk;
  // drives the modal's default "occurrence" sort. Null when the variable
  // is entirely unreferenced — those sort last in stable creation order.
  firstAppearance: { bookOrder: number; chapterOrder: number } | null
}
// Modal view variant. The single source of truth replaces the older
// `drillVarName` boolean-ish so transitions are explicit and we can't
// land in two views at once.
type ModalView =
  | { kind: 'overview' }
  | { kind: 'drill'; name: string }
  | { kind: 'confirmDelete'; name: string }
type SortMode = 'occurrence' | 'usage' | 'alpha'
type Props = {
  seriesId: string
  variables: Variable[]
  onUpdate: (id: string, data: { name?: string; type?: string; defaultValue?: unknown }) => void
  onDelete: (id: string) => void
}

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

export default function VariablesPanel({ seriesId, variables, onUpdate, onDelete }: Props) {
  const [editOpen, setEditOpen] = useState(false)
  // Local draft state for the modal: id → { name, type, defaultValue }
  const [drafts, setDrafts] = useState<Record<string, { name: string; type: string; defaultValue: unknown }>>({})
  // Per-variable usage data loaded when the modal opens. Keyed by
  // variable NAME (matches what the server emits) — id-keyed would
  // require a join client-side.
  const [usage, setUsage] = useState<Record<string, UsageCounts> | null>(null)
  const [sortMode, setSortMode] = useState<SortMode>('occurrence')
  // Substring search across variable names — case-insensitive, applied
  // after sorting so the order the writer chose is preserved within
  // the filtered subset. Reset whenever the modal is opened so a
  // stale query doesn't hide rows on the next visit.
  const [searchQuery, setSearchQuery] = useState('')
  // Single source of truth for which sub-view the modal is in. Always
  // resets to 'overview' on open.
  const [view, setView] = useState<ModalView>({ kind: 'overview' })

  function openEdit() {
    const initial: Record<string, { name: string; type: string; defaultValue: unknown }> = {}
    variables.forEach(v => { initial[v.id] = { name: v.name, type: v.type, defaultValue: parseDefault(v.defaultValue) } })
    setDrafts(initial)
    setEditOpen(true)
    setUsage(null)
    // Reset to the default sort + overview view + empty search every
    // time the modal opens.
    setSortMode('occurrence')
    setSearchQuery('')
    setView({ kind: 'overview' })
    fetch(`/api/series/${seriesId}/variable-usage`)
      .then(r => r.ok ? r.json() : null)
      .then(setUsage)
      .catch(() => setUsage(null))
  }

  function cycleSort() {
    const idx = SORT_CYCLE.indexOf(sortMode)
    setSortMode(SORT_CYCLE[(idx + 1) % SORT_CYCLE.length])
  }

  function navigateToChapter(bookId: string, chapterId: string, blockId: string | null = null) {
    // Open in a new tab so the writer doesn't lose their current
    // context (and the modal's loaded usage data) just to peek at
    // where a variable is referenced. noopener prevents the new tab
    // from gaining a reference back to this window. `?block=` deep-
    // links to the first block in that chapter where the variable
    // appears, picked up by BlockEditor's scroll-into-view effect.
    const suffix = blockId ? `?block=${blockId}` : ''
    window.open(`/author/${seriesId}/chapter/${chapterId}${suffix}`, '_blank', 'noopener')
    void bookId  // routed by chapter directly
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
            {view.kind === 'drill' ? renderDrillIn(view.name)
              : view.kind === 'confirmDelete' ? renderConfirmDelete(view.name)
              : renderOverview()}
          </div>
        </div>
      )}
    </div>
  )

  function renderOverview() {
    // Sort the variables list per the current sort mode. Occurrence =
    // first appearance in the natural book/chapter walk (earliest write
    // wins, falls back to earliest read), so renaming a variable mid-book
    // still puts it where the writer expects to see it. Variables with no
    // references sort last in stable creation order — the cuid ordering
    // the layout already provides via `orderBy: { id: 'asc' }`.
    const sorted = (() => {
      if (sortMode === 'alpha') return [...variables].sort((a, b) => a.name.localeCompare(b.name))
      if (sortMode === 'usage') {
        return [...variables].sort((a, b) => (usage?.[b.name]?.total ?? 0) - (usage?.[a.name]?.total ?? 0))
      }
      return [...variables].sort((a, b) => {
        const fa = usage?.[a.name]?.firstAppearance
        const fb = usage?.[b.name]?.firstAppearance
        if (fa && fb) {
          if (fa.bookOrder !== fb.bookOrder) return fa.bookOrder - fb.bookOrder
          if (fa.chapterOrder !== fb.chapterOrder) return fa.chapterOrder - fb.chapterOrder
          return a.id.localeCompare(b.id)
        }
        // Unreferenced variables fall to the bottom; sort stably among themselves.
        if (!fa && !fb) return a.id.localeCompare(b.id)
        return fa ? -1 : 1
      })
    })()
    const q = searchQuery.trim().toLowerCase()
    const visible = q ? sorted.filter(v => v.name.toLowerCase().includes(q)) : sorted
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
            <div className="flex items-center gap-3 mb-2">
              {/* Show what clicking will do (the *next* mode), not the
                  current mode. The default visible state is the
                  occurrence sort, so the button reads "sort by usage"
                  until the writer engages with it. */}
              {(() => {
                const next = SORT_CYCLE[(SORT_CYCLE.indexOf(sortMode) + 1) % SORT_CYCLE.length]
                return (
                  <button
                    onClick={cycleSort}
                    className="shrink-0 flex items-center gap-1.5 text-xs text-ink-muted hover:text-ink transition"
                    title="Cycle sort order"
                  >
                    <LuArrowUpDown size={12} /> {SORT_LABEL[next]}
                  </button>
                )
              })()}
              <div className="relative flex-1 max-w-xs ml-auto">
                <LuSearch size={12} className="absolute left-2 top-1/2 -translate-y-1/2 text-ink-faint pointer-events-none" />
                <input
                  value={searchQuery}
                  onChange={e => setSearchQuery(e.target.value)}
                  placeholder="Search context…"
                  className="w-full pl-7 pr-7 py-1 text-xs bg-surface-base border border-accent/20 rounded text-ink placeholder:text-ink-faint outline-none focus:border-accent/50"
                />
                {searchQuery && (
                  <button
                    onClick={() => setSearchQuery('')}
                    className="absolute right-1.5 top-1/2 -translate-y-1/2 text-ink-faint hover:text-ink p-0.5"
                    title="Clear search"
                  >
                    <LuX size={11} />
                  </button>
                )}
              </div>
            </div>

            <div className="overflow-y-auto min-h-0 border border-accent/10 rounded-lg">
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
                  {visible.length === 0 && searchQuery.trim() && (
                    <tr>
                      <td colSpan={5} className="px-3 py-6 text-xs text-ink-faint italic text-center">
                        No context matches &quot;{searchQuery.trim()}&quot;.
                      </td>
                    </tr>
                  )}
                  {visible.map(v => {
                    const draft = drafts[v.id] ?? { name: v.name, type: v.type, defaultValue: parseDefault(v.defaultValue) }
                    const counts = usage?.[v.name]
                    const usageText = usage == null ? '…' : counts?.total ?? 0
                    const writeCount = counts?.writeChapters.reduce((sum, c) => sum + c.count, 0) ?? 0
                    const usageTitle = counts
                      ? `Conditions: ${counts.conditions} · Text/templates: ${counts.text} · Writes: ${writeCount}`
                      : 'Loading usage…'
                    // Row-level click drills in (same target as the eye
                    // action). Disabled when there are no usages —
                    // matches the eye button's disabled state. Writes
                    // count too: a write-only variable (e.g. a counter
                    // that's set but never read back in a condition or
                    // template) should still be drillable so its write
                    // sites are reachable. The Default and action cells
                    // stop propagation so their own controls (input,
                    // save, eye, delete) run without also triggering
                    // the drill.
                    const canDrill = !!counts && (counts.total > 0 || counts.writeChapters.length > 0)
                    return (
                      <tr
                        key={v.id}
                        onClick={canDrill ? () => setView({ kind: 'drill', name: v.name }) : undefined}
                        className={`border-t border-accent/10 group/row hover:bg-surface-overlay/40 transition ${canDrill ? 'cursor-pointer' : ''}`}
                      >
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
                        <td className="px-2 py-2 text-ink-muted max-w-[180px]" onClick={e => e.stopPropagation()}>
                          {counts?.origin ? (() => {
                            const label = `${counts.origin.bookTitle} — ${counts.origin.chapterTitle}`
                            const href = `/author/${seriesId}/chapter/${counts.origin.chapterId}${counts.origin.blockId ? `?block=${counts.origin.blockId}` : ''}`
                            return (
                              <a
                                href={href}
                                target="_blank"
                                rel="noopener noreferrer"
                                title={label}
                                className="block truncate text-accent hover:underline"
                              >
                                {label}
                              </a>
                            )
                          })() : (
                            <span className="text-ink-faint">—</span>
                          )}
                        </td>
                        <td className="px-2 py-2" onClick={e => e.stopPropagation()}>
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
                        <td className="px-2 py-2" onClick={e => e.stopPropagation()}>
                          <div className="flex items-center gap-2 justify-end opacity-0 group-hover/row:opacity-100 transition">
                            <button
                              onClick={() => setView({ kind: 'drill', name: v.name })}
                              disabled={!canDrill}
                              className="text-ink-faint hover:text-ink transition disabled:opacity-30 disabled:cursor-not-allowed"
                              title={canDrill ? 'View usages' : 'No usages yet'}
                            >
                              <LuEye size={14} />
                            </button>
                            <button
                              onClick={() => setView({ kind: 'confirmDelete', name: v.name })}
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

  function renderUsageTable(chapters: Chapter[], emptyLabel: string) {
    if (chapters.length === 0) {
      return <p className="text-xs text-ink-faint italic text-center py-4">{emptyLabel}</p>
    }
    return (
      <div className="overflow-y-auto min-h-0 border border-accent/10 rounded-lg">
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
              <tr
                key={c.chapterId}
                onClick={() => navigateToChapter(c.bookId, c.chapterId, c.firstBlockId)}
                className="border-t border-accent/10 group/row hover:bg-surface-overlay/40 transition cursor-pointer"
              >
                <td className="px-3 py-2 text-ink">{c.bookTitle}</td>
                <td className="px-2 py-2 text-ink-muted">{c.chapterTitle}</td>
                <td className="px-2 py-2 text-ink-muted">{c.count}</td>
                <td className="px-2 py-2 text-right">
                  <button
                    onClick={e => { e.stopPropagation(); navigateToChapter(c.bookId, c.chapterId, c.firstBlockId) }}
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
    )
  }

  function renderDrillIn(varName: string) {
    const counts = usage?.[varName]
    const total = counts?.total ?? 0
    const chapters = counts?.chapters ?? []
    const writeChapters = counts?.writeChapters ?? []
    const writeTotal = writeChapters.reduce((sum, c) => sum + c.count, 0)
    return (
      <>
        <div className="flex items-center justify-between mb-4 shrink-0">
          <div className="flex items-center gap-3 min-w-0">
            <h2 className="text-sm font-semibold text-ink font-mono truncate" title={varName}>{varName}</h2>
            <span className="shrink-0 text-[10px] uppercase tracking-widest bg-accent/15 text-accent rounded-full px-2 py-0.5">
              {total === 1 ? '1 read' : `${total} reads`}
            </span>
            <span className="shrink-0 text-[10px] uppercase tracking-widest bg-accent/15 text-accent rounded-full px-2 py-0.5">
              {writeTotal === 1 ? '1 write' : `${writeTotal} writes`}
            </span>
          </div>
          <button onClick={() => setEditOpen(false)} className="text-ink-faint hover:text-ink"><LuX size={16} /></button>
        </div>

        <div className="flex flex-col gap-4 overflow-y-auto min-h-0">
          <div>
            <div className="text-[10px] uppercase tracking-widest text-ink-faint mb-1.5">Reads — conditions & text</div>
            {renderUsageTable(chapters, 'No chapters read this variable.')}
          </div>
          <div>
            {/* Writes come from a choice's setsVariables (question block
                assignments). Shown separately from reads so numeric
                counters like a running tally can be traced across every
                place their value changes, not just the first one. */}
            <div className="text-[10px] uppercase tracking-widest text-ink-faint mb-1.5">Writes — question block assignments</div>
            {renderUsageTable(writeChapters, 'No chapters write this variable.')}
          </div>
        </div>

        <button
          onClick={() => setView({ kind: 'overview' })}
          className="self-end mt-3 flex items-center gap-1.5 text-xs text-ink-muted hover:text-ink transition"
        >
          <LuRotateCcw size={12} /> return to all context
        </button>
      </>
    )
  }

  function renderConfirmDelete(varName: string) {
    const counts = usage?.[varName]
    const total = counts?.total ?? 0
    // Merge reads + writes by chapterId so the writer sees every site
    // that references the variable in any way before pulling the
    // trigger. Each row's count is the sum of reads and writes in that
    // chapter. Sort follows book then chapter order — same as the
    // walk produces. The chapter table is the friction: it's right
    // there, the writer has to scroll past it to reach Delete.
    const merged = new Map<string, Chapter>()
    for (const c of counts?.chapters ?? []) merged.set(c.chapterId, { ...c })
    for (const c of counts?.writeChapters ?? []) {
      const existing = merged.get(c.chapterId)
      if (existing) existing.count += c.count
      else merged.set(c.chapterId, { ...c })
    }
    const mergedChapters = Array.from(merged.values()).sort(
      (a, b) => a.bookOrder - b.bookOrder || a.chapterOrder - b.chapterOrder,
    )
    const variable = variables.find(v => v.name === varName)

    async function commitDelete() {
      if (!variable) return
      // Switch back to overview first so the freshly deleted row is
      // gone the moment the parent re-renders with the new variables
      // prop. The fetch for usage will refetch next time the modal
      // opens — sufficient for now.
      setView({ kind: 'overview' })
      await Promise.resolve(onDelete(variable.id))
    }

    return (
      <>
        <div className="flex items-center justify-between mb-4 shrink-0 gap-3">
          <div className="flex items-center gap-3 min-w-0">
            <h2 className="text-sm font-semibold text-ink truncate">Are you sure you want to delete this context?</h2>
            <span className="shrink-0 text-[10px] uppercase tracking-widest bg-accent/15 text-accent rounded-full px-2 py-0.5">
              {total === 1 ? '1 usage' : `${total} usages`}
            </span>
          </div>
          <button onClick={() => setEditOpen(false)} className="text-ink-faint hover:text-ink shrink-0"><LuX size={16} /></button>
        </div>

        <p className="text-xs text-ink-muted font-mono mb-3 shrink-0">{varName}</p>

        {mergedChapters.length === 0 ? (
          <p className="text-xs text-ink-faint italic text-center py-6 border border-accent/10 rounded-lg">
            Nothing in the series references this. Safe to delete.
          </p>
        ) : (
          <div className="overflow-y-auto min-h-0 border border-accent/10 rounded-lg">
            <table className="w-full text-xs">
              <thead className="bg-surface-overlay sticky top-0 z-10">
                <tr className="text-ink-faint uppercase tracking-widest">
                  <th className="text-left font-medium px-3 py-2.5">Book</th>
                  <th className="text-left font-medium px-2 py-2.5">Chapter</th>
                  <th className="px-2 py-2.5 w-12" />
                </tr>
              </thead>
              <tbody>
                {mergedChapters.map(c => (
                  <tr
                    key={c.chapterId}
                    onClick={() => navigateToChapter(c.bookId, c.chapterId, c.firstBlockId)}
                    className="border-t border-accent/10 group/row hover:bg-surface-overlay/40 transition cursor-pointer"
                  >
                    <td className="px-3 py-2 text-ink">{c.bookTitle}</td>
                    <td className="px-2 py-2 text-ink-muted">{c.chapterTitle}</td>
                    <td className="px-2 py-2 text-right">
                      <button
                        onClick={e => { e.stopPropagation(); navigateToChapter(c.bookId, c.chapterId, c.firstBlockId) }}
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

        <div className="flex items-center justify-end gap-2 mt-4 shrink-0">
          <button
            onClick={() => setView({ kind: 'overview' })}
            className="px-4 py-1.5 text-xs text-ink-muted hover:text-ink transition"
          >
            Cancel
          </button>
          <button
            onClick={commitDelete}
            className="px-4 py-1.5 rounded text-xs bg-choice-kill text-white font-medium hover:opacity-90 transition"
          >
            Delete
          </button>
        </div>
      </>
    )
  }
}
