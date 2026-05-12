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
  choices: { id: string; label: string; setsVariables: string; targetChapterId: string | null }[]
  overrides: { id: string; order: number; condition: string; content: string }[]
}
type Chapter = { id: string; title: string; pov: string | null; date: string | null; blocks: Block[] }
type Variable = { id: string; name: string; type: string; defaultValue: string }
type Series = {
  id: string; title: string
  books: { id: string; title: string; order: number; chapters: { id: string; title: string; order: number }[] }[]
  variables: Variable[]
}

export default function ChapterEditorPage() {
  const { seriesId, chapterId } = useParams() as { seriesId: string; chapterId: string }
  const router = useRouter()
  const [series, setSeries] = useState<Series | null>(null)
  const [chapter, setChapter] = useState<Chapter | null>(null)
  async function patchChapter(field: 'pov' | 'date', value: string) {
    await fetch(`/api/chapters/${chapterId}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ [field]: value || null }),
    })
  }

  function handleMetaChange(field: 'pov' | 'date', value: string) {
    setChapter(prev => prev ? { ...prev, [field]: value } : null)
    patchChapter(field, value)
  }

  const loadSeries = useCallback(async () => {
    const res = await fetch(`/api/series/${seriesId}`)
    if (res.ok) setSeries(await res.json())
  }, [seriesId])

  const loadChapter = useCallback(async () => {
    const res = await fetch(`/api/chapters/${chapterId}`)
    if (res.ok) setChapter(await res.json())
  }, [chapterId])

  const reloadBlocks = useCallback(async () => {
    const res = await fetch(`/api/chapters/${chapterId}/blocks`)
    if (res.ok) {
      const blocks = await res.json()
      setChapter(prev => prev ? { ...prev, blocks } : null)
    }
  }, [chapterId])

  useEffect(() => { loadSeries() }, [loadSeries])
  useEffect(() => { loadChapter() }, [loadChapter])

  async function addBook(title: string) {
    await fetch(`/api/series/${seriesId}/books`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ title }) })
    loadSeries()
  }
  async function addChapter(bookId: string, title: string) {
    const res = await fetch(`/api/series/${seriesId}/books/${bookId}/chapters`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ title }) })
    const c = await res.json()
    loadSeries()
    router.push(`/author/${seriesId}/chapter/${c.id}`)
  }
  async function addVariable(name: string, type: string, defaultValue: unknown) {
    await fetch(`/api/series/${seriesId}/variables`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name, type, defaultValue }) })
    loadSeries()
  }
  async function deleteVariable(id: string) {
    await fetch(`/api/variables/${id}`, { method: 'DELETE' })
    loadSeries()
  }

  if (!series || !chapter) return (
    <div className="min-h-screen bg-surface-base flex items-center justify-center text-ink-faint text-sm">
      Loading…
    </div>
  )

  return (
    <div className="min-h-screen bg-surface-base flex flex-col">
      <nav className="sticky top-0 z-10 bg-surface-raised border-b border-accent/10 px-6 py-3 flex items-center gap-3 text-sm">
        <Link href="/" className="flex items-center gap-2">
          <img src="/loom-logo.svg" alt="" className="block h-9 w-9" />
          <span className="text-accent font-bold tracking-wider text-2xl leading-none">LOOM</span>
        </Link>
        <span className="text-ink-faint self-center">›</span>
        <Link href={`/author/${seriesId}`} className="text-ink-muted hover:text-ink self-center">{series.title}</Link>
        <span className="text-ink-faint self-center">›</span>
        <span className="text-ink-muted self-center">
          {series.books.find(b => b.chapters.some(c => c.id === chapterId))?.title}
        </span>
        <span className="text-ink-faint self-center">›</span>
        <span className="text-ink self-center">{chapter.title}</span>
        <button
          onClick={async () => {
            const res = await fetch('/api/sessions', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ seriesId }) })
            const session = await res.json()
            router.push(`/read/${session.id}`)
          }}
          className="ml-auto px-3 py-1.5 rounded text-xs bg-choice-spare-bg border border-choice-spare-border text-choice-spare hover:opacity-80 transition"
        >
          ▶ Preview as Reader
        </button>
      </nav>

      <div className="flex flex-1 overflow-hidden">
        <aside className="w-56 bg-surface-raised border-r border-accent/10 p-4 flex flex-col gap-6 overflow-y-auto">
          <OutlineTree seriesId={seriesId} books={series.books} onAddBook={addBook} onAddChapter={addChapter} />
          <VariablesPanel variables={series.variables} onAdd={addVariable} onDelete={deleteVariable} />
        </aside>

        <main className="flex-1 overflow-y-auto">
          <div className="max-w-2xl mx-auto px-8 py-8">
            <h2 className="text-lg font-semibold text-ink mb-3">{chapter.title}</h2>
            <div className="flex gap-4 mb-6">
              <div className="flex items-center gap-1.5">
                <span className="text-xs text-ink-faint uppercase tracking-widest">POV</span>
                <input
                  value={chapter.pov ?? ''}
                  onChange={e => handleMetaChange('pov', e.target.value)}
                  placeholder="Character name"
                  className="bg-surface-overlay border border-accent/15 rounded px-2 py-0.5 text-xs text-ink placeholder:text-ink-faint outline-none focus:border-accent w-36"
                />
              </div>
              <div className="flex items-center gap-1.5">
                <span className="text-xs text-ink-faint uppercase tracking-widest">Date</span>
                <input
                  value={chapter.date ?? ''}
                  onChange={e => handleMetaChange('date', e.target.value)}
                  placeholder="In-story date"
                  className="bg-surface-overlay border border-accent/15 rounded px-2 py-0.5 text-xs text-ink placeholder:text-ink-faint outline-none focus:border-accent w-40"
                />
              </div>
            </div>
            <BlockEditor
              chapterId={chapterId}
              blocks={chapter.blocks}
              variables={series.variables}
              onBlocksChange={reloadBlocks}
            />
          </div>
        </main>
      </div>
    </div>
  )
}
