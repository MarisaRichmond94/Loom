'use client'

import { useEditor, EditorContent } from '@tiptap/react'
import StarterKit from '@tiptap/starter-kit'
import Placeholder from '@tiptap/extension-placeholder'
import TextAlign from '@tiptap/extension-text-align'
import { TextStyle } from '@tiptap/extension-text-style'
import Color from '@tiptap/extension-color'
import { Extension, InputRule } from '@tiptap/core'

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
  LuMessageSquare, LuCheck, LuX, LuPencil,
  LuAlignLeft, LuAlignCenter, LuAlignRight, LuAlignJustify,
  LuBold, LuItalic, LuMinus,
} from 'react-icons/lu'
import { Footnote } from '@/lib/extensions/footnote'

type Props = {
  content: string | null
  onChange: (json: string) => void
  autoFocus?: boolean
}

const EMPTY = '{"type":"doc","content":[{"type":"paragraph"}]}'

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

export default function TextBlock({ content, onChange, autoFocus }: Props) {
  const [menuPos, setMenuPos] = useState<{ x: number; y: number } | null>(null)
  const [showInput, setShowInput] = useState(false)
  const [footnoteViewMode, setFootnoteViewMode] = useState(false)
  const [footnoteText, setFootnoteText] = useState('')
  const [focused, setFocused] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)
  const savedSelection = useRef<{ from: number; to: number } | null>(null)

  const editor = useEditor({
    immediatelyRender: false,
    extensions: [
      StarterKit,
      Placeholder.configure({ placeholder: 'Write your prose here…' }),
      Footnote,
      TextAlign.configure({ types: ['paragraph', 'heading'] }),
      TextStyle,
      Color,
      EmDash,
      SectionBreak,
    ],
    content: content ? JSON.parse(content) : JSON.parse(EMPTY),
    onUpdate: ({ editor }) => onChange(JSON.stringify(editor.getJSON())),
    onFocus: () => setFocused(true),
    onBlur: () => setFocused(false),
  })

  useEffect(() => {
    if (editor && content) {
      const current = JSON.stringify(editor.getJSON())
      if (current !== content) editor.commands.setContent(JSON.parse(content))
    }
  }, [editor, content])

  useEffect(() => {
    if (autoFocus && editor) editor.commands.focus('end')
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editor])

  useEffect(() => {
    if (!editor) return
    const update = () => {
      if (showInput) return
      const { empty, from, to } = editor.state.selection

      if (editor.isActive('footnote')) {
        const coords = editor.view.coordsAtPos(from)
        savedSelection.current = { from, to: empty ? from : to }
        setFootnoteText(editor.getAttributes('footnote').content ?? '')
        setFootnoteViewMode(true)
        setMenuPos({ x: coords.left, y: coords.top })
        return
      }

      setFootnoteViewMode(false)
      if (empty || from === to) { setMenuPos(null); return }
      const start = editor.view.coordsAtPos(from)
      const end = editor.view.coordsAtPos(to)
      savedSelection.current = { from, to }
      setMenuPos({ x: (start.left + end.left) / 2, y: start.top })
    }
    editor.on('selectionUpdate', update)
    return () => { editor.off('selectionUpdate', update) }
  }, [editor, showInput])

  useEffect(() => {
    if (showInput) inputRef.current?.focus()
  }, [showInput])

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

  function cancel() {
    setFootnoteText('')
    setShowInput(false)
    setFootnoteViewMode(false)
    setMenuPos(null)
    savedSelection.current = null
  }

  const currentColor = editor?.getAttributes('textStyle').color as string | undefined

  return (
    <div>
      {/* Formatting toolbar — visible when editor is focused */}
      {focused && editor && (
        <div
          onMouseDown={e => e.preventDefault()}
          className="flex items-center flex-wrap gap-0.5 mb-2 px-1.5 py-1 bg-surface-raised rounded border border-accent/10"
        >
          <ToolBtn active={editor.isActive('bold')} onClick={() => editor.chain().focus().toggleBold().run()} title="Bold">
            <LuBold size={13} />
          </ToolBtn>
          <ToolBtn active={editor.isActive('italic')} onClick={() => editor.chain().focus().toggleItalic().run()} title="Italic">
            <LuItalic size={13} />
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
              onMouseDown={e => { e.preventDefault(); editor.chain().focus().setColor(value).run() }}
              title={label}
              style={{ background: value }}
              className={`w-4 h-4 rounded-full border-2 transition hover:scale-110 ${currentColor === value ? 'border-white' : 'border-transparent'}`}
            />
          ))}
          <button
            onMouseDown={e => { e.preventDefault(); editor.chain().focus().unsetColor().run() }}
            title="Remove color"
            className="w-4 h-4 rounded-full border border-dashed border-accent/40 hover:border-accent transition flex items-center justify-center text-ink-faint hover:text-ink"
          >
            <LuX size={9} />
          </button>
        </div>
      )}

      {/* Floating footnote menu */}
      {(menuPos || showInput) && (
        <div
          onMouseDown={e => e.preventDefault()}
          style={menuPos ? { position: 'fixed', left: menuPos.x, top: menuPos.y - 8, transform: 'translate(-50%, -100%)', zIndex: 9999 } : { position: 'fixed', left: '50%', top: '40%', transform: 'translate(-50%, -50%)', zIndex: 9999 }}
          className="flex items-center bg-surface-overlay border border-accent/20 rounded shadow-lg overflow-hidden"
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
          ) : footnoteViewMode ? (
            <>
              <span className="px-3 py-1.5 text-xs text-ink-muted italic truncate max-w-[180px]">{footnoteText}</span>
              <button
                onClick={() => setShowInput(true)}
                title="Edit footnote"
                className="px-2 py-1.5 text-ink-faint hover:text-ink hover:bg-surface-muted transition"
              ><LuPencil size={13} /></button>
              <button
                onClick={removeFootnote}
                title="Remove footnote"
                className="px-2 py-1.5 text-ink-faint hover:text-choice-kill hover:bg-surface-muted transition"
              ><LuX size={13} /></button>
            </>
          ) : (
            <button
              onClick={openInput}
              className="flex items-center gap-1.5 px-3 py-1.5 text-xs text-ink-muted hover:text-ink hover:bg-surface-muted transition"
            >
              <LuMessageSquare size={13} />
              Footnote
            </button>
          )}
        </div>
      )}

      <EditorContent
        editor={editor}
        className="prose prose-invert max-w-none text-ink text-sm leading-relaxed [&_.ProseMirror]:outline-none [&_.ProseMirror_p]:text-justify [&_.ProseMirror_p]:indent-8 [&_.ProseMirror_p]:my-0 [&_.ProseMirror_p.is-editor-empty:first-child::before]:text-ink-faint [&_.ProseMirror_p.is-editor-empty:first-child::before]:content-[attr(data-placeholder)] [&_.ProseMirror_p.is-editor-empty:first-child::before]:float-left [&_.ProseMirror_p.is-editor-empty:first-child::before]:pointer-events-none [&_.ProseMirror:focus_p.is-editor-empty:first-child::before]:hidden [&_.ProseMirror_hr]:border-none [&_.ProseMirror_hr]:h-px [&_.ProseMirror_hr]:bg-accent/20 [&_.ProseMirror_hr]:w-1/3 [&_.ProseMirror_hr]:mx-auto [&_.ProseMirror_hr]:my-6 [&_.ProseMirror_hr.ProseMirror-selectednode]:bg-accent/60"
      />
    </div>
  )
}
