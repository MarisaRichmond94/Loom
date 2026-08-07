'use client'

import Link from 'next/link'
import { useState, useEffect, useRef } from 'react'
import { useParams, useRouter } from 'next/navigation'
import { LuCheck, LuX, LuGripVertical, LuEllipsisVertical } from 'react-icons/lu'
import { DndContext, closestCenter, PointerSensor, useSensor, useSensors } from '@dnd-kit/core'
import type { DragEndEvent } from '@dnd-kit/core'
import { SortableContext, useSortable, verticalListSortingStrategy, arrayMove } from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import { useCanonSave } from '@/components/editor/useCanonSave'

type Chapter = { id: string; title: string; order: number }
type Book = {
  id: string; title: string; order: number
  inProgress?: boolean
  /** Needed for the default-book fallback below (LOOM-140). */
  published?: boolean
  chapters: Chapter[]
}

type Props = {
  seriesId: string
  books: Book[]
  onAddBook: (title: string) => void
  onAddChapter: (bookId: string, title: string) => void
  onInsertChapter: (bookId: string, title: string, atOrder: number) => void
}

function parseNumberedTitle(title: string): { prefix: string; num: number } | null {
  const bare = /^(\d+)$/.exec(title)
  if (bare) return { prefix: '', num: Number(bare[1]) }
  const m = /^(.+\s)(\d+)$/.exec(title)
  if (m) return { prefix: m[1], num: Number(m[2]) }
  return null
}

// Renumbers ONLY chapters whose prefix matches the dragged chapter's
// prefix. So dragging "Bonus Chapter 7" re-sequences "Bonus Chapter N"
// (so it becomes 1, 2, 3, … in the new order) while every "Chapter N"
// and one-off ("Prologue", "Epilogue") is left untouched — both their
// titles AND their numbering. Walking every prefix on every drag was
// the previous behavior and caused unrelated prefixes to silently
// shift when their on-disk titles didn't already form a clean sequence.
function renumberAfterDrag<T extends { title: string }>(chapters: T[], movedTitle: string): T[] {
  const movedParsed = parseNumberedTitle(movedTitle)
  if (!movedParsed) return chapters
  let n = 0
  return chapters.map(c => {
    const parsed = parseNumberedTitle(c.title)
    if (!parsed || parsed.prefix !== movedParsed.prefix) return c
    n++
    return { ...c, title: `${parsed.prefix}${n}` }
  })
}

function SortableChapter({ chapter, seriesId, isActive, scrollOnDefault, openMenu, onOpenMenu, onInsert, onCloseMenu }: {
  chapter: Chapter
  seriesId: string
  isActive: boolean
  // Set on the "latest chapter of the default-open book" when nothing else
  // is active — scrolls into view so the writer lands where they left off.
  scrollOnDefault: boolean
  openMenu: string | null
  onOpenMenu: (id: string) => void
  onInsert: (position: 'before' | 'after') => void
  onCloseMenu: () => void
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: chapter.id })
  const linkRef = useRef<HTMLAnchorElement>(null)
  useEffect(() => {
    if (isActive || scrollOnDefault) linkRef.current?.scrollIntoView({ block: 'start' })
  }, [isActive, scrollOnDefault])
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

/**
 * Which book the sidebar opens on, and whose latest chapter it scrolls to.
 *
 * `inProgress` is not just a label — it is this. LOOM-140 made the three
 * statuses mutually exclusive, which means marking a book Published now clears
 * `inProgress`, and a naive `inProgress ?? books[0]` would silently send the
 * sidebar back to book one.
 *
 * That is invisible while the in-progress book is unpublished, and bites the
 * first time a book is published while still being written — which per-book
 * publishing (LOOM-129) makes considerably more likely. So the fallback widens:
 * the book being written, else the furthest-along published book, else the
 * first.
 */
export function defaultBook<T extends { id: string; order: number; inProgress?: boolean; published?: boolean }>(
  books: T[],
): T | undefined {
  const writing = books.find(b => b.inProgress)
  if (writing) return writing
  const published = books.filter(b => b.published)
  if (published.length) {
    return published.reduce((furthest, b) => (b.order > furthest.order ? b : furthest))
  }
  return books[0]
}

export default function OutlineTree({ seriesId, books, onAddBook, onAddChapter, onInsertChapter }: Props) {
  const params = useParams()
  const router = useRouter()
  const { saveCanonAfterStructuralChange } = useCanonSave(seriesId)
  // Default-open: the in-progress book (writer's currently-active work),
  // falling back to book 1 when nothing is flagged.
  const defaultBookId = defaultBook(books)?.id ?? null
  const [selectedBook, setSelectedBook] = useState<string | null>(() => defaultBookId)
  // The chapter the writer last worked in, so a bare series-page landing can
  // open + scroll to it instead of the bottom of the in-progress book. Two
  // sources, newest first: the chapter opened during THIS session (tracked
  // via the URL below), then the server-remembered last-touched chapter
  // fetched on mount. The chapter editor stamps the server value on open.
  const [lastTouchedId, setLastTouchedId] = useState<string | null>(null)
  const lastVisitedChapterRef = useRef<string | null>(null)
  const [addingBook, setAddingBook] = useState(false)
  const [addingChapter, setAddingChapter] = useState<string | null>(null)
  const [inputVal, setInputVal] = useState('')
  const [localChapters, setLocalChapters] = useState<Record<string, Chapter[]>>(() =>
    Object.fromEntries(books.map(b => [b.id, b.chapters]))
  )
  const [openMenu, setOpenMenu] = useState<string | null>(null)
  const [insertingAt, setInsertingAt] = useState<{ bookId: string; order: number } | null>(null)
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 5 } }))

  // Track the chapter open in THIS session. The sidebar stays mounted across
  // book/chapter navigation within a series, so this ref outlives the
  // once-per-mount server fetch and reflects the most recent work.
  useEffect(() => {
    if (params.chapterId) lastVisitedChapterRef.current = params.chapterId as string
  }, [params.chapterId])

  // Server-remembered last-touched chapter, fetched once per series.
  useEffect(() => {
    let cancelled = false
    fetch(`/api/series/${seriesId}/last-touched`)
      .then(r => r.ok ? r.json() : { lastTouched: null })
      .then((d: { lastTouched: { chapterId: string } | null }) => {
        if (!cancelled) setLastTouchedId(d.lastTouched?.chapterId ?? null)
      })
      .catch(() => { /* non-fatal — falls back to the in-progress book */ })
    return () => { cancelled = true }
  }, [seriesId])

  // The chapter to land on when the URL carries no book/chapter context,
  // newest source first, skipping any id that no longer exists.
  const rememberedChapterId = (!params.bookId && !params.chapterId)
    ? [lastVisitedChapterRef.current, lastTouchedId].find(
        id => !!id && books.some(b => b.chapters.some(c => c.id === id)),
      ) ?? null
    : null
  const rememberedBookId = rememberedChapterId
    ? books.find(b => b.chapters.some(c => c.id === rememberedChapterId))?.id ?? null
    : null

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
    // Bare series page — a landing, where there's no manual book selection to
    // preserve (choosing a book navigates to its own URL). Open the book the
    // writer left off in: the remembered chapter's book, else the in-progress
    // book, else the first.
    setSelectedBook(rememberedBookId ?? defaultBook(books)?.id ?? null)
  }, [books, params.chapterId, params.bookId, rememberedBookId])

  // Sync localChapters from the layout's series prop whenever any
  // chapter's id, title, OR order differs from what we currently have
  // locally. Previously this only watched the id set, so a title
  // change made elsewhere (e.g. the chapter editor saving a new
  // title) wasn't reflected here until a page refresh.
  //
  // During a drag, the `books` prop reference doesn't change (we
  // don't loadSeries() in handleDragEnd), so this effect doesn't fire
  // and the optimistic local state is preserved.
  useEffect(() => {
    setLocalChapters(prev => {
      let changed = false
      const next = { ...prev }
      for (const book of books) {
        const incomingKey = book.chapters.map(c => `${c.id}|${c.title}|${c.order}`).join(',')
        const localKey = (prev[book.id] ?? []).map(c => `${c.id}|${c.title}|${c.order}`).join(',')
        if (incomingKey !== localKey) {
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
    // Two-step renumber: positional order first, then renumber only
    // chapters that share the dragged chapter's prefix so "Chapter"
    // and "Bonus Chapter" stay independent series and unrelated
    // prefixes are never touched.
    const movedTitle = chapters[oldIdx]?.title ?? ''
    const moved = arrayMove(chapters, oldIdx, newIdx).map((c, i) => ({ ...c, order: i + 1 }))
    const reordered = renumberAfterDrag(moved, movedTitle)
    setLocalChapters(prev => ({ ...prev, [selectedBook]: reordered }))
    const book = books.find(b => b.id === selectedBook)!
    await fetch(`/api/series/${seriesId}/books/${book.id}/chapters/reorder`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      // Send title alongside order so the server persists the same
      // per-prefix renumbering the client computed — no second-guessing
      // on the server.
      body: JSON.stringify(reordered.map(c => ({ id: c.id, order: c.order, title: c.title }))),
    })
    // A drag is the one structural change that alters no prose at all, so
    // nothing downstream would ever notice it on its own: no blur fires, no
    // word count moves, and the book's chapters simply mean different
    // numbers than they did a second ago. Left unexported, WriteAI keeps
    // answering about chapter 12 with chapter 11's scene until the next time
    // the writer happens to type something in this book.
    void saveCanonAfterStructuralChange(book.id)
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

  // When the writer lands on a series page with no specific book/chapter in
  // the URL, scroll the chapter they last worked in into view. Without one
  // (brand-new series, never opened a chapter), fall back to the in-progress
  // book's last chapter — "where they left off" for the common workflow of
  // appending new chapters.
  // Same widened rule as the default book, so the scroll target follows it.
  const inProgressBook = defaultBook(books)
  const scrollDefaultChapterId =
    !params.bookId && !params.chapterId
      ? rememberedChapterId
        ?? (inProgressBook ? (localChapters[inProgressBook.id] ?? inProgressBook.chapters).at(-1)?.id ?? null : null)
      : null

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
                            scrollOnDefault={scrollDefaultChapterId === chapter.id}
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
