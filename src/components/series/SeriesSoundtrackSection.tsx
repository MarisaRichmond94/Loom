'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { LuMusic, LuExternalLink } from 'react-icons/lu'
import PinnedAudio from '@/components/PinnedAudio'
import { pinLabel } from '@/lib/pinLabel'
import SeriesSoundtrackSkeleton from './SeriesSoundtrackSkeleton'

type SeriesSoundtrack = {
  id: string
  title: string | null
  audioPath: string
  pinStart: number | null
  pinEnd: number | null
  chapterId: string
  chapterTitle: string
  chapterOrder: number
  bookId: string
  bookTitle: string
  bookOrder: number
  hasAlbumArt: boolean
}

// The series page's Soundtrack tab (LOOM-146-ish) — every soundtrack block
// across every book, in reading order. The book page's own tab already
// answers "what plays in THIS book"; this one answers "what plays across the
// whole series", grouped by book so the reading order stays legible.
//
// Read-only: album art is uploaded from the book page, where the block
// actually lives. Duplicating that control here would be a second place to
// manage the same file with no second reason to.
export default function SeriesSoundtrackSection({ seriesId }: { seriesId: string }) {
  const router = useRouter()
  const [soundtracks, setSoundtracks] = useState<SeriesSoundtrack[] | null>(null)

  useEffect(() => {
    let cancelled = false
    fetch(`/api/series/${seriesId}/soundtracks`)
      .then(res => res.ok ? res.json() : [])
      .then(data => { if (!cancelled) setSoundtracks(data) })
    return () => { cancelled = true }
  }, [seriesId])

  if (soundtracks === null) {
    return <SeriesSoundtrackSkeleton />
  }

  if (soundtracks.length === 0) {
    return (
      <div className="flex items-center justify-center rounded-xl border-2 border-dashed border-accent/20" style={{ height: 120 }}>
        <p className="text-sm text-ink-faint italic text-center px-8">
          No soundtracks yet. Add a soundtrack block in any chapter to see it here.
        </p>
      </div>
    )
  }

  const byBook = new Map<string, { bookTitle: string; bookOrder: number; tracks: SeriesSoundtrack[] }>()
  for (const s of soundtracks) {
    const entry = byBook.get(s.bookId) ?? { bookTitle: s.bookTitle, bookOrder: s.bookOrder, tracks: [] }
    entry.tracks.push(s)
    byBook.set(s.bookId, entry)
  }
  const books = [...byBook.values()].sort((a, b) => a.bookOrder - b.bookOrder)

  return (
    <div className="flex flex-col gap-6">
      {books.map(({ bookTitle, tracks }) => (
        <div key={bookTitle} className="flex flex-col gap-2">
          <p className="text-xs uppercase tracking-widest text-ink-faint">{bookTitle}</p>
          {tracks.map((s, idx) => {
            const label = pinLabel(s.pinStart, s.pinEnd)
            const chapterDisplay = s.chapterTitle?.trim() || `Chapter ${s.chapterOrder}`
            const artUrl = s.hasAlbumArt ? `/music/${s.id}-art.jpg` : null
            return (
              <div key={s.id} className="px-4 py-3 rounded-lg bg-surface-raised border border-accent/10">
                <div className="flex items-center gap-3">
                  <span className="text-xs text-ink-faint shrink-0 w-6 text-right">{idx + 1}</span>
                  <div className="shrink-0 w-10 h-10 rounded overflow-hidden flex items-center justify-center border border-accent/10 bg-surface-overlay">
                    {artUrl
                      ? <img src={artUrl} alt="" className="w-full h-full object-cover" />
                      : <LuMusic size={14} className="text-accent" />}
                  </div>
                  <div className="shrink-0 w-[40%] pr-3">
                    <p className="text-sm text-ink truncate">{s.title?.trim() || '(untitled)'}</p>
                    <button
                      onClick={() => router.push(`/author/${seriesId}/chapter/${s.chapterId}`)}
                      title={`Go to ${chapterDisplay}`}
                      className="group/chapter block w-full text-left truncate text-xs text-ink-faint italic hover:text-accent transition"
                    >
                      {chapterDisplay}
                      <LuExternalLink size={10} className="inline-block ml-1 mb-px opacity-0 group-hover/chapter:opacity-100 transition" />
                    </button>
                  </div>
                  <PinnedAudio
                    src={s.audioPath}
                    pinStart={s.pinStart}
                    pinEnd={s.pinEnd}
                    className="flex-1 min-w-0"
                  />
                </div>
                {label && (
                  <p className="text-xs text-ink-faint italic mt-2 pl-[3.75rem]">{label}</p>
                )}
              </div>
            )
          })}
        </div>
      ))}
    </div>
  )
}
