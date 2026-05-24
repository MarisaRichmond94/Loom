'use client'

import { useEffect, useState, useCallback, useRef } from 'react'
import { useParams, useRouter } from 'next/navigation'
import { LuDownload, LuEye } from 'react-icons/lu'
import { useAuthor } from '@/lib/authorContext'
import { ensureMinDuration } from '@/lib/minLoadDuration'
import SeriesTagsEditor from '@/components/editor/SeriesTagsEditor'

type BookStats = { chapterCount: number; wordCount: number; uniquePovs: number; choiceCount: number; coverPath: string | null }

export default function AuthorSeriesPage() {
  const { seriesId } = useParams() as { seriesId: string }
  const router = useRouter()
  const { series, loadSeries } = useAuthor()
  const [bookStats, setBookStats] = useState<Record<string, BookStats>>({})
  const [statsLoaded, setStatsLoaded] = useState(false)
  const [titleDraft, setTitleDraft] = useState(series.title)
  const [descriptionDraft, setDescriptionDraft] = useState(series.description ?? '')
  const [authorName, setAuthorName] = useState('')
  const [deleteTarget, setDeleteTarget] = useState<{ id: string; title: string } | null>(null)

  const isInitialStatsLoadRef = useRef(true)
  const loadStats = useCallback(async () => {
    const start = Date.now()
    const stats = await Promise.all(
      series.books.map(b =>
        fetch(`/api/series/${seriesId}/books/${b.id}`).then(r => r.ok ? r.json() : null),
      ),
    )
    const statsMap: Record<string, BookStats> = {}
    series.books.forEach((b, i) => {
      if (stats[i]?.stats) statsMap[b.id] = { ...stats[i].stats, coverPath: stats[i].coverPath ?? null }
    })
    if (isInitialStatsLoadRef.current) {
      await ensureMinDuration(start)
      isInitialStatsLoadRef.current = false
    }
    setBookStats(statsMap)
    setStatsLoaded(true)
  }, [seriesId, series.books])

  useEffect(() => { loadStats() }, [loadStats])
  useEffect(() => { setTitleDraft(series.title) }, [series.title])
  useEffect(() => { setDescriptionDraft(series.description ?? '') }, [series.description])
  useEffect(() => { setAuthorName(localStorage.getItem('loom-author-name') ?? '') }, [])

  async function handleTitleBlur() {
    const trimmed = titleDraft.trim()
    if (!trimmed || trimmed === series.title) return
    await fetch(`/api/series/${seriesId}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ title: trimmed }),
    })
    loadSeries()
  }

  async function handleDescriptionBlur() {
    if (descriptionDraft === (series.description ?? '')) return
    await fetch(`/api/series/${seriesId}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ description: descriptionDraft }),
    })
    loadSeries()
  }

  async function handleTagsChange(next: { genres?: string[]; keywords?: string[] }) {
    await fetch(`/api/series/${seriesId}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(next),
    })
    loadSeries()
  }

  async function handleDeleteBook(bookId: string) {
    await fetch(`/api/series/${seriesId}/books/${bookId}`, { method: 'DELETE' })
    setDeleteTarget(null)
    loadSeries()
  }

  return (
    <>
      <div className="max-w-3xl mx-auto px-8 py-8 relative">
        <a
          href={`/preview/series/${seriesId}`}
          target="_blank"
          rel="noopener noreferrer"
          className="absolute top-8 right-8 px-3 py-1.5 rounded text-xs bg-accent text-white font-medium hover:opacity-90 transition flex items-center gap-1.5"
        >
          <LuEye size={12} /> Preview
        </a>
        <div className="flex flex-col items-center mb-8">
          <input
            value={titleDraft}
            onChange={e => setTitleDraft(e.target.value)}
            onBlur={handleTitleBlur}
            className="w-full bg-transparent border-none outline-none text-center text-3xl font-bold uppercase text-ink tracking-wide focus:opacity-80 transition-opacity"
          />
          {authorName && (
            <p className="text-sm text-ink-faint mt-1">by {authorName}</p>
          )}
        </div>

        <div className="mb-8 flex flex-col gap-6">
          <div>
            <label className="text-xs uppercase tracking-widest text-ink-faint">Description</label>
            <textarea
              value={descriptionDraft}
              onChange={e => setDescriptionDraft(e.target.value)}
              onBlur={handleDescriptionBlur}
              placeholder="A short pitch readers will see on the series landing page…"
              rows={3}
              className="w-full mt-2 bg-surface-overlay border border-accent/15 rounded-lg px-3 py-2 text-sm text-ink placeholder:text-ink-faint outline-none focus:border-accent/50 resize-y"
            />
          </div>
          <SeriesTagsEditor
            genres={series.genres ?? []}
            keywords={series.keywords ?? []}
            onChange={handleTagsChange}
          />
        </div>
        {series.books.length === 0 ? (
          <p className="text-ink-faint text-sm text-center mt-16">No books yet. Add one from the outline.</p>
        ) : (
          <div className="flex flex-col gap-4">
            {series.books.map((book, idx) => {
              const stats = bookStats[book.id]
              return (
                <div
                  key={book.id}
                  onClick={() => router.push(`/author/${seriesId}/book/${book.id}`)}
                  className="flex gap-5 p-5 rounded-lg bg-accent/25 border border-accent/20 hover:border-accent/40 hover:scale-[1.01] transition-all duration-150 cursor-pointer"
                >
                  <div className="w-28 shrink-0 rounded overflow-hidden bg-surface-overlay border border-accent/10 flex items-center justify-center" style={{ minHeight: '9rem' }}>
                    {!statsLoaded ? (
                      <div className="w-full h-full bg-surface-muted animate-pulse" />
                    ) : stats?.coverPath ? (
                      <img src={stats.coverPath} alt="" className="w-full h-full object-cover" />
                    ) : (
                      <span className="text-xs text-ink-faint text-center px-1">No cover</span>
                    )}
                  </div>
                  <div className="flex-1 min-w-0 flex flex-col justify-between">
                    <div>
                      <div className="flex items-baseline gap-3 mb-4">
                        <span className="text-xs text-ink-faint uppercase tracking-widest shrink-0">Book {idx + 1}</span>
                        <span className="font-semibold text-ink text-lg leading-tight">{book.title}</span>
                        {!book.published && (
                          <span className="text-[10px] uppercase tracking-widest text-ink-faint border border-accent/30 rounded px-1.5 py-0.5 shrink-0">Draft</span>
                        )}
                      </div>
                      <div className="grid grid-cols-4 gap-3">
                        {[
                          { label: 'Chapter(s)', value: stats?.chapterCount ?? '—' },
                          { label: 'Word(s)', value: stats ? stats.wordCount.toLocaleString() : '—' },
                          { label: 'POV(s)', value: stats?.uniquePovs ?? '—' },
                          { label: 'Choice(s)', value: stats?.choiceCount ?? '—' },
                        ].map(({ label, value }) => (
                          <div key={label} className="bg-surface-overlay border border-accent/10 rounded-lg px-3 py-4 flex flex-col items-center gap-1">
                            {statsLoaded ? (
                              <span className="text-xl font-bold text-ink">{value}</span>
                            ) : (
                              <div className="h-7 w-10 bg-surface-muted rounded animate-pulse" />
                            )}
                            <span className="text-xs text-ink-faint uppercase tracking-widest">{label}</span>
                          </div>
                        ))}
                      </div>
                    </div>
                    <div className="flex justify-end gap-2 mt-3" onClick={e => e.stopPropagation()}>
                      <a
                        href={`/api/series/${seriesId}/books/${book.id}/export`}
                        download
                        className="px-3 py-1.5 rounded text-xs bg-surface-overlay border border-accent/20 text-ink-muted hover:text-ink transition flex items-center gap-1.5"
                      >
                        <LuDownload size={11} /> Export
                      </a>
                      <button
                        onClick={() => setDeleteTarget({ id: book.id, title: book.title })}
                        className="px-3 py-1.5 rounded text-xs bg-surface-overlay border border-choice-kill/40 text-choice-kill hover:opacity-80 transition"
                      >
                        Delete
                      </button>
                    </div>
                  </div>
                </div>
              )
            })}
          </div>
        )}
      </div>

      {deleteTarget && (
        <div
          className="fixed inset-0 bg-black/60 flex items-start justify-center z-50"
          style={{ paddingTop: 'calc(60px + 10vh)', paddingLeft: '14rem' }}
          onClick={() => setDeleteTarget(null)}
        >
          <div
            className="bg-surface-raised border border-accent/20 rounded-xl p-8 max-w-2xl w-full mx-8 shadow-2xl relative"
            onClick={e => e.stopPropagation()}
          >
            <button
              onClick={() => setDeleteTarget(null)}
              className="absolute top-4 right-4 text-ink-faint hover:text-ink text-lg leading-none"
            >
              ✕
            </button>
            <h2 className="text-base font-bold text-ink mb-3 pr-6">
              Are you sure you want to delete "{deleteTarget.title}"?
            </h2>
            <p className="text-sm text-ink-muted mb-6 leading-relaxed italic">
              Deleting this book is permanent and cannot be undone. All of its chapters, written content,
              and choices will be removed. Any story branches in later books that depended on choices
              made here will fall back to their default text.
            </p>
            <div className="flex gap-3 justify-end">
              <button
                onClick={() => setDeleteTarget(null)}
                className="px-4 py-2 rounded-lg text-ink-muted text-sm hover:text-ink transition"
              >
                Cancel
              </button>
              <button
                onClick={() => handleDeleteBook(deleteTarget.id)}
                className="px-4 py-2 rounded-lg bg-choice-kill text-white text-sm font-semibold hover:opacity-90 transition"
              >
                Delete
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  )
}
