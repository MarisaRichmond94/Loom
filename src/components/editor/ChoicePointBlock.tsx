'use client'

import { useState, useRef, useEffect } from 'react'
import { LuCheck, LuX } from 'react-icons/lu'
import { ConditionRow, ValueSetter, TYPE_DEFAULT_VALUE } from './conditionUI'
import TextBlock from './TextBlock'
import type { Editor } from '@tiptap/core'
import type { SearchOptions } from '@/lib/searchMatch'

type Character = { id: string; name: string; age?: number | null; hasAvatar?: boolean }

// Set/add/subtract for number-type variables on a choice's setsVariables.
// Primitive values (legacy on-disk shape) parse as "Set to"; the {op,value}
// shape carries deltas. Writes back as a primitive when op === '=' so
// existing data stays in its original form unless the writer flips to a
// counter operation.
type NumberSetValue = number | { op: '=' | '+=' | '-='; value: number }
function NumberSetWithOp({ value, onChange, autoFocus }: { value: unknown; onChange: (v: NumberSetValue) => void; autoFocus?: boolean }) {
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
        autoFocus={autoFocus}
        type="number"
        value={num}
        onChange={e => update(op, Number(e.target.value))}
        className={`${baseCls} w-20 px-2 py-1 [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none`}
      />
    </div>
  )
}

type Choice = { id: string; order: number; label: string; setsVariables: string; targetChapterId: string | null; endingMessage?: string | null; isBadEnding?: boolean; condition?: string | null }
type Variable = { id: string; name: string; type: string; defaultValue?: string }

type Props = {
  prompt: string | null
  displayType: string | null
  condition: string | null
  choices: Choice[]
  variables: Variable[]
  characters?: Character[]
  searchQuery?: string
  searchOptions?: SearchOptions
  // Registers each choice's branch-text editor for search jump/replace, keyed
  // by choice id (null on unmount).
  onEditorReady?: (choiceId: string, editor: Editor | null) => void
  onUpdateBlock: (data: Partial<{ displayType: string; prompt: string; condition: string | null }>) => void
  onUpdateChoice: (choiceId: string, data: Partial<Choice>) => void
  onAddChoice: () => void
  onDeleteChoice: (choiceId: string) => void
  onCreateVariable: (name: string, type: string, defaultValue?: unknown) => Promise<void>
}

const VAR_TYPES = ['string', 'number', 'boolean'] as const
const DEFAULT_VALUE = TYPE_DEFAULT_VALUE

// The value the sibling branch should receive when a writer creates a new
// variable from one branch. Booleans flip — the typical pattern is "the
// two branches set the same flag to opposite values". Strings and numbers
// don't have a meaningful "opposite", so they go to the type's zero and
// the writer can edit the sibling's value directly after creation.
function siblingValueFor(type: typeof VAR_TYPES[number], thisBranchValue: unknown): unknown {
  if (type === 'boolean') return !(thisBranchValue as boolean)
  if (type === 'number') return 0
  return ''
}

function ChoicePanel({
  choice, slotPlaceholder, labelClass, bgClass, borderClass,
  variables, characters, hasSibling, focusVarName, searchQuery, searchOptions, onEditorReady, onUpdateChoice, onCreateAndPair,
  onDelete, onConditionChange,
}: {
  choice: Choice; slotPlaceholder: string; labelClass: string; bgClass: string; borderClass: string
  variables: Variable[]
  characters?: Character[]
  searchQuery?: string
  searchOptions?: SearchOptions
  onEditorReady?: (choiceId: string, editor: Editor | null) => void
  hasSibling: boolean
  // Present only for gate-eligible extra options (order >= 2): a delete
  // affordance and a "Show if" condition editor. The base pair passes
  // neither — they can't be removed or gated.
  onDelete?: () => void
  onConditionChange?: (next: string | null) => void
  // When the parent has just paired a newly-created variable onto this
  // panel as the sibling, this carries that variable's name so the
  // panel can autoFocus its input — useful for string vars where the
  // writer needs to immediately type the alternate value.
  focusVarName: string | null
  onUpdateChoice: Props['onUpdateChoice']
  onCreateAndPair: (params: {
    fromChoiceId: string
    name: string
    type: typeof VAR_TYPES[number]
    defaultValue: unknown
    thisBranchValue: unknown
    otherBranchValue: unknown
  }) => Promise<void>
}) {
  const [menuOpen, setMenuOpen] = useState(false)
  const [showCreate, setShowCreate] = useState(false)
  const [showAttach, setShowAttach] = useState(false)
  const [attachQuery, setAttachQuery] = useState('')
  const [newName, setNewName] = useState('')
  const [newType, setNewType] = useState<typeof VAR_TYPES[number]>('boolean')
  const [newDefault, setNewDefault] = useState<unknown>('')
  const [newThisVal, setNewThisVal] = useState<unknown>('')
  const [newOtherVal, setNewOtherVal] = useState<unknown>('')
  // Tracks whether the writer has manually edited the other-branch value.
  // Until they do, it stays paired with this-branch — flipping a boolean
  // on this-branch flips the other side too. Once edited, the writer
  // owns it and we stop auto-pairing.
  const [otherEdited, setOtherEdited] = useState(false)
  const menuRef = useRef<HTMLDivElement>(null)
  const attachSearchRef = useRef<HTMLInputElement>(null)

  // Reset value pickers whenever the writer changes the type or opens the
  // form fresh. Default → type's zero. This-branch defaults to the OPPOSITE
  // of the canon value for booleans (writers usually flag a special branch
  // by flipping the canon), and to the same zero otherwise. Other-branch
  // is auto-paired off this-branch via siblingValueFor.
  useEffect(() => {
    const zero = DEFAULT_VALUE[newType] ?? ''
    const thisVal = newType === 'boolean' ? !(zero as boolean) : zero
    setNewDefault(zero)
    setNewThisVal(thisVal)
    setNewOtherVal(siblingValueFor(newType, thisVal))
    setOtherEdited(false)
  }, [newType, showCreate])

  // Auto-pair the other branch as long as the writer hasn't taken it over.
  useEffect(() => {
    if (otherEdited) return
    setNewOtherVal(siblingValueFor(newType, newThisVal))
  }, [newThisVal, newType, otherEdited])

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
    // Attach to THIS branch with the writer's chosen this-branch value
    // immediately so the local row renders even before the variable
    // creation round-trips. Parent then creates the variable and pairs
    // it onto the sibling panel.
    save({ ...vars, [name]: newThisVal })
    await onCreateAndPair({
      fromChoiceId: choice.id,
      name,
      type: newType,
      defaultValue: newDefault,
      thisBranchValue: newThisVal,
      otherBranchValue: newOtherVal,
    })
    setNewName(''); setNewType('boolean'); setShowCreate(false); setMenuOpen(false)
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
        {onDelete && (
          <button
            onClick={onDelete}
            title="Remove this option"
            className="text-ink-faint hover:text-choice-kill transition shrink-0"
          >
            <LuX size={14} />
          </button>
        )}
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

      {/* Gate for extra options — the reader only sees this option when the
          condition matches (base pair renders unconditionally, so it passes
          no onConditionChange). Reuses the same ConditionRow the block-level
          gate and conditional fragments use. */}
      {onConditionChange && (
        <div className="mb-2">
          <ConditionRow
            condition={choice.condition ?? null}
            variables={variables}
            onChange={onConditionChange}
          />
        </div>
      )}

      {/* Attached variables */}
      <div className="flex flex-col gap-2 mb-2">
        {attachedVars.length === 0 && !showCreate && (
          <p className="text-xs text-ink-faint italic">No context applied yet</p>
        )}
        {attachedVars.map(v => {
          const shouldFocus = v.name === focusVarName
          return (
            <div key={v.id} className="flex items-center gap-2">
              <span className="text-xs text-ink-muted truncate min-w-0" title={v.name}>{v.name}</span>
              {/* Number setter is compact (op dropdown + ~80px input) and
                  sits flush against the X; ValueSetter for boolean/string
                  still wraps in flex-1 so its full-width inputs stretch. */}
              {v.type === 'number' ? (
                <NumberSetWithOp value={vars[v.name]} onChange={val => setVal(v.name, val)} autoFocus={shouldFocus} />
              ) : (
                <div className="flex-1">
                  <ValueSetter v={v} currentVal={vars[v.name]} onChange={val => setVal(v.name, val)} autoFocus={shouldFocus} />
                </div>
              )}
              <button onClick={() => detach(v.name)} className="text-ink-muted hover:text-choice-kill transition shrink-0"><LuX size={13} /></button>
            </div>
          )
        })}
      </div>

      {/* Create new inline form. Row 1: name (wide) + type. Row 2: Default,
          This branch, Other branch value pickers + save/cancel. Other-branch
          is pre-filled from this-branch (boolean → opposite, number → 0,
          string → empty) but the writer can override before submitting. */}
      {showCreate && (
        <form onSubmit={handleCreate} className="flex flex-col gap-2 mt-2">
          <div className="flex items-center gap-2">
            <input
              autoFocus
              value={newName}
              onChange={e => setNewName(e.target.value)}
              onKeyDown={e => e.key === 'Escape' && (setShowCreate(false))}
              placeholder="Enter the name of the variable"
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
          </div>
          <div className="flex items-center gap-2 text-xs">
            <span className="text-ink-faint uppercase tracking-wider shrink-0">Default</span>
            <div className="flex-1 min-w-0">
              <ValueSetter
                v={{ id: '_new_default', name: '_new', type: newType }}
                currentVal={newDefault}
                onChange={val => setNewDefault(val ?? (DEFAULT_VALUE[newType] ?? ''))}
              />
            </div>
            <span className="text-ink-faint uppercase tracking-wider shrink-0 ml-1">This branch</span>
            <div className="flex-1 min-w-0">
              <ValueSetter
                v={{ id: '_new_thisval', name: '_new', type: newType }}
                currentVal={newThisVal}
                onChange={val => setNewThisVal(val ?? (DEFAULT_VALUE[newType] ?? ''))}
              />
            </div>
            {hasSibling && (
              <>
                <span className="text-ink-faint uppercase tracking-wider shrink-0 ml-1">Other branch</span>
                <div className="flex-1 min-w-0">
                  <ValueSetter
                    v={{ id: '_new_otherval', name: '_new', type: newType }}
                    currentVal={newOtherVal}
                    onChange={val => { setNewOtherVal(val ?? (DEFAULT_VALUE[newType] ?? '')); setOtherEdited(true) }}
                  />
                </div>
              </>
            )}
            <button type="submit" className="text-accent px-1 shrink-0"><LuCheck size={13} /></button>
            <button type="button" onClick={() => setShowCreate(false)} className="text-ink-faint px-1 shrink-0"><LuX size={13} /></button>
          </div>
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
          searchQuery={searchQuery} searchOptions={searchOptions}
          onEditorReady={onEditorReady ? editor => onEditorReady(choice.id, editor) : undefined}
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


export default function ChoicePointBlock({ prompt, displayType, condition, choices, variables, characters, searchQuery, searchOptions, onEditorReady, onUpdateBlock, onUpdateChoice, onAddChoice, onDeleteChoice, onCreateVariable }: Props) {
  // Order the options and split into the base pair (orders 0/1) and the
  // gate-eligible extras (order >= 2). The base pair keeps the green/red
  // "spare"/"kill" slots — visual differentiation only, not a yes/no
  // signal, so writers can rename them to anything ("A phone" / "A
  // laptop"). Extras render below with a "Show if" gate and a remove
  // affordance.
  const ordered = [...choices].sort((a, b) => a.order - b.order)
  const baseChoices = ordered.filter(c => c.order < 2)
  const extraChoices = ordered.filter(c => c.order >= 2)
  const primaryChoice = baseChoices[0] ?? null
  const secondaryChoice = baseChoices[1] ?? null

  // After creating a variable from one panel, signal the sibling to
  // autoFocus the freshly-paired row — keyed by { choiceId: varName } so
  // each panel only picks up its own focus targets. React's autoFocus
  // fires on mount only, so the signal can stay set without re-focusing
  // on unrelated rerenders.
  const [pairedFocus, setPairedFocus] = useState<{ choiceId: string; varName: string } | null>(null)

  async function handleCreateAndPair({ fromChoiceId, name, type, defaultValue, otherBranchValue }: {
    fromChoiceId: string; name: string; type: typeof VAR_TYPES[number]; defaultValue: unknown; thisBranchValue: unknown; otherBranchValue: unknown
  }) {
    await onCreateVariable(name, type, defaultValue)
    // Auto-pairing is a base-pair convenience ("the two branches flip the
    // same flag"), so the sibling is the OTHER base option — never an extra.
    const sibling = baseChoices.find(c => c.id !== fromChoiceId)
    if (!sibling) return
    const siblingVars = JSON.parse(sibling.setsVariables || '{}') as Record<string, unknown>
    onUpdateChoice(sibling.id, {
      setsVariables: JSON.stringify({ ...siblingVars, [name]: otherBranchValue }),
    })
    setPairedFocus({ choiceId: sibling.id, varName: name })
  }

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
            hasSibling={!!secondaryChoice}
            focusVarName={pairedFocus?.choiceId === primaryChoice.id ? pairedFocus.varName : null}
            searchQuery={searchQuery} searchOptions={searchOptions} onEditorReady={onEditorReady}
            onUpdateChoice={onUpdateChoice} onCreateAndPair={handleCreateAndPair}
          />
        )}
        {secondaryChoice && (
          <ChoicePanel
            choice={secondaryChoice} slotPlaceholder="Choice 2" labelClass="text-choice-kill"
            bgClass="bg-choice-kill-bg" borderClass="border-choice-kill-border"
            variables={variables} characters={characters}
            hasSibling={!!primaryChoice}
            focusVarName={pairedFocus?.choiceId === secondaryChoice.id ? pairedFocus.varName : null}
            searchQuery={searchQuery} searchOptions={searchOptions} onEditorReady={onEditorReady}
            onUpdateChoice={onUpdateChoice} onCreateAndPair={handleCreateAndPair}
          />
        )}

        {/* Gate-eligible extras — accent-styled, each with its own "Show if"
            condition and a remove button. No auto-pair (hasSibling=false):
            an extra sets its own variables directly. */}
        {extraChoices.map((choice, i) => (
          <ChoicePanel
            key={choice.id}
            choice={choice} slotPlaceholder={`Option ${i + 3}`} labelClass="text-accent"
            bgClass="bg-accent/5" borderClass="border-accent/25"
            variables={variables} characters={characters}
            hasSibling={false}
            focusVarName={pairedFocus?.choiceId === choice.id ? pairedFocus.varName : null}
            searchQuery={searchQuery} searchOptions={searchOptions} onEditorReady={onEditorReady}
            onUpdateChoice={onUpdateChoice} onCreateAndPair={handleCreateAndPair}
            onDelete={() => onDeleteChoice(choice.id)}
            onConditionChange={next => onUpdateChoice(choice.id, { condition: next })}
          />
        ))}

        <button
          onClick={onAddChoice}
          className="self-start mt-1 px-3 py-1.5 rounded border border-accent/25 text-accent text-xs hover:bg-accent/10 transition"
        >
          + Add option
        </button>
      </div>
    </div>
  )
}
