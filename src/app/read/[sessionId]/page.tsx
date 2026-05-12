'use client'

import { useEffect, useState, useCallback } from 'react'
import { useParams } from 'next/navigation'
import ReaderView from '@/components/reader/ReaderView'
import type { StoryState, HistoryEntry } from '@/lib/storyEngine'

type Block = {
  id: string; order: number; type: string
  content?: string | null; prompt?: string | null; displayType?: string | null; baseContent?: string | null
  choices: { id: string; label: string; setsVariables: string; targetSceneId: string | null }[]
  overrides: { id: string; order: number; condition: string; content: string }[]
}

export default function ReaderPage() {
  const { sessionId } = useParams() as { sessionId: string }
  const [blocks, setBlocks] = useState<Block[]>([])
  const [storyState, setStoryState] = useState<StoryState>({})
  const [choiceHistory, setChoiceHistory] = useState<HistoryEntry[]>([])
  const [seriesTitle, setSeriesTitle] = useState('')
  const [sceneLabel, setSceneLabel] = useState('')
  const [currentSceneId, setCurrentSceneId] = useState<string | null>(null)
  const [noContent, setNoContent] = useState(false)

  const loadScene = useCallback(async (sceneId: string) => {
    const res = await fetch(`/api/scenes/${sceneId}`)
    if (!res.ok) return
    const scene = await res.json()
    setBlocks(scene.blocks)
    setSceneLabel(scene.title)
    setCurrentSceneId(sceneId)
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
    setSeriesTitle(series.title)

    if (session.currentBlockId) {
      const blockRes = await fetch(`/api/blocks/${session.currentBlockId}`)
      if (blockRes.ok) {
        const block = await blockRes.json()
        setCurrentSceneId(block.sceneId)
        return
      }
    }

    // Fresh session — start at first scene
    if (series.books?.[0]?.chapters?.[0]?.scenes?.[0]) {
      setCurrentSceneId(series.books[0].chapters[0].scenes[0].id)
    } else {
      setNoContent(true)
    }
  }, [sessionId])

  useEffect(() => { loadSession() }, [loadSession])
  useEffect(() => { if (currentSceneId) loadScene(currentSceneId) }, [currentSceneId, loadScene])

  function handleSessionUpdate(state: StoryState, history: HistoryEntry[]) {
    setStoryState(state)
    setChoiceHistory(history)
  }

  function handleNavigate(sceneId: string) {
    loadScene(sceneId)
  }

  if (noContent) {
    return (
      <div className="min-h-screen bg-surface-base flex items-center justify-center">
        <p className="text-ink-faint text-sm">
          {seriesTitle ? `"${seriesTitle}" has no scenes yet. Add some in the author editor.` : 'Loading…'}
        </p>
      </div>
    )
  }

  if (!currentSceneId || blocks.length === 0) {
    return (
      <div className="min-h-screen bg-surface-base flex items-center justify-center">
        <p className="text-ink-faint text-sm">Loading…</p>
      </div>
    )
  }

  return (
    <ReaderView
      sessionId={sessionId}
      blocks={blocks}
      storyState={storyState}
      choiceHistory={choiceHistory}
      seriesTitle={seriesTitle}
      sceneLabel={sceneLabel}
      onSessionUpdate={handleSessionUpdate}
      onNavigate={handleNavigate}
    />
  )
}
