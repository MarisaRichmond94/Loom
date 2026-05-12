'use client'

import { useEditor, EditorContent } from '@tiptap/react'
import StarterKit from '@tiptap/starter-kit'
import Placeholder from '@tiptap/extension-placeholder'
import { useEffect } from 'react'

type Props = {
  content: string | null
  onChange: (json: string) => void
}

const EMPTY = '{"type":"doc","content":[{"type":"paragraph"}]}'

export default function TextBlock({ content, onChange }: Props) {
  const editor = useEditor({
    extensions: [
      StarterKit,
      Placeholder.configure({ placeholder: 'Write your prose here…' }),
    ],
    content: content ? JSON.parse(content) : JSON.parse(EMPTY),
    onUpdate: ({ editor }) => onChange(JSON.stringify(editor.getJSON())),
  })

  useEffect(() => {
    if (editor && content) {
      const current = JSON.stringify(editor.getJSON())
      if (current !== content) editor.commands.setContent(JSON.parse(content))
    }
  }, [content])

  return (
    <EditorContent
      editor={editor}
      className="prose prose-invert max-w-none text-ink text-sm leading-relaxed [&_.ProseMirror]:outline-none [&_.ProseMirror_p.is-editor-empty:first-child::before]:text-ink-faint [&_.ProseMirror_p.is-editor-empty:first-child::before]:content-[attr(data-placeholder)] [&_.ProseMirror_p.is-editor-empty:first-child::before]:float-left [&_.ProseMirror_p.is-editor-empty:first-child::before]:pointer-events-none"
    />
  )
}
