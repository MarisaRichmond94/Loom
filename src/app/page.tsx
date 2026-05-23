'use client'

import { useEffect, useRef, useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { LuMoon, LuSun, LuPlay, LuDownload } from 'react-icons/lu'
import AvatarButton from '@/components/AvatarButton'
import Greeting from '@/components/Greeting'

type Series = { id: string; title: string; description: string; createdAt: string }

export default function HomePage() {
  const router = useRouter()
  const [series, setSeries] = useState<Series[]>([])
  const [title, setTitle] = useState('')
  const [creating, setCreating] = useState(false)
  const [showForm, setShowForm] = useState(false)
  const [importing, setImporting] = useState(false)
  const [lightMode, setLightMode] = useState(false)
  useEffect(() => {
    setLightMode(localStorage.getItem('loom-light-mode') === 'true')
  }, [])
  const importRef = useRef<HTMLInputElement>(null)

  function toggleLightMode() {
    setLightMode(prev => {
      const next = !prev
      localStorage.setItem('loom-light-mode', String(next))
      return next
    })
  }

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
    <div className="h-screen bg-surface-base flex flex-col overflow-hidden">
      <nav className="sticky top-0 z-10 bg-surface-raised border-b border-accent/10 px-6 py-3 flex items-center gap-3 text-sm">
        <Link href="/" className="flex items-center gap-2">
          <img src="/loom-logo.svg" alt="" className="block h-9 w-9" />
          <span className="text-accent font-bold tracking-wider text-2xl leading-none">LOOM</span>
        </Link>
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

      <main className={`flex-1 overflow-y-auto${lightMode ? ' light-body' : ''}`}>
        <div className="max-w-3xl mx-auto px-6 py-10">
          <div className="flex items-center justify-end gap-2 mb-3">
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
                <div key={s.id} className="p-5 rounded-lg bg-surface-raised border border-accent/10 flex items-center justify-between transition-transform duration-150 hover:scale-[1.01]">
                  <Link href={`/author/${s.id}`} className="flex-1 min-w-0 mr-4">
                    <div className="font-medium text-ink">{s.title}</div>
                    {s.description && <div className="text-sm text-ink-muted mt-1">{s.description}</div>}
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
              ))}
            </div>
          )}
        </div>
      </main>
    </div>
  )
}
