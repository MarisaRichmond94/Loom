'use client'

import TextBlock from './TextBlock'
import TextField from '@mui/material/TextField'
import Select from '@mui/material/Select'
import MenuItem from '@mui/material/MenuItem'
import FormControl from '@mui/material/FormControl'
import InputLabel from '@mui/material/InputLabel'

type Override = { id: string; order: number; condition: string; content: string }
type Props = {
  baseContent: string | null
  overrides: Override[]
  variables: { id: string; name: string; type: string }[]
  onUpdateBase: (content: string) => void
  onAddOverride: (condition: Record<string, unknown>, content: string) => void
  onUpdateOverride: (overrideId: string, data: Partial<Override>) => void
  onDeleteOverride: (overrideId: string) => void
}

const EMPTY = '{"type":"doc","content":[{"type":"paragraph"}]}'

export default function ConditionalBlock({
  baseContent, overrides, variables, onUpdateBase, onAddOverride, onUpdateOverride, onDeleteOverride
}: Props) {
  function handleAddOverride() {
    const varName = variables[0].name
    onAddOverride({ [varName]: true }, EMPTY)
  }

  return (
    <div>
      <div className="text-xs text-accent uppercase tracking-widest mb-3">◈ Conditional Fragment</div>

      <div className="bg-surface-base border border-accent/20 rounded p-3 mb-2">
        <div className="text-xs text-ink-faint mb-2">Base (default)</div>
        <TextBlock content={baseContent} onChange={onUpdateBase} />
      </div>

      {overrides.map(override => {
        const condition = JSON.parse(override.condition || '{}') as Record<string, unknown>
        const entries = Object.entries(condition)
        const [varName, varVal] = entries[0] ?? ['', '']
        return (
          <div key={override.id} className="bg-choice-spare-bg border border-choice-spare-border rounded p-3 mb-2">
            <div className="flex items-center gap-2 mb-2 flex-wrap">
              <span className="text-xs text-choice-spare">if</span>
              <FormControl size="small" sx={{ minWidth: 120 }}>
                <InputLabel>variable</InputLabel>
                <Select
                  label="variable"
                  value={varName}
                  onChange={e => {
                    const newCond = { [e.target.value]: varVal }
                    onUpdateOverride(override.id, { condition: JSON.stringify(newCond) })
                  }}
                >
                  {variables.map(v => <MenuItem key={v.id} value={v.name}>{v.name}</MenuItem>)}
                </Select>
              </FormControl>
              <span className="text-xs text-ink-faint">=</span>
              {(() => {
                const varType = variables.find(v => v.name === varName)?.type ?? 'boolean'
                if (varType === 'boolean') {
                  return (
                    <FormControl size="small" sx={{ minWidth: 100 }}>
                      <InputLabel>value</InputLabel>
                      <Select
                        label="value"
                        value={String(varVal)}
                        onChange={e => {
                          onUpdateOverride(override.id, { condition: JSON.stringify({ [varName]: e.target.value === 'true' }) })
                        }}
                      >
                        <MenuItem value="true">true</MenuItem>
                        <MenuItem value="false">false</MenuItem>
                      </Select>
                    </FormControl>
                  )
                }
                const raw = String(varVal ?? '')
                const isNum = varType === 'number'
                const invalid = isNum && raw !== '' && isNaN(Number(raw))
                return (
                  <TextField
                    label="value"
                    size="small"
                    value={raw}
                    error={invalid}
                    helperText={invalid ? 'Must be a number' : ''}
                    sx={{ width: isNum ? 100 : 140 }}
                    onChange={e => {
                      const val = e.target.value
                      if (isNum && val !== '' && isNaN(Number(val))) return
                      const newVal = isNum ? Number(val) : val
                      onUpdateOverride(override.id, { condition: JSON.stringify({ [varName]: newVal }) })
                    }}
                  />
                )
              })()}
              <button onClick={() => onDeleteOverride(override.id)} className="ml-auto text-xs text-ink-faint hover:text-choice-kill">✕</button>
            </div>
            <TextBlock
              content={override.content}
              onChange={content => onUpdateOverride(override.id, { content })}
            />
          </div>
        )
      })}

      {variables.length === 0 ? (
        <p className="text-xs text-ink-faint text-center py-1.5">
          Define a story variable first to add override conditions.
        </p>
      ) : (
        <button
          onClick={handleAddOverride}
          className="w-full py-1.5 rounded text-xs bg-accent text-white font-medium hover:opacity-90 transition"
        >
          Add Override
        </button>
      )}
    </div>
  )
}
