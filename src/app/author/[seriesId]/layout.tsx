'use client'

import { ReactNode, useCallback, useEffect, useRef, useState } from 'react'
import { useParams, useRouter } from 'next/navigation'
import Link from 'next/link'
import { LuMoon, LuSparkles, LuSun } from 'react-icons/lu'
import OutlineTree from '@/components/sidebar/OutlineTree'
import VariablesPanel from '@/components/sidebar/VariablesPanel'
import ChoicesPanel from '@/components/sidebar/ChoicesPanel'
import AvatarButton from '@/components/AvatarButton'
import Greeting from '@/components/Greeting'
import SearchBar from '@/components/SearchBar'
import { AuthorProvider, type AuthorSeries } from '@/lib/authorContext'
import { ensureMinDuration } from '@/lib/minLoadDuration'
import ChapterSkeleton from '@/components/editor/ChapterSkeleton'
import BookSkeleton from '@/components/editor/BookSkeleton'
import SeriesPageSkeleton from '@/components/editor/SeriesPageSkeleton'

type ChoiceQuestion = { id: string; prompt: string; chapterId: string; chapterTitle: string; bookTitle: string; reachable: boolean }

export default function AuthorLayout({ children }: { children: ReactNode }) {
  const router = useRouter()
  const params = useParams() as { seriesId: string; bookId?: string; chapterId?: string }
  const { seriesId, bookId, chapterId } = params

  const [series, setSeries] = useState<AuthorSeries | null>(null)
  const [choiceQuestions, setChoiceQuestions] = useState<ChoiceQuestion[]>([])
  const [knownStringValues, setKnownStringValues] = useState<Record<string, string[]>>({})
  const [lightMode, setLightMode] = useState(false)
  useEffect(() => {
    setLightMode(localStorage.getItem('loom-light-mode') === 'true')
  }, [])

  function toggleLightMode() {
    setLightMode(prev => {
      const next = !prev
      localStorage.setItem('loom-light-mode', String(next))
      return next
    })
  }

  const isInitialSeriesLoadRef = useRef(true)
  const loadSeries = useCallback(async () => {
    const start = Date.now()
    const res = await fetch(`/api/series/${seriesId}`)
    if (!res.ok) return
    const data = await res.json()
    // Pad only the first load so the chrome skeleton doesn't flash; later
    // re-fetches (rename, add chapter, etc.) shouldn't delay the writer.
    if (isInitialSeriesLoadRef.current) {
      await ensureMinDuration(start)
      isInitialSeriesLoadRef.current = false
    }
    // genres + keywords are stored as JSON strings on the server (SQLite has
    // no list type); parse once here so consumers work with plain arrays.
    const parseList = (s: unknown): string[] => {
      if (typeof s !== 'string') return []
      try { const v = JSON.parse(s); return Array.isArray(v) ? v : [] } catch { return [] }
    }
    setSeries({ ...data, genres: parseList(data.genres), keywords: parseList(data.keywords) })
  }, [seriesId])

  const loadChoices = useCallback(async () => {
    const qs = chapterId ? `?upToChapterId=${chapterId}` : bookId ? `?upToBookId=${bookId}` : ''
    const res = await fetch(`/api/series/${seriesId}/choices${qs}`)
    if (res.ok) setChoiceQuestions(await res.json())
  }, [seriesId, bookId, chapterId])

  // Refreshes alongside choices so adding/removing a value via a choice
  // block shows up in the datalist on the next interaction. Same trigger
  // surface (loadChoices fires when chapterId/bookId/seriesId change)
  // keeps the two payloads aligned.
  const loadKnownStringValues = useCallback(async () => {
    const res = await fetch(`/api/series/${seriesId}/string-values`)
    if (res.ok) setKnownStringValues(await res.json())
  }, [seriesId])

  useEffect(() => { loadSeries() }, [loadSeries])
  useEffect(() => { loadChoices() }, [loadChoices])
  useEffect(() => { loadKnownStringValues() }, [loadKnownStringValues, choiceQuestions])

  async function addBook(title: string) {
    await fetch(`/api/series/${seriesId}/books`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ title }),
    })
    loadSeries()
  }

  async function addChapter(forBookId: string, title: string) {
    const res = await fetch(`/api/series/${seriesId}/books/${forBookId}/chapters`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ title }),
    })
    const chapter = await res.json()
    await loadSeries()
    router.push(`/author/${seriesId}/chapter/${chapter.id}?focus=pov`)
  }

  async function insertChapter(forBookId: string, title: string, atOrder: number) {
    const res = await fetch(`/api/series/${seriesId}/books/${forBookId}/chapters`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ title, insertAtOrder: atOrder }),
    })
    const chapter = await res.json()
    await loadSeries()
    router.push(`/author/${seriesId}/chapter/${chapter.id}?focus=pov`)
  }

  async function updateVariable(id: string, data: { name?: string; type?: string; defaultValue?: unknown }) {
    await fetch(`/api/variables/${id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data),
    })
    loadSeries()
  }
  async function deleteVariable(id: string) {
    await fetch(`/api/variables/${id}`, { method: 'DELETE' })
    loadSeries()
  }

  if (!series) {
    return (
      <div className="h-screen bg-surface-base flex flex-col overflow-hidden">
        {/* Top nav — logo stays static, dynamic bits become pulsing placeholders. */}
        <nav className="bg-surface-raised border-b border-accent/10 px-6 py-3 flex items-center gap-3 text-sm">
          <Link href="/" className="flex items-center gap-2">
            <img src="/loom-logo.svg" alt="" className="block h-9 w-9" />
            <span className="text-accent font-bold tracking-wider text-2xl leading-none">LOOM</span>
          </Link>
          <span className="text-ink-faint self-center">›</span>
          <div className="h-4 w-40 bg-surface-muted rounded animate-pulse" />
          <div className="ml-auto flex items-center gap-2 animate-pulse">
            <div className="h-4 w-28 bg-surface-muted rounded" />
            <div className="w-9 h-5 rounded-full bg-surface-muted" />
            <div className="w-8 h-8 rounded-full bg-surface-muted" />
          </div>
        </nav>

        <div className="flex flex-1 overflow-hidden">
          {/* Sidebar — outline / choices / variables panels mocked. */}
          <aside className="w-56 bg-surface-raised border-r border-accent/10 flex flex-col overflow-hidden animate-pulse">
            <div className="flex flex-col gap-2 p-4 max-h-[50%]">
              <div className="h-3 w-20 bg-surface-muted rounded mb-1" />
              {[0, 1, 2, 3, 4].map(i => (
                <div key={i} className="h-4 bg-surface-muted rounded" style={{ width: `${70 + (i * 5) % 25}%` }} />
              ))}
              <div className="h-7 w-full bg-accent/30 rounded mt-2" />
            </div>
            <div className="flex flex-col gap-2 p-4 pt-3 border-t border-accent/10 max-h-[25%]">
              <div className="h-3 w-20 bg-surface-muted rounded mb-1" />
              {[0, 1].map(i => <div key={i} className="h-3 w-full bg-surface-muted rounded" />)}
            </div>
            <div className="flex flex-col gap-2 p-4 pt-3 border-t border-accent/10 max-h-[25%]">
              <div className="h-3 w-20 bg-surface-muted rounded mb-1" />
              {[0, 1, 2].map(i => <div key={i} className="h-3 w-full bg-surface-muted rounded" />)}
              <div className="h-7 w-full bg-accent/30 rounded mt-2" />
            </div>
          </aside>

          <main className={`flex-1 overflow-y-auto${lightMode ? ' light-body' : ''}`}>
            {chapterId ? <ChapterSkeleton /> : bookId ? <BookSkeleton /> : <SeriesPageSkeleton />}
          </main>
        </div>
      </div>
    )
  }

  const activeBook = bookId
    ? series.books.find(b => b.id === bookId)
    : chapterId
      ? series.books.find(b => b.chapters.some(c => c.id === chapterId))
      : null
  const activeChapter = chapterId && activeBook
    ? activeBook.chapters.find(c => c.id === chapterId) ?? null
    : null

  return (
    <AuthorProvider value={{ series, loadSeries, loadChoices, lightMode, knownStringValues }}>
      <div className="h-screen bg-surface-base flex flex-col overflow-hidden">
        {/* Header collapses progressively as width shrinks so the breadcrumbs
            and right-side controls never wrap onto a second line:
              - below xl (1280px): hide the "LOOM" wordmark, logo stays
              - below lg (1024px): hide the greeting
              - always: cap breadcrumb segments and truncate with a title
                attribute so the full label is one hover away */}
        <nav className="bg-surface-raised border-b border-accent/10 px-6 py-3 flex items-center gap-3 text-sm">
          <Link href="/" className="flex items-center gap-2 shrink-0">
            <img src="/loom-logo.svg" alt="" className="block h-9 w-9" />
            <span className="hidden xl:inline text-accent font-bold tracking-wider text-2xl leading-none">LOOM</span>
          </Link>
          <span className="text-ink-faint self-center shrink-0">›</span>
          {activeBook || activeChapter ? (
            <Link href={`/author/${seriesId}`} title={series.title} className="text-ink-muted hover:text-ink self-center truncate max-w-[200px]">{series.title}</Link>
          ) : (
            <span title={series.title} className="text-ink self-center truncate max-w-[200px]">{series.title}</span>
          )}
          {activeBook && (
            <>
              <span className="text-ink-faint self-center shrink-0">›</span>
              {activeChapter ? (
                <Link href={`/author/${seriesId}/book/${activeBook.id}`} title={activeBook.title} className="text-ink-muted hover:text-ink self-center truncate max-w-[180px]">{activeBook.title}</Link>
              ) : (
                <span title={activeBook.title} className="text-ink self-center truncate max-w-[180px]">{activeBook.title}</span>
              )}
            </>
          )}
          {activeChapter && (
            <>
              <span className="text-ink-faint self-center shrink-0">›</span>
              <span title={activeChapter.title} className="text-ink self-center truncate max-w-[180px]">{activeChapter.title}</span>
            </>
          )}
          {/* Jump to the companion WriteAI app (same tab — the browser's
              back button is the return trip). */}
          <a
            href={process.env.NEXT_PUBLIC_WRITEAI_URL ?? 'http://localhost:5173'}
            title="Open WriteAI"
            className="self-center shrink-0 ml-1 p-1 rounded text-ink-faint hover:text-accent hover:bg-accent/10 transition"
          >
            <LuSparkles size={14} />
          </a>
          <div className="ml-auto flex items-center gap-3 shrink-0">
            <SearchBar
              seriesId={seriesId}
              books={series.books.map(b => ({ id: b.id, title: b.title }))}
            />
            <div className="hidden lg:block">
              <Greeting />
            </div>
            <button
              role="switch"
              aria-checked={lightMode}
              onClick={toggleLightMode}
              title={lightMode ? 'Switch to dark mode' : 'Switch to light mode'}
              className="flex items-center gap-1.5 text-ink-faint hover:text-ink transition"
            >
              <LuMoon size={13} />
              <span className={`relative inline-flex w-9 h-5 rounded-full transition-colors duration-200 ${lightMode ? 'bg-accent' : 'bg-surface-muted'}`}>
                <span className={`absolute top-0.5 w-4 h-4 rounded-full bg-white shadow transition-all duration-200 ${lightMode ? 'left-4' : 'left-0.5'}`} />
              </span>
              <LuSun size={13} />
            </button>
            <AvatarButton />
          </div>
        </nav>

        <div className="flex flex-1 overflow-hidden">
          <aside className="w-56 bg-surface-raised border-r border-accent/10 flex flex-col overflow-hidden">
            <div className="flex flex-col min-h-0 max-h-[50%] p-4">
              <OutlineTree
                seriesId={seriesId}
                books={series.books}
                onAddBook={addBook}
                onAddChapter={addChapter}
                onInsertChapter={insertChapter}
              />
            </div>
            <div className="flex flex-col min-h-0 max-h-[25%] p-4 pt-3 border-t border-accent/10">
              <ChoicesPanel
                seriesId={seriesId}
                questions={choiceQuestions}
              />
            </div>
            <div className="flex flex-col min-h-0 max-h-[25%] p-4 pt-3 border-t border-accent/10">
              <VariablesPanel
                seriesId={seriesId}
                variables={series.variables}
                onUpdate={updateVariable}
                onDelete={deleteVariable}
              />
            </div>
          </aside>

          <main className={`flex-1 overflow-y-auto${lightMode ? ' light-body' : ''}`}>
            {children}
          </main>
        </div>
      </div>
    </AuthorProvider>
  )
}
