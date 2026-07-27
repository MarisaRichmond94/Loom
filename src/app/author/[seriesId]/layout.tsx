'use client'

import { ReactNode, useCallback, useEffect, useRef, useState } from 'react'
import { useParams, useRouter } from 'next/navigation'
import Link from 'next/link'
import { LuChevronLeft, LuChevronRight, LuMoon, LuSparkles, LuSun } from 'react-icons/lu'
import OutlineTree from '@/components/sidebar/OutlineTree'
import VariablesPanel from '@/components/sidebar/VariablesPanel'
import ChoicesPanel from '@/components/sidebar/ChoicesPanel'
import AvatarButton from '@/components/AvatarButton'
import NotificationBell from '@/components/NotificationBell'
import ToastLayer from '@/components/ToastLayer'
import Greeting from '@/components/Greeting'
import SearchBar from '@/components/SearchBar'
import ShortcutsMenu from '@/components/ShortcutsMenu'
import { ShortcutsProvider } from '@/lib/shortcuts'
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
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false)
  const [edgeHovered, setEdgeHovered] = useState(false)
  const edgeLeaveTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  useEffect(() => {
    setLightMode(localStorage.getItem('loom-light-mode') === 'true')
    setSidebarCollapsed(localStorage.getItem('loom-sidebar-collapsed') === 'true')
  }, [])

  function toggleLightMode() {
    setLightMode(prev => {
      const next = !prev
      localStorage.setItem('loom-light-mode', String(next))
      return next
    })
  }

  function onEdgeEnter() {
    if (edgeLeaveTimer.current) clearTimeout(edgeLeaveTimer.current)
    setEdgeHovered(true)
  }
  function onEdgeLeave() {
    edgeLeaveTimer.current = setTimeout(() => setEdgeHovered(false), 150)
  }

  function toggleSidebar() {
    setSidebarCollapsed(prev => {
      const next = !prev
      localStorage.setItem('loom-sidebar-collapsed', String(next))
      return next
    })
  }

  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if (e.altKey && e.shiftKey && e.code === 'Digit1') {
        e.preventDefault()
        setSidebarCollapsed(prev => {
          const next = !prev
          localStorage.setItem('loom-sidebar-collapsed', String(next))
          return next
        })
      }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [])

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
        {/* Top nav skeleton — mirrors the loaded nav below element-for-element
            (same breakpoints, same right-side cluster) so there's no layout
            jump when `series` resolves. bookId/chapterId come from route
            params, which are known before the fetch finishes, so the
            breadcrumb chain already has the right number of segments. */}
        <nav className="bg-surface-raised border-b border-accent/10 px-6 py-3 flex items-center gap-3 text-sm">
          <Link href="/" className="flex items-center gap-2 shrink-0">
            <img src="/loom-logo.svg" alt="" className="block h-9 w-9" />
            <span className="hidden xl:inline text-accent font-bold tracking-wider text-2xl leading-none">LOOM</span>
          </Link>
          <span className="text-ink-faint self-center shrink-0">›</span>
          <div className="h-4 w-32 max-w-[200px] bg-surface-muted rounded animate-pulse" />
          {bookId && (
            <>
              <span className="text-ink-faint self-center shrink-0">›</span>
              <div className="h-4 w-24 max-w-[180px] bg-surface-muted rounded animate-pulse" />
            </>
          )}
          {chapterId && (
            <>
              <span className="text-ink-faint self-center shrink-0">›</span>
              <div className="h-4 w-24 max-w-[180px] bg-surface-muted rounded animate-pulse" />
            </>
          )}
          <div className="self-center shrink-0 ml-1 p-1">
            <div className="w-3.5 h-3.5 rounded bg-surface-muted animate-pulse" />
          </div>
          <div className="ml-auto flex items-center gap-3 shrink-0">
            <div className="flex items-center gap-2 animate-pulse">
              <div className="w-4 h-4 rounded bg-surface-muted" />
              <div className="h-7 w-72 rounded-lg bg-surface-muted" />
            </div>
            <div className="hidden lg:block h-4 w-28 bg-surface-muted rounded animate-pulse" />
            <div className="flex items-center gap-1.5 animate-pulse">
              <div className="w-3.5 h-3.5 rounded-full bg-surface-muted" />
              <div className="w-9 h-5 rounded-full bg-surface-muted" />
              <div className="w-3.5 h-3.5 rounded-full bg-surface-muted" />
            </div>
            <div className="w-4 h-4 rounded bg-surface-muted animate-pulse" />
            <div className="w-10 h-10 rounded-full bg-surface-muted animate-pulse" />
          </div>
        </nav>

        <div className="flex flex-1 overflow-hidden">
          {/* Sidebar — outline / choices / variables panels mocked. */}
          <aside className={`h-full bg-surface-raised flex flex-col overflow-hidden animate-pulse transition-[width] duration-300 ease-in-out ${sidebarCollapsed ? 'w-0 border-r-0' : 'w-56 border-r border-accent/10'}`}>
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
      <ShortcutsProvider>
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
            {/* Shortcuts sits 8px from the search bar rather than the header's
                usual 12px — the tighter seam reads as one "find things" cluster
                and keeps the menu visually owned by the bar it documents. */}
            <div className="flex items-center gap-2">
              <ShortcutsMenu />
              <SearchBar
                seriesId={seriesId}
                books={series.books.map(b => ({ id: b.id, title: b.title }))}
              />
            </div>
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
            <NotificationBell />
            <AvatarButton />
          </div>
        </nav>

        <ToastLayer />
        <div className="flex flex-1 overflow-hidden">
          {/* Sidebar wrapper — stays w-3 when collapsed so the hover zone persists at the edge */}
          <div
            className={`relative flex-shrink-0 transition-[width] duration-300 ease-in-out ${sidebarCollapsed ? 'w-3' : 'w-56'}`}
            onMouseEnter={onEdgeEnter}
            onMouseLeave={onEdgeLeave}
          >
            <aside className={`h-full bg-surface-raised flex flex-col overflow-hidden transition-[width] duration-300 ease-in-out ${sidebarCollapsed ? 'w-0 border-r-0' : 'w-56 border-r border-accent/10'}`}>
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

            {/* Handle — always at the right edge of the wrapper, pops out the same way whether expanded or collapsed */}
            <div
              className="absolute inset-y-0 left-full flex items-center z-40"
              onMouseEnter={onEdgeEnter}
              onMouseLeave={onEdgeLeave}
            >
              <button
                onClick={toggleSidebar}
                title={`${sidebarCollapsed ? 'Expand' : 'Collapse'} sidebar (⌥⇧1)`}
                aria-label={`${sidebarCollapsed ? 'Expand' : 'Collapse'} sidebar`}
                className={`flex items-center justify-center bg-surface-raised border border-accent/20 border-l-0 rounded-r-xl shadow-lg text-ink-faint hover:text-ink transition-all duration-300 ease-in-out overflow-hidden h-14 ${edgeHovered ? 'w-7 opacity-100' : 'w-0 opacity-0'}`}
              >
                {sidebarCollapsed
                  ? <LuChevronRight size={13} className="shrink-0" />
                  : <LuChevronLeft size={13} className="shrink-0" />}
              </button>
            </div>
          </div>

          <main className={`flex-1 overflow-y-auto${lightMode ? ' light-body' : ''}`}>
            {children}
          </main>
        </div>
      </div>
      </ShortcutsProvider>
    </AuthorProvider>
  )
}
