'use client'

import { useState, useRef, useEffect } from 'react'
import { LuCheck, LuX } from 'react-icons/lu'
import { ConditionRow, ValueSetter, TYPE_DEFAULT_VALUE } from './conditionUI'
import TextBlock from './TextBlock'

type Character = { id: string; name: string; age?: number | null; hasAvatar?: boolean }

// Set/add/subtract for number-type variables on a choice's setsVariables.
// Primitive values (legacy on-disk shape) parse as "Set to"; the {op,value}
// shape carries deltas. Writes back as a primitive when op === '=' so
// existing data stays in its original form unless the writer flips to a
// counter operation.
type NumberSetValue = number | { op: '=' | '+=' | '-='; value: number }
function NumberSetWithOp({ value, onChange }: { value: unknown; onChange: (v: NumberSetValue) => void }) {
  const isObj = typeof value === 'object' && value !== null && 'op' in value && 'value' in value
  const op = isObj ? (value as { op: '=' | '+=' | '-=' }).op : '='
  const num = isObj
    ? (value as { value: number }).value
    : typeof value === 'number' ? value : 0
  function update(nextOp: '=' | '+=' | '-=', nextValue: number) {
    if (nextOp === '=') onChange(nextValue)
    else onChange({ op: nextOp, value: nextValue })
  }
  const baseCls = 'bg-black/20 border border-black/20 rounded text-xs text-ink outline-none focus:border-accent/50'
  return (
    <div className="flex items-center gap-1">
      <div className="relative">
        <select
          value={op}
          onChange={e => update(e.target.value as '=' | '+=' | '-=', num)}
          className={`${baseCls} appearance-none pl-2 pr-5 py-1`}
        >
          <option value="=">Set to</option>
          <option value="+=">Add</option>
          <option value="-=">Subtract</option>
        </select>
        <span className="absolute right-1.5 top-1/2 -translate-y-1/2 text-ink-faint pointer-events-none text-xs">▾</span>
      </div>
      {/* `[appearance:textfield]` + per-pseudo `appearance:none` together hide
          the browser's native up/down spinner controls on type="number" in
          Chrome, Safari, and Firefox. */}
      <input
        type="number"
        value={num}
        onChange={e => update(op, Number(e.target.value))}
        className={`${baseCls} w-20 px-2 py-1 [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none`}
      />
    </div>
  )
}

type Choice = { id: string; label: string; setsVariables: string; targetChapterId: string | null; endingMessage?: string | null; isBadEnding?: boolean }
type Variable = { id: string; name: string; type: string; defaultValue?: string }

type Props = {
  prompt: string | null
  displayType: string | null
  condition: string | null
  choices: Choice[]
  variables: Variable[]
  characters?: Character[]
  onUpdateBlock: (data: Partial<{ displayType: string; prompt: string; condition: string | null }>) => void
  onUpdateChoice: (choiceId: string, data: Partial<Choice>) => void
  onCreateVariable: (name: string, type: string) => Promise<void>
}

const VAR_TYPES = ['string', 'number', 'boolean'] as const
const DEFAULT_VALUE = TYPE_DEFAULT_VALUE

function ChoicePanel({
  choice, slotPlaceholder, labelClass, bgClass, borderClass,
  variables, characters, onUpdateChoice, onCreateVariable,
}: {
  choice: Choice; slotPlaceholder: string; labelClass: string; bgClass: string; borderClass: string
  variables: Variable[]
  characters?: Character[]
  onUpdateChoice: Props['onUpdateChoice']
  onCreateVariable: Props['onCreateVariable']
}) {
  const [menuOpen, setMenuOpen] = useState(false)
  const [showCreate, setShowCreate] = useState(false)
  const [showAttach, setShowAttach] = useState(false)
  const [attachQuery, setAttachQuery] = useState('')
  const [newName, setNewName] = useState('')
  const [newType, setNewType] = useState<typeof VAR_TYPES[number]>('string')
  const menuRef = useRef<HTMLDivElement>(null)
  const attachSearchRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    function onDown(e: MouseEvent) {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setMenuOpen(false); setShowAttach(false)
      }
    }
    document.addEventListener('mousedown', onDown)
    return () => document.removeEventListener('mousedown', onDown)
  }, [])

  // Reset the filter and autofocus the search input every time the attach
  // dropdown opens — matches the conditional picker's behavior so the
  // writer can start typing immediately.
  useEffect(() => {
    if (showAttach) {
      setAttachQuery('')
      requestAnimationFrame(() => attachSearchRef.current?.focus())
    }
  }, [showAttach])

  const vars = JSON.parse(choice.setsVariables || '{}') as Record<string, unknown>
  const attachedNames = new Set(Object.keys(vars))
  const attachedVars = variables.filter(v => attachedNames.has(v.name))
  const unattachedVars = variables.filter(v => !attachedNames.has(v.name))

  function save(updated: Record<string, unknown>) {
    const cleaned: Record<string, unknown> = {}
    for (const [k, v] of Object.entries(updated)) { if (v !== undefined) cleaned[k] = v }
    onUpdateChoice(choice.id, { setsVariables: JSON.stringify(cleaned) })
  }

  function setVal(name: string, val: unknown) {
    const updated = { ...vars }
    if (val === undefined) delete updated[name]; else updated[name] = val
    save(updated)
  }

  function detach(name: string) {
    const updated = { ...vars }; delete updated[name]; save(updated)
  }

  function attach(v: Variable) {
    save({ ...vars, [v.name]: DEFAULT_VALUE[v.type] ?? '' })
    setShowAttach(false); setMenuOpen(false)
  }

  async function handleCreate(e: React.FormEvent) {
    e.preventDefault()
    const name = newName.trim(); if (!name) return
    save({ ...vars, [name]: DEFAULT_VALUE[newType] ?? '' })
    await onCreateVariable(name, newType)
    setNewName(''); setNewType('string'); setShowCreate(false); setMenuOpen(false)
  }

  return (
    <div className={`flex-1 ${bgClass} border ${borderClass} rounded-lg p-3`}>
      {/* Header — the choice's label is editable in-place. Whatever the
          writer types here is what the reader sees on the button. */}
      <div className="flex items-center justify-between mb-3 gap-2">
        <input
          type="text"
          defaultValue={choice.label}
          onBlur={e => onUpdateChoice(choice.id, { label: e.target.value })}
          placeholder={slotPlaceholder}
          className={`flex-1 min-w-0 bg-transparent border-none outline-none text-xs font-semibold ${labelClass} uppercase tracking-widest placeholder:text-ink-faint placeholder:normal-case placeholder:font-normal placeholder:tracking-normal`}
        />
        <div ref={menuRef} className="relative">
          <button
            onClick={() => { setMenuOpen(o => !o); setShowCreate(false); setShowAttach(false) }}
            className="text-ink-muted hover:text-ink transition text-lg font-bold leading-none"
          >
            +
          </button>

          {menuOpen && !showCreate && !showAttach && (
            <div className="absolute right-0 bottom-full mb-1 bg-surface-raised border border-accent/20 rounded-lg shadow-xl z-10 overflow-hidden min-w-[200px]">
              <button
                onClick={() => { setShowCreate(true); setMenuOpen(false) }}
                className="w-full px-4 py-2.5 text-sm text-ink-muted hover:text-ink hover:bg-surface-overlay transition text-left"
              >
                Create New Context
              </button>
              {unattachedVars.length > 0 && (
                <button
                  onClick={() => { setShowAttach(true); setMenuOpen(false) }}
                  className="w-full px-4 py-2.5 text-sm text-ink-muted hover:text-ink hover:bg-surface-overlay transition text-left"
                >
                  Attach Existing Context
                </button>
              )}
            </div>
          )}

          {showAttach && (() => {
            const q = attachQuery.trim().toLowerCase()
            const filtered = q ? unattachedVars.filter(v => v.name.toLowerCase().includes(q)) : unattachedVars
            return (
              <div className="absolute right-0 bottom-full mb-1 bg-surface-raised border border-accent/20 rounded-lg shadow-xl z-10 overflow-hidden min-w-[220px]">
                <div className="px-2 py-1.5 border-b border-accent/10">
                  <input
                    ref={attachSearchRef}
                    value={attachQuery}
                    onChange={e => setAttachQuery(e.target.value)}
                    onKeyDown={e => {
                      if (e.key === 'Enter' && filtered.length > 0) {
                        e.preventDefault()
                        attach(filtered[0])
                      }
                    }}
                    placeholder="Search context…"
                    className="w-full bg-black/20 border border-black/20 rounded px-2 py-1 text-xs text-ink placeholder:text-ink-faint outline-none focus:border-accent/50"
                  />
                </div>
                <div className="overflow-y-auto" style={{ maxHeight: '140px' }}>
                  {filtered.length === 0 ? (
                    <p className="px-4 py-2 text-xs text-ink-faint italic">No matches</p>
                  ) : filtered.map(v => (
                    <button
                      key={v.id}
                      onClick={() => attach(v)}
                      className="flex items-center justify-between w-full px-4 py-2.5 text-sm text-ink-muted hover:text-ink hover:bg-surface-overlay transition text-left gap-4"
                    >
                      <span>{v.name}</span>
                      <span className="text-ink-faint text-xs">{v.type}</span>
                    </button>
                  ))}
                </div>
              </div>
            )
          })()}
        </div>
      </div>

      {/* Attached variables */}
      <div className="flex flex-col gap-2 mb-2">
        {attachedVars.length === 0 && !showCreate && (
          <p className="text-xs text-ink-faint italic">No context applied yet</p>
        )}
        {attachedVars.map(v => (
          <div key={v.id} className="flex items-center gap-2">
            <span className="text-xs text-ink-muted truncate min-w-0" title={v.name}>{v.name}</span>
            {/* Number setter is compact (op dropdown + ~80px input) and
                sits flush against the X; ValueSetter for boolean/string
                still wraps in flex-1 so its full-width inputs stretch. */}
            {v.type === 'number' ? (
              <NumberSetWithOp value={vars[v.name]} onChange={val => setVal(v.name, val)} />
            ) : (
              <div className="flex-1">
                <ValueSetter v={v} currentVal={vars[v.name]} onChange={val => setVal(v.name, val)} />
              </div>
            )}
            <button onClick={() => detach(v.name)} className="text-ink-muted hover:text-choice-kill transition shrink-0"><LuX size={13} /></button>
          </div>
        ))}
      </div>

      {/* Create new inline form */}
      {showCreate && (
        <form onSubmit={handleCreate} className="flex items-center gap-2 mt-2">
          <input
            autoFocus
            value={newName}
            onChange={e => setNewName(e.target.value)}
            onKeyDown={e => e.key === 'Escape' && (setShowCreate(false))}
            placeholder="Variable name"
            className="flex-1 bg-black/20 border border-black/20 rounded px-2 py-1 text-xs text-ink placeholder:text-ink-faint outline-none focus:border-accent/50"
          />
          <select
            value={newType}
            onChange={e => setNewType(e.target.value as typeof VAR_TYPES[number])}
            className="bg-black/20 border border-black/20 rounded px-2 py-1 text-xs text-ink outline-none"
          >
            <option value="string">Text</option>
            <option value="number">Number</option>
            <option value="boolean">Boolean</option>
          </select>
          <button type="submit" className="text-accent px-1"><LuCheck size={13} /></button>
          <button type="button" onClick={() => setShowCreate(false)} className="text-ink-faint px-1"><LuX size={13} /></button>
        </form>
      )}

      {/* Branch text — shown when this choice is picked. Full TipTap
          editor so the writer gets the same formatting (italics, bold,
          alignment, color, character refs, {{var}} interpolation, etc.)
          as a text block or conditional override. Empty doc renders as
          nothing in the reader. The Bad ending toggle decides whether
          the text fires a full-screen modal that truncates the chapter
          (checked) or just renders as an inline paragraph at the
          choice's position (unchecked, the default). */}
      <div className="mt-3 pt-3 border-t border-black/20">
        <TextBlock
          content={choice.endingMessage ?? null}
          onChange={json => onUpdateChoice(choice.id, { endingMessage: json })}
          characters={characters}
          variables={variables}
          placeholder={choice.isBadEnding
            ? 'What the reader sees on the full-screen overlay…'
            : 'Optional: text shown inline when this choice is picked…'}
        />
        <label className="mt-2 flex items-center gap-2 text-xs text-ink-muted cursor-pointer">
          <input
            type="checkbox"
            checked={choice.isBadEnding ?? false}
            onChange={e => onUpdateChoice(choice.id, { isBadEnding: e.target.checked })}
            className="accent-choice-kill"
          />
          <span>Bad ending</span>
        </label>
      </div>
    </div>
  )
}


export default function ChoicePointBlock({ prompt, displayType, condition, choices, variables, characters, onUpdateBlock, onUpdateChoice, onCreateVariable }: Props) {
  // Slot by array order — choices[0] is the green/primary slot,
  // choices[1] is the red/secondary slot. Used to differ from the
  // old label-based matching ('Yes' / 'No') so writers can rename
  // their options to anything ("A phone" / "A laptop", etc.).
  const primaryChoice = choices[0] ?? null
  const secondaryChoice = choices[1] ?? null

  return (
    <div>
      <div className="flex items-center justify-between mb-1">
        <span className="text-sm font-bold text-ink uppercase tracking-widest">Choose</span>
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

      <ConditionRow
        condition={condition}
        variables={variables}
        onChange={next => onUpdateBlock({ condition: next })}
      />

      <input
        type="text"
        placeholder="Ask the reader something (e.g. What does Jared see on the desk?)"
        defaultValue={prompt ?? ''}
        onBlur={e => onUpdateBlock({ prompt: e.target.value })}
        className="w-full bg-transparent border-none outline-none text-sm italic text-ink-muted placeholder:text-ink-faint mb-3 px-0"
      />

      {/* Panels stacked vertically — each branch gets the full block width
          so the rich-text editor inside has room to breathe. */}
      <div className="flex flex-col gap-3">
        {primaryChoice && (
          <ChoicePanel
            choice={primaryChoice} slotPlaceholder="Choice 1" labelClass="text-choice-spare"
            bgClass="bg-choice-spare-bg" borderClass="border-choice-spare-border"
            variables={variables} characters={characters}
            onUpdateChoice={onUpdateChoice} onCreateVariable={onCreateVariable}
          />
        )}
        {secondaryChoice && (
          <ChoicePanel
            choice={secondaryChoice} slotPlaceholder="Choice 2" labelClass="text-choice-kill"
            bgClass="bg-choice-kill-bg" borderClass="border-choice-kill-border"
            variables={variables} characters={characters}
            onUpdateChoice={onUpdateChoice} onCreateVariable={onCreateVariable}
          />
        )}
      </div>
    </div>
  )
}
