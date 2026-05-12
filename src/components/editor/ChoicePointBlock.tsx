'use client'

import { useState } from 'react'

type Choice = { id: string; label: string; setsVariables: string; targetSceneId: string | null }
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
        {choices.map(choice => {
          const vars = JSON.parse(choice.setsVariables || '{}') as Record<string, unknown>
          return (
            <div key={choice.id} className="bg-choice-kill-bg border border-choice-kill-border rounded p-3">
              <div className="flex items-center gap-2 mb-2">
                <input
                  value={choice.label}
                  onChange={e => onUpdateChoice(choice.id, { label: e.target.value })}
                  className="flex-1 bg-transparent text-sm text-ink-muted outline-none border-b border-transparent focus:border-choice-kill"
                />
                <button onClick={() => onDeleteChoice(choice.id)} className="text-xs text-ink-faint hover:text-choice-kill">✕</button>
              </div>
              {variables.length > 0 && (
                <div className="flex flex-wrap gap-1.5">
                  {variables.map(v => (
                    <div key={v.id} className="flex items-center gap-1 text-xs">
                      <span className="font-mono text-accent">{v.name}</span>
                      {v.type === 'boolean' && (
                        <select
                          value={vars[v.name] !== undefined ? String(vars[v.name]) : ''}
                          onChange={e => {
                            const updated = { ...vars }
                            if (e.target.value === '') { delete updated[v.name] }
                            else { updated[v.name] = e.target.value === 'true' }
                            onUpdateChoice(choice.id, { setsVariables: JSON.stringify(updated) })
                          }}
                          className="bg-surface-base border border-accent/20 rounded px-1 text-ink-faint outline-none"
                        >
                          <option value="">—</option>
                          <option value="true">true</option>
                          <option value="false">false</option>
                        </select>
                      )}
                      {v.type === 'number' && (
                        <input
                          type="number"
                          value={vars[v.name] !== undefined ? String(vars[v.name]) : ''}
                          onChange={e => {
                            const updated = { ...vars }
                            if (e.target.value === '') { delete updated[v.name] }
                            else { updated[v.name] = Number(e.target.value) }
                            onUpdateChoice(choice.id, { setsVariables: JSON.stringify(updated) })
                          }}
                          className="bg-surface-base border border-accent/20 rounded px-1 w-16 text-ink-faint outline-none"
                        />
                      )}
                      {v.type === 'string' && (
                        <input
                          type="text"
                          value={vars[v.name] !== undefined ? String(vars[v.name]) : ''}
                          onChange={e => {
                            const updated = { ...vars }
                            if (e.target.value === '') { delete updated[v.name] }
                            else { updated[v.name] = e.target.value }
                            onUpdateChoice(choice.id, { setsVariables: JSON.stringify(updated) })
                          }}
                          className="bg-surface-base border border-accent/20 rounded px-1 w-20 text-ink-faint outline-none"
                        />
                      )}
                    </div>
                  ))}
                </div>
              )}
            </div>
          )
        })}
      </div>

      <form onSubmit={handleAddChoice} className="flex gap-2">
        <input
          value={newLabel}
          onChange={e => setNewLabel(e.target.value)}
          placeholder="→ New choice…"
          className="flex-1 bg-surface-overlay border border-choice-kill-border/40 rounded px-2 py-1 text-xs text-ink outline-none"
        />
        <button type="submit" className="px-3 py-1 bg-choice-kill-bg border border-choice-kill-border rounded text-xs text-choice-kill">Add</button>
      </form>
    </div>
  )
}
