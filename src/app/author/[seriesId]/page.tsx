'use client'

import { useEffect, useState, useCallback } from 'react'
import { useParams, useRouter } from 'next/navigation'
import Link from 'next/link'
import OutlineTree from '@/components/sidebar/OutlineTree'
import VariablesPanel from '@/components/sidebar/VariablesPanel'

type Chapter = { id: string; title: string; order: number }
type Book = { id: string; title: string; order: number; chapters: Chapter[] }
type Variable = { id: string; name: string; type: string; defaultValue: string }
type Series = { id: string; title: string; books: Book[]; variables: Variable[] }

export default function AuthorSeriesPage() {
  const { seriesId } = useParams() as { seriesId: string }
  const router = useRouter()
  const [series, setSeries] = useState<Series | null>(null)

  const load = useCallback(async () => {
    const res = await fetch(`/api/series/${seriesId}`)
    if (res.ok) setSeries(await res.json())
  }, [seriesId])

  useEffect(() => { load() }, [load])

  async function addBook(title: string) {
    await fetch(`/api/series/${seriesId}/books`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ title }),
    })
    load()
  }

  async function addChapter(bookId: string, title: string) {
    const res = await fetch(`/api/series/${seriesId}/books/${bookId}/chapters`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ title }),
    })
    const chapter = await res.json()
    await load()
    router.push(`/author/${seriesId}/chapter/${chapter.id}`)
  }

  async function addVariable(name: string, type: string, defaultValue: unknown) {
    await fetch(`/api/series/${seriesId}/variables`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name, type, defaultValue }),
    })
    load()
  }

  async function deleteVariable(id: string) {
    await fetch(`/api/variables/${id}`, { method: 'DELETE' })
    load()
  }

  if (!series) return (
    <div className="min-h-screen bg-surface-base flex items-center justify-center text-ink-faint text-sm">
      Loading…
    </div>
  )

  return (
    <div className="min-h-screen bg-surface-base flex flex-col">
      <nav className="bg-surface-raised border-b border-accent/10 px-6 py-3 flex items-center gap-3 text-sm">
        <Link href="/" className="text-accent font-bold tracking-wider">LOOM</Link>
        <span className="text-ink-faint">›</span>
        <span className="text-ink">{series.title}</span>
      </nav>

      <div className="flex flex-1 overflow-hidden">
        <aside className="w-56 bg-surface-raised border-r border-accent/10 p-4 flex flex-col gap-6 overflow-y-auto">
          <OutlineTree
            seriesId={seriesId}
            books={series.books}
            onAddBook={addBook}
            onAddChapter={addChapter}
          />
          <VariablesPanel
            variables={series.variables}
            onAdd={addVariable}
            onDelete={deleteVariable}
          />
        </aside>

        <main className="flex-1 flex items-center justify-center text-ink-faint text-sm">
          Select a chapter from the outline to start writing.
        </main>
      </div>
    </div>
  )
}
