'use client'

import { useState, useRef, useEffect } from 'react'
import { LuCheck, LuX } from 'react-icons/lu'

type Choice = { id: string; label: string; setsVariables: string; targetChapterId: string | null; endingMessage?: string | null }
type Variable = { id: string; name: string; type: string }

type Props = {
  prompt: string | null
  displayType: string | null
  condition: string | null
  choices: Choice[]
  variables: Variable[]
  onUpdateBlock: (data: Partial<{ displayType: string; prompt: string; condition: string | null }>) => void
  onUpdateChoice: (choiceId: string, data: Partial<Choice>) => void
  onCreateVariable: (name: string, type: string) => Promise<void>
}

const VAR_TYPES = ['string', 'number', 'boolean'] as const
const DEFAULT_VALUE: Record<string, unknown> = { string: '', number: 0, boolean: false }

const baseCls = 'bg-black/20 border border-black/20 rounded pl-2 py-1 text-xs text-ink outline-none focus:border-accent/50 w-full'

function ValueSetter({ v, currentVal, onChange }: { v: Variable; currentVal: unknown; onChange: (val: unknown) => void }) {
  if (v.type === 'boolean') {
    return (
      <div className="relative w-full">
        <select
          value={currentVal !== undefined ? String(currentVal) : ''}
          onChange={e => onChange(e.target.value === '' ? undefined : e.target.value === 'true')}
          className={`${baseCls} appearance-none pr-6`}
        >
          <option value="">— unset —</option>
          <option value="true">true</option>
          <option value="false">false</option>
        </select>
        <span className="absolute right-2 top-1/2 -translate-y-1/2 text-ink-faint pointer-events-none text-xs">▾</span>
      </div>
    )
  }
  return (
    <input
      type={v.type === 'number' ? 'number' : 'text'}
      value={currentVal !== undefined ? String(currentVal) : ''}
      onChange={e => {
        const val = e.target.value
        if (val === '') onChange(undefined)
        else if (v.type === 'number') { if (!isNaN(Number(val))) onChange(Number(val)) }
        else onChange(val)
      }}
      className={`${baseCls} pr-2`}
    />
  )
}

function ChoicePanel({
  choice, label, labelClass, bgClass, borderClass,
  variables, onUpdateChoice, onCreateVariable,
}: {
  choice: Choice; label: string; labelClass: string; bgClass: string; borderClass: string
  variables: Variable[]
  onUpdateChoice: Props['onUpdateChoice']
  onCreateVariable: Props['onCreateVariable']
}) {
  const [menuOpen, setMenuOpen] = useState(false)
  const [showCreate, setShowCreate] = useState(false)
  const [showAttach, setShowAttach] = useState(false)
  const [newName, setNewName] = useState('')
  const [newType, setNewType] = useState<typeof VAR_TYPES[number]>('string')
  const menuRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    function onDown(e: MouseEvent) {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setMenuOpen(false); setShowAttach(false)
      }
    }
    document.addEventListener('mousedown', onDown)
    return () => document.removeEventListener('mousedown', onDown)
  }, [])

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
      {/* Header */}
      <div className="flex items-center justify-between mb-3">
        <span className={`text-xs font-semibold ${labelClass} uppercase tracking-widest`}>{label}</span>
        <div ref={menuRef} className="relative">
          <button
            onClick={() => { setMenuOpen(o => !o); setShowCreate(false); setShowAttach(false) }}
            className="text-ink-muted hover:text-ink transition text-lg font-bold leading-none"
          >
            +
          </button>

          {menuOpen && !showCreate && !showAttach && (
            <div className="absolute right-0 top-full mt-1 bg-surface-raised border border-accent/20 rounded-lg shadow-xl z-10 overflow-hidden min-w-[200px]">
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

          {showAttach && (
            <div className="absolute right-0 top-full mt-1 bg-surface-raised border border-accent/20 rounded-lg shadow-xl z-10 overflow-hidden min-w-[200px]">
              {unattachedVars.map(v => (
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
          )}
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
            <div className="flex-1">
              <ValueSetter v={v} currentVal={vars[v.name]} onChange={val => setVal(v.name, val)} />
            </div>
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

      {/* Bad ending toggle + message */}
      <div className="mt-3 pt-3 border-t border-black/20">
        <label className="flex items-center gap-2 text-xs text-ink-muted cursor-pointer">
          <input
            type="checkbox"
            checked={choice.endingMessage != null}
            onChange={e => onUpdateChoice(choice.id, { endingMessage: e.target.checked ? '' : null })}
            className="accent-choice-kill"
          />
          <span>Bad ending</span>
        </label>
        {choice.endingMessage != null && (
          <textarea
            defaultValue={choice.endingMessage}
            onBlur={e => onUpdateChoice(choice.id, { endingMessage: e.target.value })}
            placeholder="What happens (shown to the reader on a full-screen overlay)…"
            rows={3}
            className="w-full mt-2 bg-black/20 border border-black/20 rounded px-2 py-1.5 text-xs text-ink placeholder:text-ink-faint outline-none focus:border-accent/50 resize-none"
          />
        )}
      </div>
    </div>
  )
}

function ConditionRow({ condition, variables, onChange }: {
  condition: string | null
  variables: Variable[]
  onChange: (next: string | null) => void
}) {
  const [menuOpen, setMenuOpen] = useState(false)
  const menuRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    function onDown(e: MouseEvent) {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) setMenuOpen(false)
    }
    document.addEventListener('mousedown', onDown)
    return () => document.removeEventListener('mousedown', onDown)
  }, [])

  const parsed = condition ? JSON.parse(condition) as Record<string, unknown> : {}
  const attachedNames = new Set(Object.keys(parsed))
  const attachedVars = variables.filter(v => attachedNames.has(v.name))
  const unattachedVars = variables.filter(v => !attachedNames.has(v.name))

  function save(next: Record<string, unknown>) {
    const cleaned: Record<string, unknown> = {}
    for (const [k, v] of Object.entries(next)) if (v !== undefined) cleaned[k] = v
    onChange(Object.keys(cleaned).length === 0 ? null : JSON.stringify(cleaned))
  }

  function setVal(name: string, val: unknown) {
    const updated = { ...parsed }
    if (val === undefined) delete updated[name]; else updated[name] = val
    save(updated)
  }

  function detach(name: string) {
    const updated = { ...parsed }; delete updated[name]; save(updated)
  }

  function attach(v: Variable) {
    save({ ...parsed, [v.name]: DEFAULT_VALUE[v.type] ?? '' })
    setMenuOpen(false)
  }

  return (
    <div className="flex items-center gap-2 mb-2 flex-wrap">
      <span className="text-xs text-ink-faint uppercase tracking-widest shrink-0">Show if:</span>
      {attachedVars.length === 0 && (
        <span className="text-xs text-ink-faint italic">always</span>
      )}
      {attachedVars.map(v => (
        <div key={v.id} className="flex items-center gap-1 bg-black/20 border border-black/20 rounded px-2 py-0.5">
          <span className="text-xs text-ink-muted">{v.name}</span>
          <span className="text-xs text-ink-faint">=</span>
          <div className="w-24">
            <ValueSetter v={v} currentVal={parsed[v.name]} onChange={val => setVal(v.name, val)} />
          </div>
          <button onClick={() => detach(v.name)} className="text-ink-muted hover:text-choice-kill transition shrink-0">
            <LuX size={11} />
          </button>
        </div>
      ))}
      {unattachedVars.length > 0 && (
        <div ref={menuRef} className="relative">
          <button
            onClick={() => setMenuOpen(o => !o)}
            className="text-ink-muted hover:text-ink transition text-sm leading-none px-1"
          >
            +
          </button>
          {menuOpen && (
            <div className="absolute left-0 top-full mt-1 bg-surface-raised border border-accent/20 rounded-lg shadow-xl z-10 overflow-hidden min-w-[200px]">
              {unattachedVars.map(v => (
                <button
                  key={v.id}
                  onClick={() => attach(v)}
                  className="flex items-center justify-between w-full px-4 py-2 text-sm text-ink-muted hover:text-ink hover:bg-surface-overlay transition text-left gap-4"
                >
                  <span>{v.name}</span>
                  <span className="text-ink-faint text-xs">{v.type}</span>
                </button>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  )
}

export default function ChoicePointBlock({ prompt, displayType, condition, choices, variables, onUpdateBlock, onUpdateChoice, onCreateVariable }: Props) {
  const yesChoice = choices.find(c => c.label === 'Yes')
  const noChoice  = choices.find(c => c.label === 'No')

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
        placeholder="Yes or no question (e.g. Does Jared take the shot?)"
        defaultValue={prompt ?? ''}
        onBlur={e => onUpdateBlock({ prompt: e.target.value })}
        className="w-full bg-transparent border-none outline-none text-sm italic text-ink-muted placeholder:text-ink-faint mb-3 px-0"
      />

      <div className="flex gap-3">
        {yesChoice && (
          <ChoicePanel
            choice={yesChoice} label="If yes:" labelClass="text-choice-spare"
            bgClass="bg-choice-spare-bg" borderClass="border-choice-spare-border"
            variables={variables} onUpdateChoice={onUpdateChoice} onCreateVariable={onCreateVariable}
          />
        )}
        {noChoice && (
          <ChoicePanel
            choice={noChoice} label="If no:" labelClass="text-choice-kill"
            bgClass="bg-choice-kill-bg" borderClass="border-choice-kill-border"
            variables={variables} onUpdateChoice={onUpdateChoice} onCreateVariable={onCreateVariable}
          />
        )}
      </div>
    </div>
  )
}
