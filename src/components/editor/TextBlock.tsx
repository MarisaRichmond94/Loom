'use client'

import { useEditor, EditorContent } from '@tiptap/react'
import StarterKit from '@tiptap/starter-kit'
import Placeholder from '@tiptap/extension-placeholder'
import TextAlign from '@tiptap/extension-text-align'
import { Extension, InputRule, Mark, mergeAttributes } from '@tiptap/core'

// Custom mark — addAttributes() path guarantees color renders in the live editor
const TextStyleColor = Mark.create({
  name: 'textStyle',
  priority: 101,
  addAttributes() {
    return {
      color: {
        default: null,
        parseHTML: element => (element as HTMLElement).style?.color?.replace(/['"]+/g, '') || null,
        renderHTML: attributes => {
          if (!attributes.color) return {}
          return { style: `color: ${attributes.color}` }
        },
      },
    }
  },
  parseHTML() {
    return [{ tag: 'span', consuming: false, getAttrs: element => (element as HTMLElement).style?.color ? {} : false }]
  },
  renderHTML({ HTMLAttributes }) {
    return ['span', mergeAttributes(HTMLAttributes), 0]
  },
})

const EmDash = Extension.create({
  name: 'emDash',
  addInputRules() {
    return [new InputRule({ find: /--$/, handler: ({ state, range }) => {
      state.tr.replaceWith(range.from, range.to, state.schema.text('—'))
    } })]
  },
})

const SectionBreak = Extension.create({
  name: 'sectionBreak',
  addKeyboardShortcuts() {
    return {
      'Alt-Shift-b': () => this.editor.chain().focus().setHorizontalRule().run(),
      'Alt-Shift-Enter': () => this.editor.chain().focus().setHorizontalRule().run(),
    }
  },
})

import { useEffect, useRef, useState } from 'react'
import {
  LuMessageSquare, LuCheck, LuX, LuPencil, LuUser,
  LuAlignLeft, LuAlignCenter, LuAlignRight, LuAlignJustify,
  LuBold, LuItalic, LuUnderline, LuStrikethrough, LuMinus,
} from 'react-icons/lu'
import { Footnote } from '@/lib/extensions/footnote'
import { CharacterMark } from '@/lib/extensions/character'
import { VariableHighlight } from '@/lib/extensions/variableHighlight'
import VariableSuggestionList from './VariableSuggestionList'
import { buildCharterClipboard } from '@/lib/clipboardFormatting'
import { DOMSerializer } from '@tiptap/pm/model'

type Character = { id: string; name: string; age?: number | null; hasAvatar?: boolean }
type Variable = { id: string; name: string; type: string }

type Props = {
  content: string | null
  onChange: (json: string) => void
  autoFocus?: boolean
  characters?: Character[]
  variables?: Variable[]
  placeholder?: string
}

const EMPTY = '{"type":"doc","content":[{"type":"paragraph"}]}'

// Legacy rows (pre-TipTap branch text / override endingMessage) stored
// plain strings. JSON.parse on those would crash the editor on load,
// so wrap any non-JSON content into a one-paragraph-per-line TipTap doc
// — the writer's next save persists it in the new shape.
function parseContent(raw: string): unknown {
  try {
    return JSON.parse(raw)
  } catch {
    const paragraphs = raw.split(/\n+/).map(line => {
      const trimmed = line.trim()
      return trimmed
        ? { type: 'paragraph', content: [{ type: 'text', text: trimmed }] }
        : { type: 'paragraph' }
    })
    return { type: 'doc', content: paragraphs.length > 0 ? paragraphs : [{ type: 'paragraph' }] }
  }
}

const COLOR_PRESETS = [
  { label: 'Red',    value: '#ef4444' },
  { label: 'Rose',   value: '#f43f5e' },
  { label: 'Orange', value: '#f97316' },
  { label: 'Amber',  value: '#f59e0b' },
  { label: 'Emerald',value: '#10b981' },
  { label: 'Blue',   value: '#3b82f6' },
  { label: 'Violet', value: '#8b5cf6' },
  { label: 'Gray',   value: '#9ca3af' },
]

function Sep() {
  return <span className="w-px h-4 bg-accent/20 mx-1 shrink-0" />
}

function ToolBtn({ active, onClick, title, children }: {
  active?: boolean
  onClick: () => void
  title: string
  children: React.ReactNode
}) {
  return (
    <button
      onMouseDown={e => { e.preventDefault(); onClick() }}
      title={title}
      className={`px-1.5 py-1 rounded text-xs transition ${active ? 'bg-accent/30 text-accent' : 'text-ink-faint hover:text-ink hover:bg-surface-muted'}`}
    >
      {children}
    </button>
  )
}

// Keeps the caret comfortably inside the scrolling viewport as the writer
// types. ProseMirror's built-in scrollIntoView only fires when the caret
// goes fully off-screen — that lets text crawl down to the bottom edge
// before scrolling, so the writer can't see the line they're typing on.
// We scroll proactively once the caret enters a margin zone at the top
// or bottom of the scrolling ancestor.
const CARET_MARGIN = 96
function keepCaretInView(editor: { view: { coordsAtPos: (pos: number) => { top: number; bottom: number }; dom: HTMLElement }; state: { selection: { head: number } } }) {
  // Defer to the next frame so the new line has been laid out — otherwise
  // coordsAtPos returns the pre-update caret position and we under-scroll.
  requestAnimationFrame(() => {
    const caret = editor.view.coordsAtPos(editor.state.selection.head)
    // Find the nearest scrolling ancestor by overflow alone; don't require
    // it to be actively overflowing at this instant — it's the container
    // *meant* to scroll regardless of current content height.
    let el: HTMLElement | null = editor.view.dom.parentElement
    while (el && el !== document.body) {
      const style = getComputedStyle(el)
      if (/(auto|scroll)/.test(style.overflowY)) break
      el = el.parentElement
    }
    const root = el && el !== document.body ? el : (document.scrollingElement as HTMLElement | null) ?? document.documentElement
    const usesWindow = root === document.scrollingElement || root === document.documentElement
    const viewTop = usesWindow ? 0 : root.getBoundingClientRect().top
    const viewBottom = usesWindow ? window.innerHeight : root.getBoundingClientRect().bottom
    if (caret.bottom > viewBottom - CARET_MARGIN) {
      const delta = caret.bottom - (viewBottom - CARET_MARGIN)
      if (usesWindow) window.scrollBy(0, delta)
      else root.scrollTop += delta
    } else if (caret.top < viewTop + CARET_MARGIN) {
      const delta = caret.top - (viewTop + CARET_MARGIN)
      if (usesWindow) window.scrollBy(0, delta)
      else root.scrollTop += delta
    }
  })
}

export default function TextBlock({ content, onChange, autoFocus, characters = [], variables = [], placeholder = 'Write your prose here…' }: Props) {
  const [menuPos, setMenuPos] = useState<{ x: number; y: number } | null>(null)
  // footnote state
  const [showInput, setShowInput] = useState(false)
  const [footnoteViewMode, setFootnoteViewMode] = useState(false)
  const [footnoteText, setFootnoteText] = useState('')
  // character state
  const [showCharPicker, setShowCharPicker] = useState(false)
  const [charSearch, setCharSearch] = useState('')
  const [characterViewMode, setCharacterViewMode] = useState(false)
  const [characterViewId, setCharacterViewId] = useState('')
  const [characterViewName, setCharacterViewName] = useState('')

  const [focused, setFocused] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)
  const charSearchRef = useRef<HTMLInputElement>(null)
  const savedSelection = useRef<{ from: number; to: number } | null>(null)
  const localEditRef = useRef(false)
  const variablesRef = useRef(variables)
  variablesRef.current = variables
  const [varSuggest, setVarSuggest] = useState<{ from: number; query: string; coords: { x: number; y: number } } | null>(null)
  const [varSelectedIdx, setVarSelectedIdx] = useState(0)

  const editor = useEditor({
    immediatelyRender: false,
    extensions: [
      StarterKit,
      Placeholder.configure({ placeholder }),
      Footnote,
      CharacterMark,
      VariableHighlight.configure({
        getVariableNames: () => variablesRef.current.map(v => v.name),
      }),
      TextAlign.configure({ types: ['paragraph', 'heading'] }),
      TextStyleColor,
      EmDash,
      SectionBreak,
    ],
    content: content ? parseContent(content) : JSON.parse(EMPTY),
    onUpdate: ({ editor }) => {
      localEditRef.current = true
      onChange(JSON.stringify(editor.getJSON()))
      keepCaretInView(editor)
    },
    onSelectionUpdate: ({ editor }) => { keepCaretInView(editor) },
    onFocus: () => setFocused(true),
    onBlur: ({ editor }) => { setFocused(false); editor.commands.setTextSelection(editor.state.selection.anchor) },
  })

  useEffect(() => {
    if (editor && content) {
      if (localEditRef.current) { localEditRef.current = false; return }
      const current = JSON.stringify(editor.getJSON())
      if (current !== content) editor.commands.setContent(JSON.parse(content))
    }
  }, [editor, content])

  // When the variables list changes, force decorations to re-evaluate
  // (the ref already has the latest; this just triggers redraw)
  useEffect(() => {
    if (editor) editor.view.dispatch(editor.state.tr)
  }, [editor, variables])

  // Native Cmd+C / Ctrl+C out of any text block (normal or conditional override)
  // produces the same Charter / 11px clipboard payload that the reader's
  // "copy chapter" button produces — alignment, italics, bold, first-line
  // indents, and tight paragraph spacing all survive into Pages/Docs/Word.
  useEffect(() => {
    if (!editor) return
    const dom = editor.view.dom
    function onCopy(event: ClipboardEvent) {
      if (!editor) return
      const { from, to, empty } = editor.state.selection
      if (empty) return
      const slice = editor.state.doc.slice(from, to)
      const fragment = DOMSerializer.fromSchema(editor.schema).serializeFragment(slice.content)
      const container = document.createElement('div')
      container.appendChild(fragment)
      const { html, text } = buildCharterClipboard(container.innerHTML)
      event.preventDefault()
      event.clipboardData?.setData('text/html', html)
      event.clipboardData?.setData('text/plain', text)
    }
    dom.addEventListener('copy', onCopy)
    return () => dom.removeEventListener('copy', onCopy)
  }, [editor])

  // Detect `{{` trigger and track the query for the variable suggestion popover
  useEffect(() => {
    if (!editor) return
    function check() {
      if (!editor) return
      const { selection } = editor.state
      if (!selection.empty) { setVarSuggest(null); return }
      const cursorPos = selection.from
      const lookback = Math.max(0, cursorPos - 50)
      const before = editor.state.doc.textBetween(lookback, cursorPos, '\n', '')
      const match = before.match(/\{\{([a-zA-Z0-9_$]*)$/)
      if (match) {
        const from = cursorPos - match[0].length
        const coords = editor.view.coordsAtPos(cursorPos)
        setVarSuggest({ from, query: match[1], coords: { x: coords.left, y: coords.bottom } })
        setVarSelectedIdx(0)
      } else {
        setVarSuggest(null)
      }
    }
    editor.on('update', check)
    editor.on('selectionUpdate', check)
    return () => {
      editor.off('update', check)
      editor.off('selectionUpdate', check)
    }
  }, [editor])

  const filteredVars = varSuggest
    ? variables.filter(v => v.name.toLowerCase().includes(varSuggest.query.toLowerCase()))
    : []

  // Keep selectedIdx in bounds when filter narrows
  useEffect(() => {
    if (varSelectedIdx >= filteredVars.length && filteredVars.length > 0) {
      setVarSelectedIdx(filteredVars.length - 1)
    }
  }, [filteredVars.length, varSelectedIdx])

  // Keyboard nav while the popover is open — capture phase so we beat ProseMirror
  useEffect(() => {
    if (!varSuggest) return
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') { e.preventDefault(); setVarSuggest(null); return }
      if (filteredVars.length === 0) return
      if (e.key === 'ArrowDown') {
        e.preventDefault()
        setVarSelectedIdx(i => Math.min(i + 1, filteredVars.length - 1))
      } else if (e.key === 'ArrowUp') {
        e.preventDefault()
        setVarSelectedIdx(i => Math.max(i - 1, 0))
      } else if (e.key === 'Enter') {
        e.preventDefault()
        const v = filteredVars[varSelectedIdx]
        if (v) applyVarSuggest(v)
      }
    }
    document.addEventListener('keydown', onKey, true)
    return () => document.removeEventListener('keydown', onKey, true)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [varSuggest, filteredVars, varSelectedIdx])

  function applyVarSuggest(v: Variable) {
    if (!editor || !varSuggest) return
    const cursorPos = editor.state.selection.from
    const docSize = editor.state.doc.content.size
    // If cursor is already in front of an existing `}}`, don't add a duplicate closer
    const lookAhead = editor.state.doc.textBetween(cursorPos, Math.min(cursorPos + 2, docSize), '', '')
    const addedCloser = lookAhead !== '}}'
    const insertion = addedCloser ? `{{${v.name}}}` : `{{${v.name}`
    const chain = editor.chain().focus()
      .deleteRange({ from: varSuggest.from, to: cursorPos })
      .insertContent(insertion)
    // Park the cursor *inside* the braces so the writer can keep typing —
    // typical next step is a ternary suffix like ` ? a : b`. With no
    // closer added, the cursor already lands at that spot.
    if (addedCloser) {
      const insertEnd = varSuggest.from + insertion.length
      chain.setTextSelection(insertEnd - 2)
    }
    chain.run()
    setVarSuggest(null)
  }

  useEffect(() => {
    if (autoFocus && editor) editor.commands.focus('end')
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editor])

  useEffect(() => {
    if (!editor) return
    const update = () => {
      if (showInput || showCharPicker) return
      const { empty, from, to } = editor.state.selection

      if (editor.isActive('footnote')) {
        const coords = editor.view.coordsAtPos(from)
        savedSelection.current = { from, to: empty ? from : to }
        setFootnoteText(editor.getAttributes('footnote').content ?? '')
        setFootnoteViewMode(true)
        setCharacterViewMode(false)
        setMenuPos({ x: coords.left, y: coords.top })
        return
      }

      if (editor.isActive('character')) {
        const coords = editor.view.coordsAtPos(from)
        savedSelection.current = { from, to: empty ? from : to }
        setCharacterViewId(editor.getAttributes('character').id ?? '')
        setCharacterViewName(editor.getAttributes('character').name ?? '')
        setCharacterViewMode(true)
        setFootnoteViewMode(false)
        setMenuPos({ x: coords.left, y: coords.top })
        return
      }

      setFootnoteViewMode(false)
      setCharacterViewMode(false)
      if (empty || from === to) { setMenuPos(null); return }
      const start = editor.view.coordsAtPos(from)
      const end = editor.view.coordsAtPos(to)
      savedSelection.current = { from, to }
      setMenuPos({ x: (start.left + end.left) / 2, y: start.top })
    }
    editor.on('selectionUpdate', update)
    return () => { editor.off('selectionUpdate', update) }
  }, [editor, showInput, showCharPicker])

  // The selection popover is positioned in fixed viewport coordinates from
  // editor.view.coordsAtPos at the moment selection happens. When the user
  // scrolls, those coordinates go stale and the menu lingers detached from
  // the selection. Dismiss it on any scroll inside an ancestor (capture
  // catches scroll events from any scrolling parent, not just window).
  //
  // Only active while the menu is in its initial Footnote/Character state —
  // once the user has committed to typing a footnote or picking a character,
  // a stray scroll (which the input's own focus call can synthesize) must
  // not wipe out their in-progress sub-menu.
  useEffect(() => {
    if (!menuPos || showInput || showCharPicker) return
    function onScroll() {
      setMenuPos(null)
    }
    window.addEventListener('scroll', onScroll, { capture: true, passive: true })
    return () => window.removeEventListener('scroll', onScroll, { capture: true })
  }, [menuPos, showInput, showCharPicker])

  useEffect(() => {
    if (showInput) inputRef.current?.focus()
  }, [showInput])

  useEffect(() => {
    if (showCharPicker) charSearchRef.current?.focus()
    else setCharSearch('')
  }, [showCharPicker])

  function openInput() {
    if (!editor) return
    const { from, to } = editor.state.selection
    savedSelection.current = { from, to }
    setShowInput(true)
  }

  function applyFootnote() {
    if (!editor || !footnoteText.trim()) return
    if (footnoteViewMode) {
      editor.chain().focus().extendMarkRange('footnote').setMark('footnote', { content: footnoteText.trim() }).run()
    } else if (savedSelection.current) {
      const { from, to } = savedSelection.current
      editor.chain().focus().setTextSelection({ from, to }).setMark('footnote', { content: footnoteText.trim() }).run()
    }
    setFootnoteText('')
    setShowInput(false)
    setFootnoteViewMode(false)
    setMenuPos(null)
    savedSelection.current = null
  }

  function removeFootnote() {
    if (!editor) return
    editor.chain().focus().extendMarkRange('footnote').unsetMark('footnote').run()
    setFootnoteViewMode(false)
    setMenuPos(null)
    savedSelection.current = null
  }

  function applyCharacter(character: Character) {
    if (!editor || !savedSelection.current) return
    const { from, to } = savedSelection.current
    editor.chain().focus().setTextSelection({ from, to }).setMark('character', { id: character.id, name: character.name }).run()
    setShowCharPicker(false)
    setMenuPos(null)
    savedSelection.current = null
  }

  function removeCharacter() {
    if (!editor) return
    editor.chain().focus().extendMarkRange('character').unsetMark('character').run()
    setCharacterViewMode(false)
    setMenuPos(null)
    savedSelection.current = null
  }

  function cancel() {
    setFootnoteText('')
    setShowInput(false)
    setFootnoteViewMode(false)
    setShowCharPicker(false)
    setCharacterViewMode(false)
    setMenuPos(null)
    savedSelection.current = null
  }

  const currentColor = editor?.getAttributes('textStyle').color as string | undefined
  const menuOpen = showInput || showCharPicker || (focused && !!menuPos)

  return (
    <div>
      {/* Formatting toolbar */}
      {editor && (
        <div
          onMouseDown={e => e.preventDefault()}
          className="sticky top-0 z-10 flex items-center flex-wrap gap-0.5 mb-2 px-1.5 py-1 bg-surface-raised rounded border border-accent/10 shadow-sm"
        >
          <ToolBtn active={editor.isActive('bold')} onClick={() => editor.chain().focus().toggleBold().run()} title="Bold">
            <LuBold size={13} />
          </ToolBtn>
          <ToolBtn active={editor.isActive('italic')} onClick={() => editor.chain().focus().toggleItalic().run()} title="Italic">
            <LuItalic size={13} />
          </ToolBtn>
          <ToolBtn active={editor.isActive('underline')} onClick={() => editor.chain().focus().toggleUnderline().run()} title="Underline (⌘U)">
            <LuUnderline size={13} />
          </ToolBtn>
          <ToolBtn active={editor.isActive('strike')} onClick={() => editor.chain().focus().toggleStrike().run()} title="Strikethrough (⌘⇧X)">
            <LuStrikethrough size={13} />
          </ToolBtn>
          <Sep />
          <ToolBtn active={editor.isActive({ textAlign: 'left' })} onClick={() => editor.chain().focus().setTextAlign('left').run()} title="Align left">
            <LuAlignLeft size={13} />
          </ToolBtn>
          <ToolBtn active={editor.isActive({ textAlign: 'center' })} onClick={() => editor.chain().focus().setTextAlign('center').run()} title="Align center">
            <LuAlignCenter size={13} />
          </ToolBtn>
          <ToolBtn active={editor.isActive({ textAlign: 'right' })} onClick={() => editor.chain().focus().setTextAlign('right').run()} title="Align right">
            <LuAlignRight size={13} />
          </ToolBtn>
          <ToolBtn active={editor.isActive({ textAlign: 'justify' })} onClick={() => editor.chain().focus().setTextAlign('justify').run()} title="Justify">
            <LuAlignJustify size={13} />
          </ToolBtn>
          <Sep />
          <ToolBtn active={false} onClick={() => editor.chain().focus().setHorizontalRule().run()} title="Section break (⌥⇧B)">
            <LuMinus size={13} />
          </ToolBtn>
          <Sep />
          {COLOR_PRESETS.map(({ label, value }) => (
            <button
              key={value}
              onMouseDown={e => {
                e.preventDefault()
                const sel = savedSelection.current
                if (sel && sel.from !== sel.to) {
                  editor.chain().focus().setTextSelection(sel).setMark('textStyle', { color: value }).run()
                } else {
                  editor.chain().focus().setMark('textStyle', { color: value }).run()
                }
              }}
              title={label}
              style={{ background: value }}
              className={`w-4 h-4 rounded-full border-2 transition hover:scale-110 ${currentColor === value ? 'border-white' : 'border-transparent'}`}
            />
          ))}
          <button
            onMouseDown={e => {
              e.preventDefault()
              const sel = savedSelection.current
              if (sel && sel.from !== sel.to) {
                editor.chain().focus().setTextSelection(sel).unsetMark('textStyle').run()
              } else {
                editor.chain().focus().unsetMark('textStyle').run()
              }
            }}
            title="Remove color"
            className="w-4 h-4 rounded-full border border-dashed border-accent/40 hover:border-accent transition flex items-center justify-center text-ink-faint hover:text-ink"
          >
            <LuX size={9} />
          </button>
        </div>
      )}

      {/* Floating mark menu */}
      {menuOpen && (
        <div
          onMouseDown={e => e.preventDefault()}
          style={menuPos
            ? { position: 'fixed', left: menuPos.x, top: menuPos.y - 8, transform: 'translate(-50%, -100%)', zIndex: 9999 }
            : { position: 'fixed', left: '50%', top: '40%', transform: 'translate(-50%, -50%)', zIndex: 9999 }}
          className={`bg-surface-overlay border border-accent/20 rounded shadow-lg overflow-hidden ${showCharPicker ? 'flex flex-col min-w-[160px]' : 'flex items-center'}`}
        >
          {showInput ? (
            <>
              <input
                ref={inputRef}
                value={footnoteText}
                onChange={e => setFootnoteText(e.target.value)}
                onKeyDown={e => { if (e.key === 'Enter') applyFootnote(); if (e.key === 'Escape') cancel() }}
                placeholder="Footnote text…"
                className="px-2 py-1.5 text-xs bg-transparent text-ink outline-none w-52 placeholder:text-ink-faint"
              />
              <button onClick={applyFootnote} className="px-2 py-1.5 text-accent hover:bg-surface-muted transition"><LuCheck size={13} /></button>
              <button onClick={cancel} className="px-2 py-1.5 text-ink-faint hover:bg-surface-muted transition"><LuX size={13} /></button>
            </>
          ) : showCharPicker ? (
            <>
              <div className="px-3 py-1.5 text-xs text-ink-faint uppercase tracking-widest border-b border-accent/10">Tag character</div>
              <input
                ref={charSearchRef}
                value={charSearch}
                onChange={e => setCharSearch(e.target.value)}
                onKeyDown={e => { if (e.key === 'Escape') cancel() }}
                placeholder="Search…"
                className="px-3 py-1.5 text-xs bg-transparent text-ink outline-none w-full placeholder:text-ink-faint border-b border-accent/10"
              />
              <div className="overflow-y-auto" style={{ maxHeight: '144px' }}>
                {(() => {
                  const filtered = characters.filter(c => c.name.toLowerCase().includes(charSearch.toLowerCase()))
                  if (characters.length === 0) return <span className="block px-3 py-2 text-xs text-ink-faint italic">No characters yet</span>
                  if (filtered.length === 0) return <span className="block px-3 py-2 text-xs text-ink-faint italic">No matches</span>
                  return filtered.map(c => (
                    <button
                      key={c.id}
                      onClick={() => applyCharacter(c)}
                      className="w-full text-left px-3 py-2 text-xs text-ink-muted hover:text-ink hover:bg-surface-muted transition flex items-center gap-2"
                    >
                      {c.hasAvatar
                        ? <img src={`/characters/${c.id}.jpg`} className="w-5 h-5 rounded-full object-cover shrink-0" alt="" />
                        : <span className="w-5 h-5 rounded-full bg-accent/20 flex items-center justify-center shrink-0"><LuUser size={10} /></span>
                      }
                      {c.name}
                    </button>
                  ))
                })()}
              </div>
              <button onClick={cancel} className="px-3 py-1.5 text-xs text-ink-faint hover:text-ink hover:bg-surface-muted transition border-t border-accent/10 text-left">Cancel</button>
            </>
          ) : footnoteViewMode ? (
            <>
              <span className="px-3 py-1.5 text-xs text-ink-muted italic truncate max-w-[180px]">{footnoteText}</span>
              <button onClick={() => setShowInput(true)} title="Edit footnote" className="px-2 py-1.5 text-ink-faint hover:text-ink hover:bg-surface-muted transition"><LuPencil size={13} /></button>
              <button onClick={removeFootnote} title="Remove footnote" className="px-2 py-1.5 text-ink-faint hover:text-choice-kill hover:bg-surface-muted transition"><LuX size={13} /></button>
            </>
          ) : characterViewMode ? (
            <>
              {(() => {
                const char = characters.find(c => c.id === characterViewId)
                return char?.hasAvatar
                  ? <img src={`/characters/${characterViewId}.jpg`} className="w-5 h-5 rounded-full object-cover shrink-0 ml-2" alt="" />
                  : <span className="w-5 h-5 rounded-full bg-accent/20 flex items-center justify-center ml-2 shrink-0"><LuUser size={10} className="text-accent" /></span>
              })()}
              <span className="px-2 py-1.5 text-xs text-accent truncate max-w-[160px]">{characterViewName}</span>
              <button onClick={removeCharacter} title="Remove character tag" className="px-2 py-1.5 text-ink-faint hover:text-choice-kill hover:bg-surface-muted transition"><LuX size={13} /></button>
            </>
          ) : (
            <>
              <button onClick={openInput} className="flex items-center gap-1.5 px-3 py-1.5 text-xs text-ink-muted hover:text-ink hover:bg-surface-muted transition">
                <LuMessageSquare size={13} />
                Footnote
              </button>
              {characters.length > 0 && (
                <>
                  <span className="w-px h-4 bg-accent/20 shrink-0" />
                  <button
                    onClick={() => setShowCharPicker(true)}
                    className="flex items-center gap-1.5 px-3 py-1.5 text-xs text-ink-muted hover:text-ink hover:bg-surface-muted transition"
                  >
                    <LuUser size={13} />
                    Character
                  </button>
                </>
              )}
            </>
          )}
        </div>
      )}

      <EditorContent
        editor={editor}
        className="prose prose-invert max-w-none text-ink text-base leading-relaxed [&_.ProseMirror]:outline-none [&_.ProseMirror_p]:text-justify [&_.ProseMirror_p]:indent-8 [&_.ProseMirror_p]:my-0 [&_.ProseMirror_p.is-editor-empty:first-child::before]:text-ink-faint [&_.ProseMirror_p.is-editor-empty:first-child::before]:content-[attr(data-placeholder)] [&_.ProseMirror_p.is-editor-empty:first-child::before]:float-left [&_.ProseMirror_p.is-editor-empty:first-child::before]:pointer-events-none [&_.ProseMirror:focus_p.is-editor-empty:first-child::before]:hidden [&_.ProseMirror_hr]:border-none [&_.ProseMirror_hr]:h-px [&_.ProseMirror_hr]:bg-accent/20 [&_.ProseMirror_hr]:w-1/3 [&_.ProseMirror_hr]:mx-auto [&_.ProseMirror_hr]:my-6 [&_.ProseMirror_hr.ProseMirror-selectednode]:bg-accent/60 [&_.character-ref]:text-accent/80 [&_.character-ref]:underline [&_.character-ref]:decoration-dotted [&_.character-ref]:decoration-accent/40 [&_.character-ref]:cursor-default"
      />

      {varSuggest && (
        <VariableSuggestionList
          variables={filteredVars}
          selectedIdx={varSelectedIdx}
          coords={varSuggest.coords}
          onSelect={applyVarSuggest}
          emptyMessage={variables.length === 0 ? 'No variables yet' : 'No matches'}
        />
      )}
    </div>
  )
}
