'use client'

import { useEffect, useRef, useState } from 'react'
import Link from 'next/link'
import { LuArrowLeft, LuArrowRight } from 'react-icons/lu'
import { useReaderTheme } from '@/components/useReaderTheme'
import ReaderHeader from '@/components/ReaderHeader'
import TrackRow from '@/components/TrackRow'
import NarrationBar from '@/components/NarrationBar'

/**
 * The reading surface (LOOM-131) — matched to Loom's own read view, minus the
 * author's Configure and Copy controls.
 *
 * Prose arrives as HTML, already rendered and template-resolved by publish, so
 * there is no TipTap here, no story state, and no conditions to evaluate. That
 * is the point of flattening at publish: the reader displays, it does not
 * compute.
 */

export type ProseBlock = {
  id: string
  type: string
  content: string
  title: string | null
}

export type ChapterNav = { id: string; label: string; numbered: boolean } | null

export default function ChapterView({
  bookId,
  bookTitle,
  heading,
  pov,
  date,
  blocks,
  prev,
  next,
  narration,
}: {
  bookId: string
  bookTitle: string
  heading: string
  pov: string | null
  date: string | null
  blocks: ProseBlock[]
  prev: ChapterNav
  next: ChapterNav
  narration: { audioPath: string; durationMs: number } | null
}) {
  const { lightMode, toggleLightMode, mounted } = useReaderTheme()
  const proseRef = useRef<HTMLDivElement>(null)
  const [hovered, setHovered] = useState<{ name: string; x: number; y: number } | null>(null)
  const [progress, setProgress] = useState(0)

  // Character mentions are `<span class="character-ref" data-character-name>`
  // inside HTML publish produced, so there is no React element to hang a
  // handler on. One delegated listener beats re-parsing the HTML into
  // components purely to attach a tooltip.
  useEffect(() => {
    const el = proseRef.current
    if (!el) return
    const over = (e: Event) => {
      const t = (e.target as HTMLElement).closest('.character-ref') as HTMLElement | null
      if (!t?.dataset.characterName) return
      const r = t.getBoundingClientRect()
      setHovered({ name: t.dataset.characterName, x: r.left + r.width / 2, y: r.top })
    }
    const out = (e: Event) => {
      if ((e.target as HTMLElement).closest('.character-ref')) setHovered(null)
    }
    el.addEventListener('mouseover', over)
    el.addEventListener('mouseout', out)
    return () => {
      el.removeEventListener('mouseover', over)
      el.removeEventListener('mouseout', out)
    }
  }, [blocks])

  // Reading progress for the footer rail. Cheap: scroll position against
  // document height, no per-paragraph observers.
  useEffect(() => {
    const onScroll = () => {
      const max = document.documentElement.scrollHeight - window.innerHeight
      setProgress(max > 0 ? Math.min(1, window.scrollY / max) : 0)
    }
    onScroll()
    window.addEventListener('scroll', onScroll, { passive: true })
    return () => window.removeEventListener('scroll', onScroll)
  }, [])

  return (
    <div className="min-h-screen bg-surface-base flex flex-col">
      <ReaderHeader lightMode={lightMode} onToggleLightMode={toggleLightMode} mounted={mounted} />

      {/* Full width, like Loom's read view — prose runs the page rather than
          sitting in a column. Light mode is already on <body>. */}
      <main className="flex-1 px-8 pt-10 pb-24">
        <h1 className="text-4xl font-bold tracking-wide uppercase text-ink text-center">
          {heading}
        </h1>
        {pov && (
          <p className="text-center mt-2">
            <span className="character-ref">{pov}</span>
          </p>
        )}

        {narration && (
          <div className="mt-6 flex justify-center">
            <NarrationBar audioPath={narration.audioPath} />
          </div>
        )}

        {date && <p className="text-sm text-ink-muted mt-8">{date}</p>}

        <div ref={proseRef} className="mt-4 flex flex-col gap-4">
          {blocks.map(b =>
            b.type === 'soundtrack' ? (
              <TrackRow
                key={b.id}
                index={0}
                title={b.title ?? 'Untitled'}
                chapter=""
                audioPath={b.content}
                artPath={`/music/${b.id}-art.jpg`}
              />
            ) : (
              // Publish produced this HTML from the author's own TipTap doc. It
              // is not user input, and the reader tier has no write path it
              // could have come through.
              <div
                key={b.id}
                id={`block-${b.id}`}
                className="reader-prose text-ink leading-relaxed"
                dangerouslySetInnerHTML={{ __html: b.content }}
              />
            ),
          )}
        </div>
      </main>

      {/* Sticky footer rail, like Loom's: progress on the left, the next
          chapter on the right. chrome-dark so it stays dark in light mode. */}
      <div className="chrome-dark sticky bottom-0 bg-surface-raised border-t border-accent/10">
        <div className="h-0.5 bg-surface-muted">
          <div className="h-full bg-accent transition-[width] duration-150" style={{ width: `${progress * 100}%` }} />
        </div>
        <div className="px-8 py-2 flex items-center justify-between text-xs">
          {prev ? (
            <Link href={`/book/${bookId}/chapter/${prev.id}`} className="flex items-center gap-1.5 text-ink-muted hover:text-ink transition">
              <LuArrowLeft size={12} /> {prev.numbered ? `Chapter ${prev.label}` : prev.label}
            </Link>
          ) : (
            <Link href={`/book/${bookId}`} className="flex items-center gap-1.5 text-ink-muted hover:text-ink transition">
              <LuArrowLeft size={12} /> {bookTitle}
            </Link>
          )}
          {next && (
            <Link href={`/book/${bookId}/chapter/${next.id}`} className="flex items-center gap-1.5 text-ink-muted hover:text-ink transition">
              {next.numbered ? `Chapter ${next.label}` : next.label} <LuArrowRight size={12} />
            </Link>
          )}
        </div>
      </div>

      {hovered && (
        <div
          className="chrome-dark fixed z-50 -translate-x-1/2 -translate-y-full pointer-events-none px-2.5 py-1 rounded bg-surface-raised border border-accent/20 text-xs text-ink shadow-lg"
          style={{ left: hovered.x, top: hovered.y - 6 }}
        >
          {hovered.name}
        </div>
      )}
    </div>
  )
}
