'use client'

import { useState } from 'react'
import TextField from '@mui/material/TextField'
import Select from '@mui/material/Select'
import MenuItem from '@mui/material/MenuItem'
import FormControl from '@mui/material/FormControl'
import InputLabel from '@mui/material/InputLabel'
import Button from '@mui/material/Button'

type Variable = { id: string; name: string; type: string; defaultValue: string }
type Props = {
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
      <div className="text-xs uppercase tracking-widest text-ink-faint mb-2">Context</div>

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
        <form onSubmit={handleAdd} className="flex flex-col gap-2">
          <TextField
            autoFocus
            fullWidth
            label="Variable name"
            value={name}
            onChange={e => setName(e.target.value)}
            slotProps={{ htmlInput: { style: { fontFamily: 'monospace', fontSize: '0.75rem' } } }}
          />
          <FormControl fullWidth size="small">
            <InputLabel>Type</InputLabel>
            <Select label="Type" value={type} onChange={e => setType(e.target.value)}>
              <MenuItem value="boolean">boolean</MenuItem>
              <MenuItem value="number">number</MenuItem>
              <MenuItem value="string">string</MenuItem>
            </Select>
          </FormControl>
          <div className="flex gap-1">
            <Button type="submit" variant="contained" size="small" fullWidth sx={{ bgcolor: 'var(--color-accent)', color: '#fff', '&:hover': { bgcolor: 'var(--color-accent)', opacity: 0.9 } }}>
              Add Variable
            </Button>
            <Button type="button" variant="text" size="small" fullWidth onClick={() => setShowForm(false)} sx={{ color: 'var(--color-ink-faint)' }}>
              Cancel
            </Button>
          </div>
        </form>
      ) : (
        <button
          onClick={() => setShowForm(true)}
          className="w-full py-1 rounded text-xs bg-accent text-white font-medium hover:opacity-90 transition"
        >
          Add Variable
        </button>
      )}
    </div>
  )
}
