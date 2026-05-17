'use client'

import { ReactNode, useCallback, useEffect, useState } from 'react'
import { useParams, useRouter } from 'next/navigation'
import Link from 'next/link'
import { LuMoon, LuSun } from 'react-icons/lu'
import OutlineTree from '@/components/sidebar/OutlineTree'
import VariablesPanel from '@/components/sidebar/VariablesPanel'
import ChoicesPanel from '@/components/sidebar/ChoicesPanel'
import AvatarButton from '@/components/AvatarButton'
import Greeting from '@/components/Greeting'
import { AuthorProvider, type AuthorSeries } from '@/lib/authorContext'

type ChoiceQuestion = { id: string; prompt: string; chapterId: string; chapterTitle: string; bookTitle: string }

export default function AuthorLayout({ children }: { children: ReactNode }) {
  const router = useRouter()
  const params = useParams() as { seriesId: string; bookId?: string; chapterId?: string }
  const { seriesId, bookId, chapterId } = params

  const [series, setSeries] = useState<AuthorSeries | null>(null)
  const [choiceQuestions, setChoiceQuestions] = useState<ChoiceQuestion[]>([])
  const [addChoice, setAddChoice] = useState<(() => void) | null>(null)
  const [lightMode, setLightMode] = useState(() =>
    typeof window !== 'undefined' && localStorage.getItem('loom-light-mode') === 'true',
  )

  function toggleLightMode() {
    setLightMode(prev => {
      const next = !prev
      localStorage.setItem('loom-light-mode', String(next))
      return next
    })
  }

  const loadSeries = useCallback(async () => {
    const res = await fetch(`/api/series/${seriesId}`)
    if (res.ok) setSeries(await res.json())
  }, [seriesId])

  const loadChoices = useCallback(async () => {
    const qs = chapterId ? `?upToChapterId=${chapterId}` : bookId ? `?upToBookId=${bookId}` : ''
    const res = await fetch(`/api/series/${seriesId}/choices${qs}`)
    if (res.ok) setChoiceQuestions(await res.json())
  }, [seriesId, bookId, chapterId])

  useEffect(() => { loadSeries() }, [loadSeries])
  useEffect(() => { loadChoices() }, [loadChoices])

  // Stable so chapter page can register a callback in an effect without churn
  const registerAddChoice = useCallback((fn: (() => void) | null) => {
    setAddChoice(() => fn)
  }, [])

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
    router.push(`/author/${seriesId}/chapter/${chapter.id}`)
  }

  async function insertChapter(forBookId: string, title: string, atOrder: number) {
    const res = await fetch(`/api/series/${seriesId}/books/${forBookId}/chapters`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ title, insertAtOrder: atOrder }),
    })
    const chapter = await res.json()
    await loadSeries()
    router.push(`/author/${seriesId}/chapter/${chapter.id}`)
  }

  async function addVariable(name: string, type: string, defaultValue: unknown) {
    await fetch(`/api/series/${seriesId}/variables`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name, type, defaultValue }),
    })
    loadSeries()
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
      <div className="min-h-screen bg-surface-base flex items-center justify-center text-ink-faint text-sm">
        Loading…
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
    <AuthorProvider value={{ series, loadSeries, loadChoices, lightMode, registerAddChoice }}>
      <div className="h-screen bg-surface-base flex flex-col overflow-hidden">
        <nav className="sticky top-0 z-10 bg-surface-raised border-b border-accent/10 px-6 py-3 flex items-center gap-3 text-sm">
          <Link href="/" className="flex items-center gap-2">
            <img src="/loom-logo.svg" alt="" className="block h-9 w-9" />
            <span className="text-accent font-bold tracking-wider text-2xl leading-none">LOOM</span>
          </Link>
          <span className="text-ink-faint self-center">›</span>
          {activeBook || activeChapter ? (
            <Link href={`/author/${seriesId}`} className="text-ink-muted hover:text-ink self-center">{series.title}</Link>
          ) : (
            <span className="text-ink self-center">{series.title}</span>
          )}
          {activeBook && (
            <>
              <span className="text-ink-faint self-center">›</span>
              {activeChapter ? (
                <Link href={`/author/${seriesId}/book/${activeBook.id}`} className="text-ink-muted hover:text-ink self-center">{activeBook.title}</Link>
              ) : (
                <span className="text-ink self-center">{activeBook.title}</span>
              )}
            </>
          )}
          {activeChapter && (
            <>
              <span className="text-ink-faint self-center">›</span>
              <span className="text-ink self-center">{activeChapter.title}</span>
            </>
          )}
          <div className="ml-auto flex items-center gap-2">
            <Greeting />
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
                onAddChoice={addChoice ?? undefined}
              />
            </div>
            <div className="flex flex-col min-h-0 max-h-[25%] p-4 pt-3 border-t border-accent/10">
              <VariablesPanel
                variables={series.variables}
                onAdd={addVariable}
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
