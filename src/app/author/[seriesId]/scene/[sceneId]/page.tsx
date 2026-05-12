'use client'

import { useEffect, useState, useCallback } from 'react'
import { useParams, useRouter } from 'next/navigation'
import Link from 'next/link'
import BlockEditor from '@/components/editor/BlockEditor'
import OutlineTree from '@/components/sidebar/OutlineTree'
import VariablesPanel from '@/components/sidebar/VariablesPanel'

type Block = {
  id: string; order: number; type: string
  content?: string | null; prompt?: string | null; displayType?: string | null; baseContent?: string | null
  choices: { id: string; label: string; setsVariables: string; targetSceneId: string | null }[]
  overrides: { id: string; order: number; condition: string; content: string }[]
}
type Scene = { id: string; title: string; blocks: Block[] }
type Variable = { id: string; name: string; type: string; defaultValue: string }
type Series = {
  id: string; title: string
  books: { id: string; title: string; order: number; chapters: { id: string; title: string; order: number; scenes: { id: string; title: string; order: number }[] }[] }[]
  variables: Variable[]
}

export default function SceneEditorPage() {
  const { seriesId, sceneId } = useParams() as { seriesId: string; sceneId: string }
  const router = useRouter()
  const [series, setSeries] = useState<Series | null>(null)
  const [scene, setScene] = useState<Scene | null>(null)

  const loadSeries = useCallback(async () => {
    const res = await fetch(`/api/series/${seriesId}`)
    if (res.ok) setSeries(await res.json())
  }, [seriesId])

  const loadScene = useCallback(async () => {
    const res = await fetch(`/api/scenes/${sceneId}`)
    if (res.ok) setScene(await res.json())
  }, [sceneId])

  const reloadBlocks = useCallback(async () => {
    const res = await fetch(`/api/scenes/${sceneId}/blocks`)
    if (res.ok) {
      const blocks = await res.json()
      setScene(prev => prev ? { ...prev, blocks } : null)
    }
  }, [sceneId])

  useEffect(() => { loadSeries() }, [loadSeries])
  useEffect(() => { loadScene() }, [loadScene])

  async function addBook(title: string) {
    await fetch(`/api/series/${seriesId}/books`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ title }) })
    loadSeries()
  }
  async function addChapter(bookId: string, title: string) {
    await fetch(`/api/series/${seriesId}/books/${bookId}/chapters`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ title }) })
    loadSeries()
  }
  async function addScene(bookId: string, chapterId: string, title: string) {
    const res = await fetch(`/api/series/${seriesId}/books/${bookId}/chapters/${chapterId}/scenes`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ title }) })
    const s = await res.json()
    loadSeries()
    router.push(`/author/${seriesId}/scene/${s.id}`)
  }
  async function addVariable(name: string, type: string, defaultValue: unknown) {
    await fetch(`/api/series/${seriesId}/variables`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name, type, defaultValue }) })
    loadSeries()
  }
  async function deleteVariable(id: string) {
    await fetch(`/api/variables/${id}`, { method: 'DELETE' })
    loadSeries()
  }

  if (!series || !scene) return (
    <div className="min-h-screen bg-surface-base flex items-center justify-center text-ink-faint text-sm">
      Loading…
    </div>
  )

  return (
    <div className="min-h-screen bg-surface-base flex flex-col">
      <nav className="bg-surface-raised border-b border-accent/10 px-6 py-3 flex items-center gap-3 text-sm">
        <Link href="/" className="text-accent font-bold tracking-wider">LOOM</Link>
        <span className="text-ink-faint">›</span>
        <Link href={`/author/${seriesId}`} className="text-ink-muted hover:text-ink">{series.title}</Link>
        <span className="text-ink-faint">›</span>
        <span className="text-ink">{scene.title}</span>
        <div className="ml-auto">
          <button
            onClick={async () => {
              const res = await fetch('/api/sessions', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ seriesId }) })
              const session = await res.json()
              router.push(`/read/${session.id}`)
            }}
            className="px-3 py-1.5 rounded text-xs bg-choice-spare-bg border border-choice-spare-border text-choice-spare hover:opacity-80 transition"
          >
            ▶ Preview as Reader
          </button>
        </div>
      </nav>

      <div className="flex flex-1 overflow-hidden">
        <aside className="w-56 bg-surface-raised border-r border-accent/10 p-4 flex flex-col gap-6 overflow-y-auto">
          <OutlineTree seriesId={seriesId} books={series.books} onAddBook={addBook} onAddChapter={addChapter} onAddScene={addScene} />
          <VariablesPanel variables={series.variables} onAdd={addVariable} onDelete={deleteVariable} />
        </aside>

        <main className="flex-1 overflow-y-auto">
          <div className="max-w-2xl mx-auto px-8 py-8">
            <h2 className="text-lg font-semibold text-ink mb-6">{scene.title}</h2>
            <BlockEditor
              sceneId={sceneId}
              blocks={scene.blocks}
              variables={series.variables}
              onBlocksChange={reloadBlocks}
            />
          </div>
        </main>
      </div>
    </div>
  )
}
