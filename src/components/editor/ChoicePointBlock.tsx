'use client'

import { useState } from 'react'
import TextField from '@mui/material/TextField'
import Select from '@mui/material/Select'
import MenuItem from '@mui/material/MenuItem'
import FormControl from '@mui/material/FormControl'
import InputLabel from '@mui/material/InputLabel'
import Button from '@mui/material/Button'

type Choice = { id: string; label: string; setsVariables: string; targetChapterId: string | null }
type Props = {
  blockId: string
  displayType: string | null
  choices: Choice[]
  variables: { id: string; name: string; type: string }[]
  onUpdateBlock: (data: Partial<{ displayType: string; prompt: string }>) => void
  onAddChoice: (label: string) => void
  onUpdateChoice: (choiceId: string, data: Partial<Choice>) => void
  onDeleteChoice: (choiceId: string) => void
}

const PALETTE = [
  'bg-choice-spare-bg border-choice-spare-border',
  'bg-choice-kill-bg border-choice-kill-border',
  'bg-choice-amber-bg border-choice-amber-border',
  'bg-choice-blue-bg border-choice-blue-border',
  'bg-choice-purple-bg border-choice-purple-border',
  'bg-choice-teal-bg border-choice-teal-border',
]

function isValidNumber(val: string) {
  return val.trim() !== '' && !isNaN(Number(val))
}

export default function ChoicePointBlock({
  displayType, choices, variables, onUpdateBlock, onAddChoice, onUpdateChoice, onDeleteChoice
}: Props) {
  const [newLabel, setNewLabel] = useState('')

  function handleAddChoice(e: React.FormEvent) {
    e.preventDefault()
    if (!newLabel.trim()) return
    onAddChoice(newLabel.trim())
    setNewLabel('')
  }

  return (
    <div>
      <div className="flex items-center gap-2 mb-3">
        <span className="text-xs text-choice-kill uppercase tracking-widest">⑂ Choice Point</span>
        <div className="flex rounded overflow-hidden border border-accent/20 text-xs">
          {(['inline', 'chapter_gate'] as const).map(t => (
            <button
              key={t}
              onClick={() => onUpdateBlock({ displayType: t })}
              className={`px-2 py-0.5 transition ${displayType === t ? 'bg-accent text-surface-base' : 'text-ink-faint hover:text-ink'}`}
            >
              {t === 'inline' ? 'Inline' : 'Chapter Gate'}
            </button>
          ))}
        </div>
      </div>

      <div className="flex flex-col gap-2 mb-3">
        {choices.map((choice, i) => {
          const vars = JSON.parse(choice.setsVariables || '{}') as Record<string, unknown>
          return (
            <div key={choice.id} className={`border rounded p-3 ${PALETTE[i % PALETTE.length]}`}>
              <div className="flex items-center gap-2 mb-3">
                <TextField
                  fullWidth
                  label="Choice label"
                  value={choice.label}
                  onChange={e => onUpdateChoice(choice.id, { label: e.target.value })}
                  slotProps={{ htmlInput: { style: { fontSize: '0.8rem' } } }}
                />
                <button
                  onClick={() => onDeleteChoice(choice.id)}
                  className="text-xs text-ink-faint hover:text-choice-kill shrink-0"
                >
                  ✕
                </button>
              </div>

              {variables.length > 0 && (
                <div className="flex flex-wrap gap-2">
                  {variables.map(v => {
                    const currentVal = vars[v.name]

                    if (v.type === 'boolean') {
                      return (
                        <FormControl key={v.id} size="small" sx={{ minWidth: 140 }}>
                          <InputLabel>{v.name}</InputLabel>
                          <Select
                            label={v.name}
                            value={currentVal !== undefined ? String(currentVal) : ''}
                            onChange={e => {
                              const updated = { ...vars }
                              if (e.target.value === '') delete updated[v.name]
                              else updated[v.name] = e.target.value === 'true'
                              onUpdateChoice(choice.id, { setsVariables: JSON.stringify(updated) })
                            }}
                          >
                            <MenuItem value="">— unset —</MenuItem>
                            <MenuItem value="true">true</MenuItem>
                            <MenuItem value="false">false</MenuItem>
                          </Select>
                        </FormControl>
                      )
                    }

                    if (v.type === 'number') {
                      const raw = currentVal !== undefined ? String(currentVal) : ''
                      return (
                        <TextField
                          key={v.id}
                          label={v.name}
                          value={raw}
                          onChange={e => {
                            const val = e.target.value
                            if (val === '' || isValidNumber(val)) {
                              const updated = { ...vars }
                              if (val === '') delete updated[v.name]
                              else updated[v.name] = Number(val)
                              onUpdateChoice(choice.id, { setsVariables: JSON.stringify(updated) })
                            }
                          }}
                          error={raw !== '' && !isValidNumber(raw)}
                          helperText={raw !== '' && !isValidNumber(raw) ? 'Must be a number' : ''}
                          sx={{ width: 120 }}
                        />
                      )
                    }

                    return (
                      <TextField
                        key={v.id}
                        label={v.name}
                        value={currentVal !== undefined ? String(currentVal) : ''}
                        onChange={e => {
                          const updated = { ...vars }
                          if (e.target.value === '') delete updated[v.name]
                          else updated[v.name] = e.target.value
                          onUpdateChoice(choice.id, { setsVariables: JSON.stringify(updated) })
                        }}
                        sx={{ width: 160 }}
                      />
                    )
                  })}
                </div>
              )}
            </div>
          )
        })}
      </div>

      <form onSubmit={handleAddChoice} className="flex gap-2">
        <TextField
          fullWidth
          placeholder="→ New choice…"
          value={newLabel}
          onChange={e => setNewLabel(e.target.value)}
          slotProps={{ htmlInput: { style: { fontSize: '0.75rem' } } }}
        />
        <Button
          type="submit"
          variant="contained"
          size="small"
          sx={{ bgcolor: 'var(--color-accent)', color: '#fff', whiteSpace: 'nowrap', '&:hover': { bgcolor: 'var(--color-accent)', opacity: 0.9 } }}
        >
          Add Choice
        </Button>
      </form>
    </div>
  )
}
