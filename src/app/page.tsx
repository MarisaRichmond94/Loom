'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'

type Series = { id: string; title: string; description: string; createdAt: string }

export default function HomePage() {
  const router = useRouter()
  const [series, setSeries] = useState<Series[]>([])
  const [title, setTitle] = useState('')
  const [creating, setCreating] = useState(false)
  const [showForm, setShowForm] = useState(false)

  useEffect(() => {
    fetch('/api/series').then(r => r.json()).then(setSeries)
  }, [])

  async function handleCreate(e: React.FormEvent) {
    e.preventDefault()
    if (!title.trim()) return
    setCreating(true)
    const res = await fetch('/api/series', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ title }),
    })
    const created = await res.json()
    setCreating(false)
    setTitle('')
    setShowForm(false)
    router.push(`/author/${created.id}`)
  }

  return (
    <main className="max-w-3xl mx-auto px-6 py-12">
      <div className="flex items-center justify-between mb-10">
        <div className="flex items-center gap-2">
          <img src="/loom-logo.svg" alt="" className="block h-12 w-12" />
          <h1 className="text-5xl font-bold tracking-tight text-accent leading-none">Loom</h1>
        </div>
        <button
          onClick={() => setShowForm(s => !s)}
          className="px-4 py-2 rounded bg-accent text-white text-sm font-medium hover:opacity-90 transition"
        >
          Add Series
        </button>
      </div>

      {showForm && (
        <form onSubmit={handleCreate} className="mb-8 p-5 rounded-lg bg-surface-raised border border-accent/20">
          <label className="block text-xs uppercase tracking-widest text-ink-faint mb-2">Series title</label>
          <input
            autoFocus
            value={title}
            onChange={e => setTitle(e.target.value)}
            placeholder="The Unnamed Series"
            className="w-full bg-surface-overlay border border-accent/20 rounded px-3 py-2 text-ink placeholder:text-ink-faint text-sm outline-none focus:border-accent mb-3"
          />
          <button
            type="submit"
            disabled={creating}
            className="px-4 py-2 bg-accent text-surface-base rounded text-sm font-medium disabled:opacity-50"
          >
            {creating ? 'Creating…' : 'Create Series'}
          </button>
        </form>
      )}

      {series.length === 0 ? (
        <p className="text-ink-muted text-sm">No series yet. Create your first one above.</p>
      ) : (
        <div className="flex flex-col gap-3">
          {series.map(s => (
            <div key={s.id} className="p-5 rounded-lg bg-surface-raised border border-accent/10 flex items-center justify-between">
              <div>
                <div className="font-medium text-ink">{s.title}</div>
                {s.description && <div className="text-sm text-ink-muted mt-1">{s.description}</div>}
              </div>
              <div className="flex gap-2">
                <Link
                  href={`/author/${s.id}`}
                  className="px-3 py-1.5 rounded text-xs bg-surface-overlay border border-accent/20 text-ink-muted hover:text-ink transition"
                >
                  Edit
                </Link>
                <button
                  onClick={async () => {
                    const res = await fetch('/api/sessions', {
                      method: 'POST',
                      headers: { 'Content-Type': 'application/json' },
                      body: JSON.stringify({ seriesId: s.id }),
                    })
                    const session = await res.json()
                    router.push(`/read/${session.id}`)
                  }}
                  className="px-3 py-1.5 rounded text-xs bg-choice-spare-bg border border-choice-spare-border text-choice-spare hover:opacity-80 transition"
                >
                  ▶ Read
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
    </main>
  )
}
