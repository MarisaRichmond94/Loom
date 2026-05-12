'use client'

import Link from 'next/link'
import { useState, useEffect } from 'react'
import { useParams } from 'next/navigation'

type Chapter = { id: string; title: string; order: number }
type Book = { id: string; title: string; order: number; chapters: Chapter[] }

type Props = {
  seriesId: string
  books: Book[]
  onAddBook: (title: string) => void
  onAddChapter: (bookId: string, title: string) => void
}

export default function OutlineTree({ seriesId, books, onAddBook, onAddChapter }: Props) {
  const params = useParams()
  const [expandedBooks, setExpandedBooks] = useState<Set<string>>(new Set(books.map(b => b.id)))
  const [addingBook, setAddingBook] = useState(false)
  const [addingChapter, setAddingChapter] = useState<string | null>(null)
  const [inputVal, setInputVal] = useState('')

  useEffect(() => {
    setExpandedBooks(prev => {
      const next = new Set(prev)
      books.forEach(b => next.add(b.id))
      return next
    })
  }, [books])

  function toggleBook(id: string) {
    setExpandedBooks(prev => { const s = new Set(prev); s.has(id) ? s.delete(id) : s.add(id); return s })
  }

  function submitAdd(e: React.FormEvent) {
    e.preventDefault()
    if (!inputVal.trim()) return
    if (addingBook) { onAddBook(inputVal.trim()); setAddingBook(false) }
    else if (addingChapter) { onAddChapter(addingChapter, inputVal.trim()); setAddingChapter(null) }
    setInputVal('')
  }

  function cancelAdd() {
    setAddingBook(false); setAddingChapter(null); setInputVal('')
  }

  const addForm = (
    <form onSubmit={submitAdd} className="flex gap-1 mt-1">
      <input
        autoFocus
        value={inputVal}
        onChange={e => setInputVal(e.target.value)}
        onKeyDown={e => e.key === 'Escape' && cancelAdd()}
        placeholder="Title…"
        className="flex-1 bg-surface-base border border-accent/20 rounded px-2 py-0.5 text-xs text-ink outline-none focus:border-accent"
      />
      <button type="submit" className="text-xs text-accent px-1">✓</button>
      <button type="button" onClick={cancelAdd} className="text-xs text-ink-faint px-1">✕</button>
    </form>
  )

  return (
    <div className="flex flex-col gap-1">
      <div className="text-xs uppercase tracking-widest text-ink-faint mb-2">Outline</div>
      {books.map(book => (
        <div key={book.id}>
          <button
            onClick={() => toggleBook(book.id)}
            className="w-full flex items-center gap-1 px-2 py-1.5 rounded text-xs text-accent hover:bg-surface-overlay transition text-left"
          >
            <span>{expandedBooks.has(book.id) ? '▾' : '▸'}</span>
            <span className="font-medium">{book.title}</span>
          </button>

          {expandedBooks.has(book.id) && (
            <div className="ml-3">
              {book.chapters.map(chapter => (
                <Link
                  key={chapter.id}
                  href={`/author/${seriesId}/chapter/${chapter.id}`}
                  className={`block px-2 py-1 rounded text-xs transition ${
                    params.chapterId === chapter.id
                      ? 'bg-surface-muted text-ink'
                      : 'text-ink-faint hover:text-ink hover:bg-surface-overlay'
                  }`}
                >
                  {chapter.title}
                </Link>
              ))}
              {addingChapter === book.id ? addForm : (
                <button
                  onClick={() => { setAddingChapter(book.id); setInputVal('') }}
                  className="block px-2 py-1 text-xs text-ink-faint hover:text-ink transition"
                >
                  + chapter
                </button>
              )}
            </div>
          )}
        </div>
      ))}
      {addingBook ? addForm : (
        <button
          onClick={() => { setAddingBook(true); setInputVal('') }}
          className="mt-2 px-2 py-1.5 rounded text-xs border border-dashed border-accent/20 text-ink-faint hover:text-ink transition"
        >
          + book
        </button>
      )}
    </div>
  )
}
