'use client'

import { ReactNode, useCallback, useEffect, useRef, useState } from 'react'
import { useParams, useRouter } from 'next/navigation'
import { LuChevronLeft, LuChevronRight } from 'react-icons/lu'
import OutlineTree from '@/components/sidebar/OutlineTree'
import VariablesPanel from '@/components/sidebar/VariablesPanel'
import ChoicesPanel from '@/components/sidebar/ChoicesPanel'
import AppHeader from '@/components/AppHeader'
import ToastLayer from '@/components/ToastLayer'
import SearchBar from '@/components/SearchBar'
import ShortcutsMenu from '@/components/ShortcutsMenu'
import { ShortcutsProvider } from '@/lib/shortcuts'
import { useLightMode } from '@shared/useLightMode'
import { AuthorProvider, type AuthorSeries } from '@/lib/authorContext'
import { ensureMinDuration } from '@/lib/minLoadDuration'
import { useCanonSave } from '@/components/editor/useCanonSave'
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
  const { lightMode, toggleLightMode } = useLightMode()
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false)
  const [edgeHovered, setEdgeHovered] = useState(false)
  const edgeLeaveTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  useEffect(() => {
    setSidebarCollapsed(localStorage.getItem('loom-sidebar-collapsed') === 'true')
  }, [])

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

  const { saveCanonAfterStructuralChange } = useCanonSave(seriesId)

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
    // Land the new chapter in the manuscript now — see the comment on
    // saveCanonAfterStructuralChange. Not awaited: the export takes seconds
    // and the writer should be typing by then, and `keepalive` carries it
    // across the navigation below.
    void saveCanonAfterStructuralChange(forBookId)
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
    // Doubly worth doing on an insert: this is the case that renumbers every
    // chapter below it, so the manifest is wrong about the whole tail of the
    // book until the export lands.
    void saveCanonAfterStructuralChange(forBookId)
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
        {/* Same component as the loaded state, in its loading form — no longer
            a hand-maintained copy of the nav. The switcher is one control at a
            fixed position, so the placeholder is a single bar; the old
            breadcrumb needed a per-route segment count to avoid reflowing. */}
        <AppHeader
          hasProject
          hasTools
          showBell
          showAppSwitch
          compactGreeting
          lightMode={lightMode}
          onToggleLightMode={toggleLightMode}
          loading
        />

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
        {/* Book and chapter are no longer in the header — the sidebar's
            OutlineTree already lists them and marks the active one, which a
            breadcrumb only duplicated. What's left is the project itself, and
            the switcher owns that (KAN-18).

            Progressive collapse still lives in AppHeader: the wordmark hides
            below xl and the greeting below lg. Both existed because the trail,
            the search bar and the identity cluster fought for one line — with
            the trail gone that pressure is much lower, so these breakpoints
            are worth re-checking once this has been used at narrow widths. */}
        <AppHeader
          project={{
            id: series.id,
            title: series.title,
            standalone: series.standalone,
            firstBookId: series.standalone ? (series.books[0]?.id ?? null) : null,
          }}
          tools={
            /* Shortcuts sits 8px from the search bar rather than the header's
               usual 12px — the tighter seam reads as one "find things" cluster
               and keeps the menu visually owned by the bar it documents. */
            <div className="flex items-center gap-2 min-w-0">
              <div className="shrink-0"><ShortcutsMenu /></div>
              <SearchBar
                seriesId={seriesId}
                books={series.books.map(b => ({ id: b.id, title: b.title }))}
              />
            </div>
          }
          showBell
          showAppSwitch
          compactGreeting
          lightMode={lightMode}
          onToggleLightMode={toggleLightMode}
        />

        <ToastLayer />
        {/* --author-sidebar tells PORTALLED overlays how wide the sidebar
            currently is. Modals portal into <main>, which is a child of this
            row, so they inherit it — but they are `fixed`, which is measured
            against the viewport, so without this they centre across the whole
            window and sit visibly off to the left of the content they belong
            to. A hard-coded 14rem would be wrong the moment the sidebar
            collapses; this tracks it, transition included. */}
        <div
          className="flex flex-1 overflow-hidden"
          style={{ '--author-sidebar': sidebarCollapsed ? '0.75rem' : '14rem' } as React.CSSProperties}
        >
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
