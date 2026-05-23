'use client'

import { useEffect, useRef, useState, type ReactNode } from 'react'
import { LuX } from 'react-icons/lu'

export type ConditionVariable = { id: string; name: string; type: string }

export const TYPE_DEFAULT_VALUE: Record<string, unknown> = { string: '', number: 0, boolean: false }

const baseCls = 'bg-black/20 border border-black/20 rounded pl-2 py-1 text-xs text-ink outline-none focus:border-accent/50 w-full'

export function ValueSetter({ v, currentVal, onChange }: {
  v: ConditionVariable
  currentVal: unknown
  onChange: (val: unknown) => void
}) {
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

export function ConditionRow({ condition, variables, onChange, label = 'Show if:', labelExtra }: {
  condition: string | null
  variables: ConditionVariable[]
  onChange: (next: string | null) => void
  label?: string
  labelExtra?: ReactNode
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

  function attach(v: ConditionVariable) {
    save({ ...parsed, [v.name]: TYPE_DEFAULT_VALUE[v.type] ?? '' })
    setMenuOpen(false)
  }

  return (
    <div className="flex items-center gap-2 mb-2 flex-wrap">
      <span className="text-xs text-ink-faint uppercase tracking-widest shrink-0">{label}</span>
      {labelExtra}
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
