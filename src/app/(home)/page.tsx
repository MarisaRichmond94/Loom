'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import Image from 'next/image'
import { LuBookOpen } from 'react-icons/lu'

type ExploreSeries = {
  id: string
  title: string
  description: string
  genres: string[]
  keywords: string[]
  heroCoverPath: string | null
  publishedBookCount: number
  totalBookCount: number
}

// Reader-facing landing. Lists every series with at least one published
// book; each card links to the existing /preview/series/[seriesId] landing
// where the reader can read more and start a session.
export default function ExplorePage() {
  const [series, setSeries] = useState<ExploreSeries[] | null>(null)

  useEffect(() => {
    fetch('/api/explore')
      .then(r => r.ok ? r.json() : [])
      .then(setSeries)
      .catch(() => setSeries([]))
  }, [])

  if (series == null) {
    return (
      <div className="flex-1 flex items-center justify-center">
        <p className="text-ink-faint text-sm">Loading…</p>
      </div>
    )
  }

  return (
    <div className="px-8 py-10">
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-ink">Explore</h1>
        <p className="text-sm text-ink-muted mt-1">
          Find your next great read
        </p>
      </div>

      {series.length === 0 ? (
        <div className="rounded-xl border-2 border-dashed border-accent/20 px-8 py-16 text-center">
          <p className="text-sm text-ink-faint italic">
            Nothing to read yet. Publish a book from the Write view to see it here.
          </p>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {series.map(s => (
            <Link
              key={s.id}
              href={`/preview/series/${s.id}`}
              className="group flex gap-4 p-4 rounded-lg bg-surface-raised border border-accent/10 hover:border-accent/40 transition"
            >
              <div className="relative w-40 shrink-0 rounded overflow-hidden bg-surface-overlay border border-accent/10 aspect-[2/3] flex items-center justify-center">
                {s.heroCoverPath
                  ? <Image src={s.heroCoverPath} alt="" fill sizes="160px" className="object-cover" />
                  : <LuBookOpen size={32} className="text-ink-faint" />}
              </div>
              <div className="flex-1 min-w-0 flex flex-col">
                <p className="font-semibold text-ink truncate group-hover:text-accent transition">{s.title}</p>
                <p className="text-[11px] uppercase tracking-widest text-ink-faint mt-0.5">
                  {s.totalBookCount} book(s)
                  {s.publishedBookCount < s.totalBookCount && (
                    <> ({s.publishedBookCount} published)</>
                  )}
                </p>
                {s.description && (
                  // Scroll overflow so readers can sample the whole blurb
                  // without leaving the card. Gradient fade at the bottom
                  // hints "more below" the same way the book landing does.
                  <div className="relative mt-2">
                    <div className="overflow-y-auto pr-1 max-h-[140px]">
                      <p className="text-xs text-ink-muted leading-relaxed">{s.description}</p>
                    </div>
                    <div className="pointer-events-none absolute inset-x-0 bottom-0 h-8 bg-gradient-to-t from-surface-raised to-transparent" />
                  </div>
                )}
                {(s.genres.length > 0 || s.keywords.length > 0) && (
                  <div className="mt-auto pt-2 flex flex-col gap-1.5">
                    {s.genres.length > 0 && (
                      <div className="flex flex-wrap gap-1">
                        {s.genres.map(g => (
                          <span key={g} className="text-[10px] px-2 py-0.5 rounded-full bg-accent text-white">{g}</span>
                        ))}
                      </div>
                    )}
                    {s.keywords.length > 0 && (
                      <div className="flex flex-wrap gap-1">
                        {s.keywords.map(k => (
                          <span key={k} className="text-[10px] px-2 py-0.5 rounded-full bg-accent/15 text-ink border border-accent/20">{k}</span>
                        ))}
                      </div>
                    )}
                  </div>
                )}
              </div>
            </Link>
          ))}
        </div>
      )}
    </div>
  )
}
