'use client'

import { LuSplit, LuX } from 'react-icons/lu'
import TextBlock from './TextBlock'
import Select from '@mui/material/Select'
import MenuItem from '@mui/material/MenuItem'
import FormControl from '@mui/material/FormControl'
import TextField from '@mui/material/TextField'
import { ThemeProvider, createTheme } from '@mui/material/styles'

const darkTheme = createTheme({ palette: { mode: 'dark' } })

type Override = { id: string; order: number; condition: string; content: string }
type Character = { id: string; name: string; age?: number | null; hasAvatar?: boolean }
type Props = {
  overrides: Override[]
  variables: { id: string; name: string; type: string }[]
  characters?: Character[]
  onAddOverride: (condition: Record<string, unknown>, content: string) => void
  onUpdateOverride: (overrideId: string, data: Partial<Override>) => void
  onDeleteOverride: (overrideId: string) => void
}

const EMPTY = '{"type":"doc","content":[{"type":"paragraph"}]}'

export default function ConditionalBlock({ overrides, variables, characters, onAddOverride, onUpdateOverride, onDeleteOverride }: Props) {
  function handleAddOverride() {
    const varName = variables[0].name
    onAddOverride({ [varName]: true }, EMPTY)
  }

  return (
    <div>
      <div className="flex items-center gap-1.5 text-xs text-accent uppercase tracking-widest mb-3"><LuSplit size={12} /> Conditional</div>

      <ThemeProvider theme={darkTheme}>
        {overrides.map(override => {
          const condition = JSON.parse(override.condition || '{}') as Record<string, unknown>
          const entries = Object.entries(condition)
          const [varName, varVal] = entries[0] ?? ['', '']
          const varType = variables.find(v => v.name === varName)?.type ?? 'boolean'
          const isKill = varType === 'boolean' && varVal === false
          return (
            <div key={override.id} className={`border rounded p-3 mb-2 ${isKill ? 'bg-choice-kill-bg border-choice-kill-border' : 'bg-choice-spare-bg border-choice-spare-border'}`}>
              <div className="flex items-center gap-2 mb-2 flex-wrap">
                <span className={`text-xs ${isKill ? 'text-choice-kill' : 'text-choice-spare'}`}>if</span>
                <FormControl size="small" sx={{ minWidth: 120 }}>
                  <Select
                    value={varName}
                    onChange={e => {
                      onUpdateOverride(override.id, { condition: JSON.stringify({ [e.target.value]: varVal }) })
                    }}
                  >
                    {variables.map(v => <MenuItem key={v.id} value={v.name}>{v.name}</MenuItem>)}
                  </Select>
                </FormControl>
                <span className="text-xs text-ink-faint">=</span>
                {(() => {
                  if (varType === 'boolean') {
                    return (
                      <FormControl size="small" sx={{ minWidth: 100 }}>
                        <Select
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
                      size="small"
                      value={raw}
                      error={invalid}
                      helperText={invalid ? 'Must be a number' : ''}
                      sx={{ width: isNum ? 100 : 140 }}
                      onChange={e => {
                        const val = e.target.value
                        if (isNum && val !== '' && isNaN(Number(val))) return
                        onUpdateOverride(override.id, { condition: JSON.stringify({ [varName]: isNum ? Number(val) : val }) })
                      }}
                    />
                  )
                })()}
                <button onClick={() => onDeleteOverride(override.id)} className="ml-auto text-ink-faint hover:text-choice-kill"><LuX size={13} /></button>
              </div>
              <TextBlock
                content={override.content}
                onChange={content => onUpdateOverride(override.id, { content })}
                characters={characters}
                variables={variables}
              />
            </div>
          )
        })}
      </ThemeProvider>

      {variables.length === 0 ? (
        <p className="text-xs text-ink-faint text-center py-1.5">
          Define a context variable first to add conditions.
        </p>
      ) : (
        <button
          onClick={handleAddOverride}
          className="w-full py-1.5 rounded text-xs bg-accent text-white font-medium hover:opacity-90 transition"
        >
          Add Condition
        </button>
      )}
    </div>
  )
}
