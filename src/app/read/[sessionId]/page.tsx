'use client'

import { useEffect, useState, useCallback, useMemo } from 'react'
import { useParams, useSearchParams } from 'next/navigation'
import ReaderView from '@/components/reader/ReaderView'
import type { StoryState, HistoryEntry } from '@/lib/storyEngine'
import { computeChapterLabels } from '@/lib/chapterLabels'

type Block = {
  id: string; order: number; type: string
  content?: string | null; prompt?: string | null; displayType?: string | null; baseContent?: string | null
  pinStart?: number | null; pinEnd?: number | null
  choices: { id: string; label: string; setsVariables: string; targetChapterId: string | null; endingMessage?: string | null; isBadEnding?: boolean }[]
  overrides: { id: string; order: number; condition: string; content: string }[]
}
type SeriesBook = {
  id: string; title: string; order: number
  chapters: { id: string; title: string; order: number; condition?: string | null; numbered?: boolean }[]
}
type Variable = { id: string; name: string; type: string; defaultValue: string }

export default function ReaderPage() {
  const { sessionId } = useParams() as { sessionId: string }
  const searchParams = useSearchParams()
  const returnTo = searchParams.get('returnTo') ?? undefined
  const startChapterId = searchParams.get('startChapterId')
  const [blocks, setBlocks] = useState<Block[]>([])
  const [storyState, setStoryState] = useState<StoryState>({})
  const [choiceHistory, setChoiceHistory] = useState<HistoryEntry[]>([])
  const [seriesId, setSeriesId] = useState('')
  const [seriesTitle, setSeriesTitle] = useState('')
  const [chapterLabel, setChapterLabel] = useState('')
  const [chapterPov, setChapterPov] = useState<string | null>(null)
  const [chapterDate, setChapterDate] = useState<string | null>(null)
  const [currentChapterId, setCurrentChapterId] = useState<string | null>(null)
  const [noContent, setNoContent] = useState(false)
  const [characters, setCharacters] = useState<{
    id: string
    name: string
    age: number | null
    hasAvatar: boolean
    hasBookAvatar?: boolean
    hasCanonicalAvatar?: boolean
    deceased?: boolean
  }[]>([])
  const [currentBookId, setCurrentBookId] = useState<string | null>(null)
  const [seriesBooks, setSeriesBooks] = useState<SeriesBook[]>([])
  const [variables, setVariables] = useState<Variable[]>([])

  const loadChapter = useCallback(async (chapterId: string) => {
    const res = await fetch(`/api/chapters/${chapterId}`)
    if (!res.ok) return
    const chapter = await res.json()
    setBlocks(chapter.blocks)
    setChapterLabel(chapter.title)
    setChapterPov(chapter.pov ?? null)
    setChapterDate(chapter.date ?? null)
    setCurrentChapterId(chapterId)
    setCurrentBookId(chapter.bookId ?? null)
  }, [])

  const loadSession = useCallback(async () => {
    const res = await fetch(`/api/sessions/${sessionId}`)
    if (!res.ok) return
    const session = await res.json()
    setStoryState(session.storyState)
    setChoiceHistory(session.choiceHistory)

    const seriesRes = await fetch(`/api/series/${session.seriesId}`)
    if (!seriesRes.ok) return
    const series = await seriesRes.json()
    setSeriesId(series.id)
    setSeriesTitle(series.title)
    setSeriesBooks(series.books ?? [])
    setVariables(series.variables ?? [])
    // Characters are refetched per-book in a separate effect below so the hover
    // card reflects book-specific overrides as the reader moves between books.

    if (session.currentBlockId) {
      const blockRes = await fetch(`/api/blocks/${session.currentBlockId}`)
      if (blockRes.ok) {
        const block = await blockRes.json()
        setCurrentChapterId(block.chapterId)
        return
      }
      // block not found — fall through to first chapter
    }

    // Fresh session — start at requested chapter or first chapter
    if (startChapterId) {
      setCurrentChapterId(startChapterId)
    } else if (series.books?.[0]?.chapters?.[0]) {
      setCurrentChapterId(series.books[0].chapters[0].id)
    } else {
      setNoContent(true)
    }
  }, [sessionId, startChapterId])

  useEffect(() => { loadSession() }, [loadSession])
  useEffect(() => { if (currentChapterId) loadChapter(currentChapterId) }, [currentChapterId, loadChapter])

  // Refetch characters when the reader crosses into a different book so the hover
  // card reflects per-book overrides (age, avatar) and respects firstBookId visibility.
  useEffect(() => {
    if (!seriesId || !currentBookId) return
    fetch(`/api/series/${seriesId}/books/${currentBookId}/characters`)
      .then(r => r.ok ? r.json() : [])
      .then(setCharacters)
      .catch(() => { /* ignore */ })
  }, [seriesId, currentBookId])

  function handleSessionUpdate(state: StoryState, history: HistoryEntry[]) {
    setStoryState(state)
    setChoiceHistory(history)
  }

  function handleNavigate(chapterId: string) {
    loadChapter(chapterId)
  }

  // Merge variable defaults under the session's storyState so that any variable
  // missing from the session (created after the session, wiped by a state reset,
  // or never set by a choice) falls back to its declared default.
  const mergedStoryState = useMemo(() => {
    const defaults: StoryState = {}
    for (const v of variables) {
      try { defaults[v.name] = JSON.parse(v.defaultValue) } catch { /* ignore malformed default */ }
    }
    return { ...defaults, ...storyState }
  }, [variables, storyState])

  // Compute the reader-facing label and visibility for every chapter under the current state.
  const chapterLabels = useMemo(() => computeChapterLabels(seriesBooks, mergedStoryState), [seriesBooks, mergedStoryState])

  // If the chapter we're currently on becomes hidden (e.g., after a rewind that flipped
  // the gating variable), jump to the first visible chapter in book order. No-op if
  // labels haven't been computed yet or if the current chapter is still visible.
  useEffect(() => {
    if (!currentChapterId) return
    if (Object.keys(chapterLabels).length === 0) return
    const label = chapterLabels[currentChapterId]
    if (label && label.visible) return
    const visibleNext = seriesBooks.flatMap(b => b.chapters).find(c => chapterLabels[c.id]?.visible)
    if (visibleNext) setCurrentChapterId(visibleNext.id)
    else setNoContent(true)
  }, [chapterLabels, currentChapterId, seriesBooks])

  // Reader-facing chapter label, taking the dynamic numbering into account.
  const displayChapterLabel = currentChapterId
    ? chapterLabels[currentChapterId]?.readerLabel ?? chapterLabel
    : chapterLabel

  if (noContent) {
    return (
      <div className="min-h-screen bg-surface-base flex items-center justify-center">
        <p className="text-ink-faint text-sm">
          {seriesTitle ? `"${seriesTitle}" has no chapters yet. Add some in the author editor.` : 'Loading…'}
        </p>
      </div>
    )
  }

  if (!currentChapterId || blocks.length === 0) {
    return (
      <div className="min-h-screen bg-surface-base flex items-center justify-center">
        <p className="text-ink-faint text-sm">Loading…</p>
      </div>
    )
  }

  const dynamicReturnTo = currentChapterId && seriesId
    ? `/author/${seriesId}/chapter/${currentChapterId}`
    : returnTo

  return (
    <ReaderView
      sessionId={sessionId}
      seriesId={seriesId}
      blocks={blocks}
      storyState={mergedStoryState}
      choiceHistory={choiceHistory}
      variables={variables}
      seriesTitle={seriesTitle}
      chapterLabel={displayChapterLabel}
      chapterPov={chapterPov}
      chapterDate={chapterDate}
      returnTo={dynamicReturnTo}
      characters={characters}
      currentBookId={currentBookId}
      books={seriesBooks}
      chapterLabels={chapterLabels}
      currentChapterId={currentChapterId ?? undefined}
      onSessionUpdate={handleSessionUpdate}
      onNavigate={handleNavigate}
    />
  )
}
