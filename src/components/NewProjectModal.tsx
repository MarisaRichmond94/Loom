'use client'

import { useEffect, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import { LuUpload, LuX } from 'react-icons/lu'
import { projectHref } from '@/components/ProjectSwitcher'

/**
 * Create a project from the switcher (KAN-18).
 *
 * Creation used to live only on `/`, which meant leaving whatever you were
 * writing to start something new. This is the same form in a modal, reachable
 * from the header on any author page.
 *
 * Import lives here too: it creates a project from a .loom.json, so it belongs
 * on the creation surface rather than being a separate errand. "From scratch"
 * and "from a file" are two answers to one question.
 *
 * Type mirrors the data model exactly — a standalone book is a Series with
 * standalone:true, and POST /api/series auto-creates its single Book.
 */

type Kind = 'series' | 'standalone'

export default function NewProjectModal({ onClose }: { onClose: () => void }) {
  const router = useRouter()
  const [kind, setKind] = useState<Kind>('series')
  const [title, setTitle] = useState('')
  const [creating, setCreating] = useState(false)
  const [importing, setImporting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const titleRef = useRef<HTMLInputElement>(null)
  const importRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    // rAF so focus lands after the modal paints, matching the pattern the
    // inline form on `/` uses.
    requestAnimationFrame(() => titleRef.current?.focus())
  }, [])

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape' && !creating && !importing) onClose()
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [onClose, creating, importing])

  const busy = creating || importing

  async function handleCreate(e: React.FormEvent) {
    e.preventDefault()
    if (!title.trim() || busy) return
    setCreating(true)
    setError(null)
    try {
      const res = await fetch('/api/series', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ title, standalone: kind === 'standalone' }),
      })
      if (!res.ok) throw new Error(await res.text())
      const created = await res.json()
      onClose()
      router.push(
        projectHref({
          id: created.id,
          standalone: kind === 'standalone',
          firstBookId: created.bookId ?? null,
        })
      )
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
      setCreating(false)
    }
  }

  async function handleImport(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (!file) return
    setImporting(true)
    setError(null)
    try {
      const res = await fetch('/api/import', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: await file.text(),
      })
      if (!res.ok) throw new Error(await res.text())
      const { seriesId } = await res.json()
      onClose()
      router.push(`/author/${seriesId}`)
    } catch (err) {
      // Surfaced inline rather than through alert() — the modal is still open
      // and has somewhere to put it.
      setError(`Import failed: ${err instanceof Error ? err.message : err}`)
      setImporting(false)
    }
    if (importRef.current) importRef.current.value = ''
  }

  return (
    <div
      className="fixed inset-0 z-[100] flex items-center justify-center bg-black/50 px-4"
      onMouseDown={e => { if (e.target === e.currentTarget && !busy) onClose() }}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label="New project"
        className="w-full max-w-md rounded-xl bg-surface-raised border border-accent/20 shadow-2xl"
      >
        <div className="flex items-center justify-between px-5 py-3 border-b border-accent/10">
          <h2 className="text-sm font-medium text-ink">New project</h2>
          <button
            onClick={onClose}
            disabled={busy}
            aria-label="Close"
            className="p-1 rounded text-ink-faint hover:text-ink hover:bg-accent/10 transition disabled:opacity-50"
          >
            <LuX size={14} />
          </button>
        </div>

        <form onSubmit={handleCreate} className="p-5">
          <label className="block text-xs uppercase tracking-widest text-ink-faint mb-2">Type</label>
          <div className="flex gap-2 mb-4">
            {([
              { id: 'series', label: 'Series' },
              { id: 'standalone', label: 'Stand-alone book' },
            ] as const).map(opt => (
              <button
                type="button"
                key={opt.id}
                onClick={() => setKind(opt.id)}
                className={`px-3 py-1.5 rounded text-xs font-medium transition border ${
                  kind === opt.id
                    ? 'bg-accent text-white border-accent'
                    : 'bg-surface-overlay text-ink-muted border-accent/20 hover:text-ink'
                }`}
              >
                {opt.label}
              </button>
            ))}
          </div>

          <label className="block text-xs uppercase tracking-widest text-ink-faint mb-2">
            {kind === 'standalone' ? 'Book title' : 'Series title'}
          </label>
          <input
            ref={titleRef}
            value={title}
            onChange={e => setTitle(e.target.value)}
            placeholder={kind === 'standalone' ? 'The Unnamed Book' : 'The Unnamed Series'}
            className="w-full bg-surface-overlay border border-accent/20 rounded px-3 py-2 text-ink placeholder:text-ink-faint text-sm outline-none focus:border-accent mb-4"
          />

          {error && <p className="text-xs text-choice-kill mb-3 break-words">{error}</p>}

          <div className="flex items-center justify-between gap-3">
            <input
              ref={importRef}
              type="file"
              accept=".json,.loom.json"
              onChange={handleImport}
              className="hidden"
            />
            <button
              type="button"
              onClick={() => importRef.current?.click()}
              disabled={busy}
              title="Create a project from an exported .loom.json"
              className="flex items-center gap-1.5 text-xs text-ink-muted hover:text-ink transition disabled:opacity-50"
            >
              <LuUpload size={12} /> {importing ? 'Importing…' : 'Import'}
            </button>

            <div className="flex items-center gap-3">
              <button
                type="button"
                onClick={onClose}
                disabled={busy}
                className="text-sm text-ink-muted hover:text-ink transition disabled:opacity-50"
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={busy || !title.trim()}
                className="px-4 py-2 bg-accent text-surface-base rounded text-sm font-medium disabled:opacity-50"
              >
                {creating ? 'Creating…' : kind === 'standalone' ? 'Create Book' : 'Create Series'}
              </button>
            </div>
          </div>
        </form>
      </div>
    </div>
  )
}
