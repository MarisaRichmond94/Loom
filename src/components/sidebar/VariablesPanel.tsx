'use client'

import { useState } from 'react'

type Variable = { id: string; name: string; type: string; defaultValue: string }
type Props = {
  seriesId: string
  variables: Variable[]
  onAdd: (name: string, type: string, defaultValue: unknown) => void
  onDelete: (id: string) => void
}

const TYPE_DEFAULTS: Record<string, unknown> = { boolean: false, number: 0, string: '' }

export default function VariablesPanel({ variables, onAdd, onDelete }: Props) {
  const [name, setName] = useState('')
  const [type, setType] = useState('boolean')
  const [showForm, setShowForm] = useState(false)

  function handleAdd(e: React.FormEvent) {
    e.preventDefault()
    if (!name.trim()) return
    onAdd(name.trim(), type, TYPE_DEFAULTS[type])
    setName('')
    setShowForm(false)
  }

  return (
    <div>
      <div className="text-xs uppercase tracking-widest text-ink-faint mb-2">Story Variables</div>

      <div className="flex flex-col gap-1 mb-2">
        {variables.map(v => (
          <div key={v.id} className="flex items-center justify-between px-2 py-1 rounded bg-surface-overlay group">
            <span className="font-mono text-xs text-accent">{v.name}</span>
            <div className="flex items-center gap-2">
              <span className="text-xs text-ink-faint">{v.type}</span>
              <button
                onClick={() => onDelete(v.id)}
                className="text-xs text-ink-faint opacity-0 group-hover:opacity-100 hover:text-choice-kill transition"
              >
                ✕
              </button>
            </div>
          </div>
        ))}
      </div>

      {showForm ? (
        <form onSubmit={handleAdd} className="flex flex-col gap-1.5">
          <input
            autoFocus
            value={name}
            onChange={e => setName(e.target.value)}
            placeholder="variable_name"
            className="bg-surface-overlay border border-accent/20 rounded px-2 py-1 text-xs font-mono text-ink outline-none focus:border-accent"
          />
          <select
            value={type}
            onChange={e => setType(e.target.value)}
            className="bg-surface-overlay border border-accent/20 rounded px-2 py-1 text-xs text-ink outline-none"
          >
            <option value="boolean">boolean</option>
            <option value="number">number</option>
            <option value="string">string</option>
          </select>
          <div className="flex gap-1">
            <button type="submit" className="flex-1 py-1 bg-accent/10 border border-accent/30 rounded text-xs text-accent">Add</button>
            <button type="button" onClick={() => setShowForm(false)} className="flex-1 py-1 bg-surface-overlay rounded text-xs text-ink-faint">Cancel</button>
          </div>
        </form>
      ) : (
        <button
          onClick={() => setShowForm(true)}
          className="w-full py-1 border border-dashed border-accent/20 rounded text-xs text-ink-faint hover:text-ink transition"
        >
          + add variable
        </button>
      )}
    </div>
  )
}
