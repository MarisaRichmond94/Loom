'use client'

import { LuSplit, LuX } from 'react-icons/lu'
import TextBlock from './TextBlock'
import { ConditionRow } from './conditionUI'

type Override = { id: string; order: number; condition: string; content: string; endingMessage?: string | null }
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
    // Start with an empty condition (renders as "always"); the writer attaches
    // variables via the + menu on the ConditionRow when they're ready.
    onAddOverride({}, EMPTY)
  }

  return (
    <div>
      <div className="flex items-center gap-1.5 text-xs text-accent uppercase tracking-widest mb-3"><LuSplit size={12} /> Conditional</div>

      {overrides.map(override => {
        const isEnding = override.endingMessage != null
        return (
          <div
            key={override.id}
            className={`border rounded p-3 mb-2 ${isEnding ? 'border-choice-kill/40 bg-choice-kill/5' : 'border-accent/20 bg-surface-overlay'}`}
          >
            <div className="flex items-start gap-2 mb-2">
              <div className="flex-1 min-w-0">
                <ConditionRow
                  label="If:"
                  condition={override.condition || null}
                  variables={variables}
                  onChange={next => onUpdateOverride(override.id, { condition: next ?? '{}' })}
                />
              </div>
              <button
                onClick={() => onDeleteOverride(override.id)}
                className="text-ink-faint hover:text-choice-kill transition shrink-0 mt-1"
                title="Delete this condition"
              >
                <LuX size={13} />
              </button>
            </div>

            <TextBlock
              content={override.content}
              onChange={content => onUpdateOverride(override.id, { content })}
              characters={characters}
              variables={variables}
            />

            <label className="mt-2 flex items-center gap-2 text-xs text-ink-muted cursor-pointer">
              <input
                type="checkbox"
                checked={isEnding}
                onChange={e => onUpdateOverride(override.id, { endingMessage: e.target.checked ? '' : null })}
                className="accent-choice-kill"
              />
              <span>Bad ending</span>
              {isEnding && (
                <span className="text-[10px] uppercase tracking-widest text-choice-kill/80 ml-1">truncates the rest of the chapter</span>
              )}
            </label>
          </div>
        )
      })}

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
