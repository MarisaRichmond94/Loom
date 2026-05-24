'use client'

import { useEffect, useRef, useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { LuPlay, LuDownload } from 'react-icons/lu'

type SeriesStats = { bookCount: number; uniquePovs: number; choiceCount: number; wordCount: number }
type Series = {
  id: string
  title: string
  description: string
  createdAt: string
  standalone?: boolean
  stats?: SeriesStats
}

// Author-facing series list. The shared (home) layout supplies the
// LOOM logo, the Explore | Write tabs, the greeting, and the theme
// toggle — this view is just the content area.
export default function WritePage() {
  const router = useRouter()
  const [series, setSeries] = useState<Series[]>([])
  const [title, setTitle] = useState('')
  // Stand-alone book vs. series. Backing the same data model (a Series
  // with one Book), but routing the author straight to that book editor
  // when stand-alone so they don't bounce through an outline view of one.
  const [kind, setKind] = useState<'series' | 'standalone'>('series')
  const [creating, setCreating] = useState(false)
  const [showForm, setShowForm] = useState(false)
  const [importing, setImporting] = useState(false)
  const importRef = useRef<HTMLInputElement>(null)
  // Title input is focused via a ref when the form expands rather than via
  // autoFocus — the form stays mounted (collapsed) so the close transition
  // can play, and autoFocus would otherwise pull focus on first render.
  const titleInputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    fetch('/api/series').then(r => r.json()).then(setSeries)
  }, [])

  useEffect(() => {
    if (showForm) {
      // requestAnimationFrame lets the open transition start before focus
      // moves; without it the caret can flash at the collapsed position.
      requestAnimationFrame(() => titleInputRef.current?.focus())
    }
  }, [showForm])

  async function handleImport(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (!file) return
    setImporting(true)
    try {
      const text = await file.text()
      const res = await fetch('/api/import', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: text,
      })
      if (!res.ok) throw new Error(await res.text())
      const { seriesId } = await res.json()
      router.push(`/author/${seriesId}`)
    } catch (err) {
      alert(`Import failed: ${err instanceof Error ? err.message : err}`)
      setImporting(false)
    }
    if (importRef.current) importRef.current.value = ''
  }

  async function handleCreate(e: React.FormEvent) {
    e.preventDefault()
    if (!title.trim()) return
    setCreating(true)
    const res = await fetch('/api/series', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ title, standalone: kind === 'standalone' }),
    })
    const created = await res.json()
    setCreating(false)
    setTitle('')
    setKind('series')
    setShowForm(false)
    // Stand-alone authors don't need to see the series outline; the API
    // already created the single book for them, so land them on it.
    if (kind === 'standalone' && created.bookId) {
      router.push(`/author/${created.id}/book/${created.bookId}`)
    } else {
      router.push(`/author/${created.id}`)
    }
  }

  function handleCancel() {
    setTitle('')
    setKind('series')
    setShowForm(false)
  }

  return (
    <div className="max-w-3xl mx-auto px-6 py-10">
      {/* pr-5 nudges the toolbar buttons in by p-5 — the same inset the
          cards below use for their internal padding — so the right
          edges of all the action buttons line up visually. */}
      <div className="flex items-center justify-end gap-2 mb-3 pr-5">
        <input ref={importRef} type="file" accept=".json,.loom.json" onChange={handleImport} className="hidden" />
        <button
          onClick={() => importRef.current?.click()}
          disabled={importing}
          className="px-4 py-2 rounded bg-surface-raised border border-accent/20 text-ink-muted text-sm font-medium hover:text-ink transition disabled:opacity-50"
        >
          {importing ? 'Importing…' : '↑ Import'}
        </button>
        <button
          onClick={() => setShowForm(s => !s)}
          className="px-4 py-2 rounded bg-accent text-white text-sm font-medium hover:opacity-90 transition"
        >
          + New
        </button>
      </div>

      {/* The form stays mounted whether or not it's open so the close
          transition can play. max-h + opacity + mb collapse together so
          there's no margin jump after the height settles. */}
      <div
        className={`transition-all duration-200 ease-out overflow-hidden ${
          showForm ? 'max-h-[600px] opacity-100 mb-4' : 'max-h-0 opacity-0 mb-0'
        }`}
        aria-hidden={!showForm}
      >
        <form onSubmit={handleCreate} className="p-5 rounded-lg bg-surface-raised border border-accent/20">
          <label className="block text-xs uppercase tracking-widest text-ink-faint mb-2">Type</label>
          <div className="flex gap-2 mb-4">
            {([
              { id: 'series', label: 'Series' },
              { id: 'standalone', label: 'Stand-alone book' },
            ] as const).map(opt => {
              const active = kind === opt.id
              return (
                <button
                  type="button"
                  key={opt.id}
                  onClick={() => setKind(opt.id)}
                  className={`px-3 py-1.5 rounded text-xs font-medium transition border ${
                    active
                      ? 'bg-accent text-white border-accent'
                      : 'bg-surface-overlay text-ink-muted border-accent/20 hover:text-ink'
                  }`}
                >
                  {opt.label}
                </button>
              )
            })}
          </div>

          <label className="block text-xs uppercase tracking-widest text-ink-faint mb-2">
            {kind === 'standalone' ? 'Book title' : 'Series title'}
          </label>
          <input
            ref={titleInputRef}
            value={title}
            onChange={e => setTitle(e.target.value)}
            placeholder={kind === 'standalone' ? 'The Unnamed Book' : 'The Unnamed Series'}
            className="w-full bg-surface-overlay border border-accent/20 rounded px-3 py-2 text-ink placeholder:text-ink-faint text-sm outline-none focus:border-accent mb-4"
          />

          <div className="flex items-center justify-end gap-3">
            <button
              type="button"
              onClick={handleCancel}
              disabled={creating}
              className="text-sm text-ink-muted hover:text-ink transition disabled:opacity-50"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={creating || !title.trim()}
              className="px-4 py-2 bg-accent text-surface-base rounded text-sm font-medium disabled:opacity-50"
            >
              {creating
                ? 'Creating…'
                : kind === 'standalone' ? 'Create Book' : 'Create Series'}
            </button>
          </div>
        </form>
      </div>

      {series.length === 0 ? (
        <p className="text-ink-muted text-sm">No series yet. Create your first one above.</p>
      ) : (
        <div className="flex flex-col gap-3">
          {series.map(s => (
            <div key={s.id} className="p-5 rounded-lg bg-surface-raised border border-accent/10 transition-transform duration-150 hover:scale-[1.01]">
              {/* Title + actions share a row up top so the buttons have a
                  steady anchor; the description drops to a full-width
                  paragraph below so it can breathe. Title + description
                  are both links to the author page (same href). */}
              <div className="flex items-center justify-between gap-3">
                <Link href={`/author/${s.id}`} className="font-medium text-ink hover:opacity-80 flex-1 min-w-0 truncate">
                  {s.title}
                </Link>
                <div className="flex gap-2 shrink-0">
                  <a
                    href={`/api/series/${s.id}/export`}
                    download
                    className="px-3 py-1.5 rounded text-xs bg-surface-overlay border border-accent/20 text-ink-muted hover:text-ink transition flex items-center gap-1.5"
                  >
                    <LuDownload size={11} /> Export
                  </a>
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
                    className="px-3 py-1.5 rounded text-xs bg-surface-overlay border border-accent/20 text-ink-muted hover:text-ink transition flex items-center gap-1.5"
                  >
                    <LuPlay size={11} /> Read
                  </button>
                </div>
              </div>
              {s.description && (
                <Link
                  href={`/author/${s.id}`}
                  className="block text-sm text-ink-muted mt-2 hover:opacity-80"
                >
                  {s.description}
                </Link>
              )}
              {s.stats && (
                <div className="grid grid-cols-4 gap-3 mt-4">
                  {[
                    { label: 'Book(s)',    value: s.stats.bookCount },
                    { label: 'POV(s)',     value: s.stats.uniquePovs },
                    { label: 'Word(s)',    value: s.stats.wordCount.toLocaleString() },
                    { label: 'Choice(s)',  value: s.stats.choiceCount },
                  ].map(({ label, value }) => (
                    <div
                      key={label}
                      className="bg-surface-overlay border border-accent/10 rounded-lg px-3 py-3 flex flex-col items-center gap-1"
                    >
                      <span className="text-lg font-bold text-ink leading-none">{value}</span>
                      <span className="text-[10px] text-ink-faint uppercase tracking-widest">{label}</span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
