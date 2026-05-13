'use client'

import { useState } from 'react'
import { LuPencil, LuX } from 'react-icons/lu'

type Variable = { id: string; name: string; type: string; defaultValue: string }
type Props = {
  variables: Variable[]
  onAdd: (name: string, type: string, defaultValue: unknown) => void
  onUpdate: (id: string, name: string, type: string) => void
  onDelete: (id: string) => void
}

const TYPE_DEFAULTS: Record<string, unknown> = { boolean: false, number: 0, string: '' }
const TYPE_SHORT: Record<string, string> = { boolean: 'bool', number: 'num', string: 'str' }
const TYPES = ['string', 'number', 'boolean'] as const

export default function VariablesPanel({ variables, onAdd, onUpdate, onDelete }: Props) {
  const [name, setName] = useState('')
  const [type, setType] = useState('boolean')
  const [showForm, setShowForm] = useState(false)
  const [editOpen, setEditOpen] = useState(false)
  // Local draft state for the modal: id → { name, type }
  const [drafts, setDrafts] = useState<Record<string, { name: string; type: string }>>({})

  function openEdit() {
    const initial: Record<string, { name: string; type: string }> = {}
    variables.forEach(v => { initial[v.id] = { name: v.name, type: v.type } })
    setDrafts(initial)
    setEditOpen(true)
  }

  function handleAdd(e: React.FormEvent) {
    e.preventDefault()
    if (!name.trim()) return
    onAdd(name.trim(), type, TYPE_DEFAULTS[type])
    setName('')
    setShowForm(false)
  }

  function saveDraft(id: string) {
    const draft = drafts[id]
    const original = variables.find(v => v.id === id)
    if (!draft || !original) return
    if (draft.name.trim() === original.name && draft.type === original.type) return
    if (!draft.name.trim()) return
    onUpdate(id, draft.name.trim(), draft.type)
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
            onChange={e => setType(e.target.value)}
            className="w-full bg-surface-base border border-accent/20 rounded px-2 py-1 text-xs text-ink outline-none focus:border-accent"
          >
            <option value="string">String</option>
            <option value="number">Number</option>
            <option value="boolean">Boolean</option>
          </select>
          <div className="flex gap-1">
            <button type="submit" className="flex-1 py-1 rounded text-xs bg-accent text-white font-medium hover:opacity-90 transition">Add</button>
            <button type="button" onClick={() => setShowForm(false)} className="flex-1 py-1 rounded text-xs text-ink-faint hover:text-ink transition">Cancel</button>
          </div>
        </form>
      ) : (
        <button
          onClick={() => setShowForm(true)}
          className="w-full py-1 rounded text-xs bg-accent text-white font-medium hover:opacity-90 transition"
        >
          Add Context
        </button>
      )}
      </div>

      {/* Edit modal */}
      {editOpen && (
        <div
          className="fixed inset-0 bg-black/60 flex items-center justify-center z-50"
          onClick={() => setEditOpen(false)}
        >
          <div
            className="bg-surface-raised border border-accent/20 rounded-xl p-6 w-full max-w-md mx-4 shadow-2xl"
            onClick={e => e.stopPropagation()}
          >
            <div className="flex items-center justify-between mb-5">
              <h2 className="text-sm font-semibold text-ink">Edit Context</h2>
              <button onClick={() => setEditOpen(false)} className="text-ink-faint hover:text-ink"><LuX size={16} /></button>
            </div>

            {variables.length === 0 ? (
              <p className="text-xs text-ink-faint italic text-center py-4">No context variables yet.</p>
            ) : (
              <div className="flex flex-col gap-3">
                {variables.map(v => {
                  const draft = drafts[v.id] ?? { name: v.name, type: v.type }
                  return (
                    <div key={v.id} className="flex items-center gap-2">
                      <input
                        value={draft.name}
                        onChange={e => setDrafts(d => ({ ...d, [v.id]: { ...draft, name: e.target.value } }))}
                        onBlur={() => saveDraft(v.id)}
                        className="flex-1 bg-surface-base border border-accent/20 rounded px-2 py-1 text-xs text-ink font-mono outline-none focus:border-accent"
                      />
                      <select
                        value={draft.type}
                        onChange={e => {
                          const updated = { ...draft, type: e.target.value }
                          setDrafts(d => ({ ...d, [v.id]: updated }))
                          onUpdate(v.id, draft.name.trim() || v.name, e.target.value)
                        }}
                        className="bg-surface-base border border-accent/20 rounded px-2 py-1 text-xs text-ink outline-none focus:border-accent"
                      >
                        {TYPES.map(t => <option key={t} value={t}>{t}</option>)}
                      </select>
                      <button
                        onClick={() => onDelete(v.id)}
                        className="text-ink-faint hover:text-choice-kill transition shrink-0"
                      >
                        <LuX size={14} />
                      </button>
                    </div>
                  )
                })}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  )
}
