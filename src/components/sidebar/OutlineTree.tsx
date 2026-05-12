'use client'

import Link from 'next/link'
import { useState, useEffect } from 'react'
import { useParams, useRouter } from 'next/navigation'

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
  const router = useRouter()
  const [selectedBook, setSelectedBook] = useState<string | null>(() => books[0]?.id ?? null)
  const [addingBook, setAddingBook] = useState(false)
  const [addingChapter, setAddingChapter] = useState<string | null>(null)
  const [inputVal, setInputVal] = useState('')

  useEffect(() => {
    if (params.bookId) {
      setSelectedBook(params.bookId as string)
      return
    }
    const activeBook = books.find(b => b.chapters.some(c => c.id === params.chapterId))
    if (activeBook) {
      setSelectedBook(activeBook.id)
      return
    }
    setSelectedBook(prev => prev && books.some(b => b.id === prev) ? prev : (books[0]?.id ?? null))
  }, [books, params.chapterId, params.bookId])

  function selectBook(id: string) {
    setSelectedBook(prev => prev === id ? null : id)
    router.push(`/author/${seriesId}/book/${id}`)
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
        className="flex-1 bg-surface-base border border-accent/20 rounded px-2 py-1 text-xs text-ink outline-none focus:border-accent"
      />
      <button type="submit" className="text-xs text-accent px-1 py-1">✓</button>
      <button type="button" onClick={cancelAdd} className="text-xs text-ink-faint px-1 py-1">✕</button>
    </form>
  )

  return (
    <div className="flex flex-col gap-1">
      <div className="text-xs uppercase tracking-widest text-ink-faint mb-2">Outline</div>
      {books.map(book => (
        <div key={book.id}>
          <button
            onClick={() => selectBook(book.id)}
            className={`w-full flex items-center justify-between px-3 py-2 rounded-lg text-xs font-semibold transition text-left ${
              selectedBook === book.id
                ? 'bg-accent/20 text-accent border border-accent/30'
                : 'text-ink-muted hover:bg-surface-overlay border border-transparent'
            }`}
          >
            <span>{book.title}</span>
            <span className="text-ink-faint">{selectedBook === book.id ? '∨' : '∧'}</span>
          </button>

          {selectedBook === book.id && (
            <div className="mt-1 ml-1">
              {book.chapters.map(chapter => (
                <Link
                  key={chapter.id}
                  href={`/author/${seriesId}/chapter/${chapter.id}`}
                  className={`block px-3 py-1.5 rounded text-xs transition ${
                    params.chapterId === chapter.id
                      ? 'text-ink font-semibold'
                      : 'text-ink-faint hover:text-ink hover:bg-surface-overlay'
                  }`}
                >
                  {chapter.title}
                </Link>
              ))}
              {addingChapter === book.id ? addForm : (
                <button
                  onClick={() => { setAddingChapter(book.id); setInputVal('') }}
                  className="mt-1 block px-2 py-1 text-xs bg-accent text-white rounded font-medium hover:opacity-90 transition"
                >
                  Add Chapter
                </button>
              )}
            </div>
          )}
        </div>
      ))}
      {addingBook ? addForm : (
        <button
          onClick={() => { setAddingBook(true); setInputVal('') }}
          className="mt-2 px-2 py-1.5 rounded text-xs bg-accent text-white font-medium hover:opacity-90 transition"
        >
          Add Book
        </button>
      )}
    </div>
  )
}
