'use client'

import { useEffect } from 'react'
import { useEditor, EditorContent } from '@tiptap/react'
import StarterKit from '@tiptap/starter-kit'
import { LuBold, LuItalic, LuList } from 'react-icons/lu'

// The outline card's inline summary editor (LOOM-97).
//
// A port of WriteAI's `RichTextArea` — same shape, same toolbar, same
// save-on-blur — because the two apps are meant to feel like one and this is
// the control the writer actually spends their planning time in.
//
// `writer_summary` is HTML in the store, so this is rich text rather than a
// textarea. StarterKit only: bold, italic and bullets are what the field holds.

export default function OutlineRichText({
  value,
  onChange,
  onBlur,
  placeholder,
  editable = true,
}: {
  /** HTML string. */
  value: string
  onChange: (html: string) => void
  onBlur?: () => void
  placeholder?: string
  editable?: boolean
}) {
  const editor = useEditor({
    immediatelyRender: false,
    extensions: [StarterKit],
    content: value || '',
    editable,
    // Fires only on a real edit — never for the initial content, and never for
    // the external sync below. That is what keeps a card you merely CLICKED
    // INTO from being saved back: TipTap re-serialises the stored HTML on load
    // (`&#x27;` becomes `'`), and WriteAI decides a summary is still
    // machine-written by comparing it to `summary_source` exactly. A save on
    // focus would quietly mark every card you glanced at as hand-edited.
    onUpdate: ({ editor }) => onChange(editor.isEmpty ? '' : editor.getHTML()),
    onBlur: () => onBlur?.(),
    editorProps: { attributes: { class: 'outline-none min-h-0 leading-relaxed', spellcheck: 'true' } },
  })

  // Sync an external change (a refetch after saving) without clobbering the
  // caret. emitUpdate: false, or this fires onChange and marks the card dirty.
  useEffect(() => {
    if (!editor) return
    const current = editor.isEmpty ? '' : editor.getHTML()
    if (current !== value) editor.commands.setContent(value || '', { emitUpdate: false })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value])

  useEffect(() => {
    editor?.setEditable(editable)
  }, [editor, editable])

  if (!editor) return null

  const btn = (active: boolean, onClick: () => void, title: string, icon: React.ReactNode) => (
    <button
      type="button"
      // onMouseDown + preventDefault, not onClick: a click would blur the
      // editor first, losing the selection the command is meant to apply to.
      onMouseDown={e => {
        e.preventDefault()
        onClick()
      }}
      title={title}
      className={`rounded p-0.5 transition ${
        active ? 'bg-accent/20 text-accent' : 'text-ink-faint hover:bg-surface-overlay hover:text-ink-muted'
      }`}
    >
      {icon}
    </button>
  )

  return (
    <div className="flex flex-1 min-h-0 flex-col overflow-hidden rounded border border-accent/10 bg-surface-overlay/40 transition focus-within:border-accent/40">
      <div className="flex shrink-0 items-center gap-0.5 border-b border-accent/10 px-1 py-0.5">
        {btn(editor.isActive('bold'), () => editor.chain().focus().toggleBold().run(), 'Bold', <LuBold size={12} />)}
        {btn(editor.isActive('italic'), () => editor.chain().focus().toggleItalic().run(), 'Italic', <LuItalic size={12} />)}
        {btn(
          editor.isActive('bulletList'),
          () => editor.chain().focus().toggleBulletList().run(),
          'Bullet list',
          <LuList size={12} />,
        )}
      </div>

      <div className="relative min-h-0 flex-1 overflow-y-auto overscroll-contain px-1.5 py-1">
        {editor.isEmpty && placeholder && (
          <span className="pointer-events-none absolute left-1.5 top-1 select-none text-[11px] text-ink-faint/60">
            {placeholder}
          </span>
        )}
        <EditorContent
          editor={editor}
          className="h-full text-[11px] text-ink-muted [&_.ProseMirror]:min-h-0 [&_.ProseMirror_p]:my-0 [&_.ProseMirror_ul]:my-0.5 [&_.ProseMirror_ul]:list-disc [&_.ProseMirror_ul]:pl-4 [&_.ProseMirror_li]:my-0 [&_.ProseMirror_strong]:font-semibold [&_.ProseMirror_em]:italic"
        />
      </div>
    </div>
  )
}
