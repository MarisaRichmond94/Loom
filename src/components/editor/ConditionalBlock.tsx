'use client'

import TextBlock from './TextBlock'

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
    if (variables.length === 0) return
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
            <div className="flex items-center gap-2 mb-2">
              <span className="text-xs text-choice-spare">if</span>
              <select
                value={varName}
                onChange={e => {
                  const newCond = { [e.target.value]: varVal }
                  onUpdateOverride(override.id, { condition: JSON.stringify(newCond) })
                }}
                className="bg-surface-base border border-choice-spare-border/40 rounded px-1.5 py-0.5 text-xs text-accent font-mono outline-none"
              >
                {variables.map(v => <option key={v.id} value={v.name}>{v.name}</option>)}
              </select>
              <span className="text-xs text-ink-faint">=</span>
              <select
                value={String(varVal)}
                onChange={e => {
                  const newVal = e.target.value === 'true' ? true : e.target.value === 'false' ? false : e.target.value
                  onUpdateOverride(override.id, { condition: JSON.stringify({ [varName]: newVal }) })
                }}
                className="bg-surface-base border border-choice-spare-border/40 rounded px-1.5 py-0.5 text-xs text-ink outline-none"
              >
                <option value="true">true</option>
                <option value="false">false</option>
              </select>
              <button onClick={() => onDeleteOverride(override.id)} className="ml-auto text-xs text-ink-faint hover:text-choice-kill">✕</button>
            </div>
            <TextBlock
              content={override.content}
              onChange={content => onUpdateOverride(override.id, { content })}
            />
          </div>
        )
      })}

      <button
        onClick={handleAddOverride}
        className="w-full py-1.5 border border-dashed border-choice-spare-border/40 rounded text-xs text-ink-faint hover:text-ink transition"
      >
        + add override condition
      </button>
    </div>
  )
}
