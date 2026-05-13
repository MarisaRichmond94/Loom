'use client'

import { useEffect, useState, useCallback } from 'react'
import { useParams, useSearchParams } from 'next/navigation'
import ReaderView from '@/components/reader/ReaderView'
import type { StoryState, HistoryEntry } from '@/lib/storyEngine'

type Block = {
  id: string; order: number; type: string
  content?: string | null; prompt?: string | null; displayType?: string | null; baseContent?: string | null
  choices: { id: string; label: string; setsVariables: string; targetChapterId: string | null }[]
  overrides: { id: string; order: number; condition: string; content: string }[]
}

export default function ReaderPage() {
  const { sessionId } = useParams() as { sessionId: string }
  const returnTo = useSearchParams().get('returnTo') ?? undefined
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
  const [characters, setCharacters] = useState<{ id: string; name: string; age: number | null; hasAvatar: boolean }[]>([])

  const loadChapter = useCallback(async (chapterId: string) => {
    const res = await fetch(`/api/chapters/${chapterId}`)
    if (!res.ok) return
    const chapter = await res.json()
    setBlocks(chapter.blocks)
    setChapterLabel(chapter.title)
    setChapterPov(chapter.pov ?? null)
    setChapterDate(chapter.date ?? null)
    setCurrentChapterId(chapterId)
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
    fetch(`/api/series/${series.id}/characters`).then(r => r.ok ? r.json() : []).then(setCharacters)

    if (session.currentBlockId) {
      const blockRes = await fetch(`/api/blocks/${session.currentBlockId}`)
      if (blockRes.ok) {
        const block = await blockRes.json()
        setCurrentChapterId(block.chapterId)
        return
      }
      // block not found — fall through to first chapter
    }

    // Fresh session — start at first chapter
    if (series.books?.[0]?.chapters?.[0]) {
      setCurrentChapterId(series.books[0].chapters[0].id)
    } else {
      setNoContent(true)
    }
  }, [sessionId])

  useEffect(() => { loadSession() }, [loadSession])
  useEffect(() => { if (currentChapterId) loadChapter(currentChapterId) }, [currentChapterId, loadChapter])

  function handleSessionUpdate(state: StoryState, history: HistoryEntry[]) {
    setStoryState(state)
    setChoiceHistory(history)
  }

  function handleNavigate(chapterId: string) {
    loadChapter(chapterId)
  }

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

  return (
    <ReaderView
      sessionId={sessionId}
      seriesId={seriesId}
      blocks={blocks}
      storyState={storyState}
      choiceHistory={choiceHistory}
      seriesTitle={seriesTitle}
      chapterLabel={chapterLabel}
      chapterPov={chapterPov}
      chapterDate={chapterDate}
      returnTo={returnTo}
      characters={characters}
      onSessionUpdate={handleSessionUpdate}
      onNavigate={handleNavigate}
    />
  )
}
