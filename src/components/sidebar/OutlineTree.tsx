'use client'

import Link from 'next/link'
import { useState, useEffect, useRef } from 'react'
import { useParams, useRouter } from 'next/navigation'
import { LuCheck, LuX, LuGripVertical, LuEllipsisVertical } from 'react-icons/lu'
import { DndContext, closestCenter, PointerSensor, useSensor, useSensors } from '@dnd-kit/core'
import type { DragEndEvent } from '@dnd-kit/core'
import { SortableContext, useSortable, verticalListSortingStrategy, arrayMove } from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'

type Chapter = { id: string; title: string; order: number }
type Book = { id: string; title: string; order: number; chapters: Chapter[] }

type Props = {
  seriesId: string
  books: Book[]
  onAddBook: (title: string) => void
  onAddChapter: (bookId: string, title: string) => void
  onInsertChapter: (bookId: string, title: string, atOrder: number) => void
}

function setTitle(title: string, order: number): string {
  if (/^\d+$/.test(title)) return String(order)
  const m = /^(Chapter )(\d+)$/i.exec(title)
  if (m) return `${m[1]}${order}`
  return title
}

function SortableChapter({ chapter, seriesId, isActive, openMenu, onOpenMenu, onInsert, onCloseMenu }: {
  chapter: Chapter
  seriesId: string
  isActive: boolean
  openMenu: string | null
  onOpenMenu: (id: string) => void
  onInsert: (position: 'before' | 'after') => void
  onCloseMenu: () => void
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: chapter.id })
  const linkRef = useRef<HTMLAnchorElement>(null)
  useEffect(() => {
    if (isActive) linkRef.current?.scrollIntoView({ block: 'start' })
  }, [isActive])
  return (
    <div
      ref={setNodeRef}
      style={{ transform: CSS.Transform.toString(transform), transition, opacity: isDragging ? 0.4 : 1 }}
      className="relative flex items-center group/chapter"
    >
      <button
        {...attributes}
        {...listeners}
        className="shrink-0 text-ink-faint opacity-0 group-hover/chapter:opacity-100 cursor-grab active:cursor-grabbing transition pr-1"
      >
        <LuGripVertical size={13} />
      </button>
      <Link
        ref={linkRef}
        href={`/author/${seriesId}/chapter/${chapter.id}`}
        className={`flex-1 block px-2 py-1.5 rounded text-xs transition truncate ${
          isActive ? 'text-ink font-semibold' : 'text-ink-faint hover:text-ink hover:bg-surface-overlay'
        }`}
      >
        {chapter.title}
      </Link>
      <div className="relative shrink-0">
        <button
          onMouseDown={e => e.stopPropagation()}
          onClick={e => { e.stopPropagation(); onOpenMenu(chapter.id) }}
          className="text-ink-faint opacity-0 group-hover/chapter:opacity-100 hover:text-ink transition p-0.5"
        >
          <LuEllipsisVertical size={13} />
        </button>
        {openMenu === chapter.id && (
          <div
            onClick={e => e.stopPropagation()}
            className="absolute right-0 top-full mt-0.5 bg-surface-overlay border border-accent/20 rounded shadow-lg z-50 min-w-[150px]"
          >
            <button
              onClick={() => { onInsert('before'); onCloseMenu() }}
              className="w-full text-left px-3 py-2 text-xs text-ink-muted hover:text-ink hover:bg-surface-muted transition"
            >
              Add chapter before
            </button>
            <button
              onClick={() => { onInsert('after'); onCloseMenu() }}
              className="w-full text-left px-3 py-2 text-xs text-ink-muted hover:text-ink hover:bg-surface-muted transition"
            >
              Add chapter after
            </button>
          </div>
        )}
      </div>
    </div>
  )
}

export default function OutlineTree({ seriesId, books, onAddBook, onAddChapter, onInsertChapter }: Props) {
  const params = useParams()
  const router = useRouter()
  const [selectedBook, setSelectedBook] = useState<string | null>(() => books[0]?.id ?? null)
  const [addingBook, setAddingBook] = useState(false)
  const [addingChapter, setAddingChapter] = useState<string | null>(null)
  const [inputVal, setInputVal] = useState('')
  const [localChapters, setLocalChapters] = useState<Record<string, Chapter[]>>(() =>
    Object.fromEntries(books.map(b => [b.id, b.chapters]))
  )
  const [openMenu, setOpenMenu] = useState<string | null>(null)
  const [insertingAt, setInsertingAt] = useState<{ bookId: string; order: number } | null>(null)
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 5 } }))

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

  // Sync localChapters when chapters are added/deleted (structural change only, not reorder)
  useEffect(() => {
    setLocalChapters(prev => {
      let changed = false
      const next = { ...prev }
      for (const book of books) {
        const incomingIds = book.chapters.map(c => c.id).sort().join(',')
        const localIds = (prev[book.id] ?? []).map(c => c.id).sort().join(',')
        if (incomingIds !== localIds) {
          next[book.id] = book.chapters
          changed = true
        }
      }
      return changed ? next : prev
    })
  }, [books])

  // Close open menu on outside click
  useEffect(() => {
    if (!openMenu) return
    function handleClick() { setOpenMenu(null) }
    document.addEventListener('click', handleClick)
    return () => document.removeEventListener('click', handleClick)
  }, [openMenu])

  function selectBook(id: string) {
    setSelectedBook(prev => prev === id ? null : id)
    router.push(`/author/${seriesId}/book/${id}`)
  }

  async function handleDragEnd(event: DragEndEvent) {
    const { active, over } = event
    if (!over || active.id === over.id || !selectedBook) return
    const chapters = localChapters[selectedBook] ?? books.find(b => b.id === selectedBook)?.chapters ?? []
    const oldIdx = chapters.findIndex(c => c.id === active.id)
    const newIdx = chapters.findIndex(c => c.id === over.id)
    const reordered = arrayMove(chapters, oldIdx, newIdx).map((c, i) => ({ ...c, order: i + 1, title: setTitle(c.title, i + 1) }))
    setLocalChapters(prev => ({ ...prev, [selectedBook]: reordered }))
    const book = books.find(b => b.id === selectedBook)!
    await fetch(`/api/series/${seriesId}/books/${book.id}/chapters/reorder`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(reordered.map(c => ({ id: c.id, order: c.order }))),
    })
  }

  function submitAdd(e: React.FormEvent) {
    e.preventDefault()
    if (!inputVal.trim()) return
    if (insertingAt) {
      onInsertChapter(insertingAt.bookId, inputVal.trim(), insertingAt.order)
      setInsertingAt(null)
    } else if (addingBook) {
      onAddBook(inputVal.trim())
      setAddingBook(false)
    } else if (addingChapter) {
      onAddChapter(addingChapter, inputVal.trim())
      setAddingChapter(null)
    }
    setInputVal('')
  }

  function cancelAdd() {
    setAddingBook(false)
    setAddingChapter(null)
    setInsertingAt(null)
    setInputVal('')
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
      <button type="submit" className="text-accent px-1 py-1"><LuCheck size={13} /></button>
      <button type="button" onClick={cancelAdd} className="text-ink-faint px-1 py-1"><LuX size={13} /></button>
    </form>
  )

  return (
    <div className="flex flex-col flex-1 min-h-0">
      <div className="text-xs uppercase tracking-widest text-ink-faint mb-2 shrink-0">Outline</div>

      {/* Scrollable books + chapters area */}
      <div className="flex-1 overflow-y-auto min-h-0">
        {books.map(book => {
          const chapters = localChapters[book.id] ?? book.chapters
          return (
            <div key={book.id} className="flex flex-col">
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
                <div className="ml-1 flex flex-col mt-2">
                  <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
                    <SortableContext items={chapters.map(c => c.id)} strategy={verticalListSortingStrategy}>
                      {chapters.map(chapter => (
                        <div key={chapter.id}>
                          {insertingAt?.bookId === book.id && insertingAt.order === chapter.order && addForm}
                          <SortableChapter
                            chapter={chapter}
                            seriesId={seriesId}
                            isActive={params.chapterId === chapter.id}
                            openMenu={openMenu}
                            onOpenMenu={setOpenMenu}
                            onCloseMenu={() => setOpenMenu(null)}
                            onInsert={position => {
                              setInsertingAt({
                                bookId: book.id,
                                order: position === 'before' ? chapter.order : chapter.order + 1,
                              })
                              setInputVal('')
                            }}
                          />
                        </div>
                      ))}
                      {/* Insert at end (after last chapter) */}
                      {insertingAt?.bookId === book.id && insertingAt.order > (chapters.at(-1)?.order ?? 0) && addForm}
                    </SortableContext>
                  </DndContext>

                  {!insertingAt && (
                    addingChapter === book.id ? addForm : (
                      <button
                        onClick={() => { setAddingChapter(book.id); setInputVal('') }}
                        className="block px-2 py-1 text-xs bg-accent text-white rounded font-medium hover:opacity-90 transition my-2"
                      >
                        Add Chapter
                      </button>
                    )
                  )}
                </div>
              )}
            </div>
          )
        })}
      </div>

      {/* Add Book — fixed at bottom */}
      <div className="shrink-0 pt-2">
        {addingBook ? addForm : (
          <button
            onClick={() => { setAddingBook(true); setInputVal('') }}
            className="w-full px-2 py-1.5 rounded text-xs bg-accent text-white font-medium hover:opacity-90 transition"
          >
            Add Book
          </button>
        )}
      </div>
    </div>
  )
}
