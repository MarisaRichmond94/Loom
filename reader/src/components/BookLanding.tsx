'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import Link from 'next/link'
import { LuArrowLeft, LuArrowRight, LuHeadphones } from 'react-icons/lu'
import { useReaderTheme } from '@/components/useReaderTheme'
import ReaderHeader from '@/components/ReaderHeader'
import TrackRow from '@/components/TrackRow'
import { media } from '@/lib/basePath'

/**
 * The book landing (LOOM-131) — where "See more" goes, and where the blurb
 * lives in full.
 *
 * Chapters are labelled by their CANON number, which is the same one the canon
 * export wrote and WriteAI ingested. It is NOT Loom's Chapter.order: the walk
 * skips gated chapters, so the two diverge.
 */

export type BookCharacter = {
  id: string
  name: string
  age: number | null
  photoPath: string | null
  deceased: boolean
}

export type BookTrack = {
  id: string
  audioPath: string
  title: string | null
  chapter: string
}

export type BookChapter = {
  id: string
  title: string
  label: string
  numbered: boolean
  narrated: boolean
}

/**
 * A scroll box that fades its bottom edge while there is more to see.
 *
 * The fade is the only cue that the list continues — a clipped row alone reads
 * as a layout bug rather than an invitation to scroll. It disappears at the
 * end, so "no fade" reliably means "nothing further down".
 */
function Scrollable({
  children,
  className = '',
}: {
  children: React.ReactNode
  className?: string
}) {
  const ref = useRef<HTMLDivElement>(null)
  const [atBottom, setAtBottom] = useState(true)
  const [overflows, setOverflows] = useState(false)

  const measure = useCallback(() => {
    const el = ref.current
    if (!el) return
    const canScroll = el.scrollHeight > el.clientHeight + 1
    setOverflows(canScroll)
    setAtBottom(!canScroll || el.scrollTop + el.clientHeight >= el.scrollHeight - 2)
  }, [])

  useEffect(() => {
    measure()
    const el = ref.current
    if (!el) return
    // Content and container can both change size after mount — a cover image
    // finishing its load re-flows the row.
    const ro = new ResizeObserver(measure)
    ro.observe(el)
    return () => ro.disconnect()
  }, [measure])

  return (
    <div className="relative min-h-0 flex-1">
      <div ref={ref} onScroll={measure} className={`h-full overflow-y-auto ${className}`}>
        {children}
      </div>
      {overflows && !atBottom && (
        <div
          aria-hidden
          className="pointer-events-none absolute bottom-0 left-0 right-0 h-12 bg-gradient-to-t from-surface-base to-transparent"
        />
      )}
    </div>
  )
}

export default function BookLanding({
  bookId,
  seriesTitle,
  book,
  chapters,
  currentChapterId = null,
  characters,
  tracks,
}: {
  bookId: string
  seriesTitle: string
  book: { title: string; synopsis: string; coverPath: string | null; order: number }
  chapters: BookChapter[]
  /** The chapter this reader left off in, if any (LOOM-133). */
  currentChapterId?: string | null
  characters: BookCharacter[]
  tracks: BookTrack[]
}) {
  const { lightMode, toggleLightMode, mounted } = useReaderTheme()

  return (
    <div className="min-h-screen bg-surface-base flex flex-col">
      <ReaderHeader lightMode={lightMode} onToggleLightMode={toggleLightMode} mounted={mounted} />

      <main className="flex-1">
        {/* Full width, matching Loom's own book preview — that page has no
            max-width either. The series landing DOES cap at max-w-4xl, and
            deliberately: a list of blurbs wants a readable measure, where a
            book page is a spread. */}
        <div className="px-8 pt-8 pb-12">
          <Link
            href="/"
            className="inline-flex items-center gap-1.5 text-xs text-ink-muted hover:text-ink transition"
          >
            <LuArrowLeft size={12} /> {seriesTitle}
          </Link>

          {/* h-80 on BOTH columns is what makes the blurb end level with the
              cover. The cover sets the height and takes whatever width its own
              aspect ratio needs — `w-auto` + `object-contain` rather than a
              fixed box, so a cover is shown whole instead of cropped to fit. */}
          <div className="flex gap-8 mt-6 h-80">
            <div className="h-full shrink-0 flex items-center">
              {book.coverPath ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={media(book.coverPath)}
                  alt=""
                  className="h-full w-auto object-contain rounded-lg border border-accent/10"
                />
              ) : (
                <div className="h-full aspect-[2/3] rounded-lg bg-surface-overlay border border-accent/10 flex items-center justify-center">
                  <span className="text-xs text-ink-faint px-2 text-center">No cover</span>
                </div>
              )}
            </div>

            <div className="flex-1 min-w-0 flex flex-col h-full">
              <span className="text-[11px] uppercase tracking-widest text-ink-faint">
                Book {book.order}
              </span>
              <h1 className="text-3xl font-bold text-ink mt-1 leading-tight">{book.title}</h1>

              <div className="flex items-center gap-4 mt-3 text-xs text-ink-muted">
                <span>{chapters.length} chapters</span>
                {chapters.some(c => c.narrated) && (
                  <span className="flex items-center gap-1.5">
                    <LuHeadphones size={12} />
                    {chapters.filter(c => c.narrated).length} narrated
                  </span>
                )}
              </div>

              {/* Disabled until reading progress exists (LOOM-133). */}
              <button
                disabled
                title="Reading is not available yet."
                className="mt-4 mb-4 self-start px-5 py-2.5 rounded-lg bg-accent text-white text-sm font-medium opacity-40 cursor-not-allowed flex items-center gap-2"
              >
                Start reading <LuArrowRight size={14} />
              </button>

              {book.synopsis && (
                <Scrollable className="pr-2">
                  <p className="text-sm text-ink-muted leading-relaxed whitespace-pre-line">
                    {book.synopsis}
                  </p>
                </Scrollable>
              )}
            </div>
          </div>

          <div className="mt-10">
            <p className="text-[11px] uppercase tracking-widest text-ink-faint mb-3">
              Chapters ({chapters.length})
            </p>
            {/* Capped so the list does not push everything else off the page —
                98 chapters is a scroll, not a section. */}
            <div className="flex flex-col h-64">
              <Scrollable>
                <div className="flex flex-col gap-1.5 pr-1">
                  {chapters.map(ch => (
                    <Link
                      key={ch.id}
                      href={`/book/${bookId}/chapter/${ch.id}${ch.id === currentChapterId ? '?resume=1' : ''}`}
                      className={`flex items-center gap-3 px-4 py-2.5 rounded bg-surface-raised border transition-colors text-sm ${
                        // Where they left off (LOOM-133). A marker on the row
                        // rather than a separate Resume button: the list is
                        // already the place they look, and a second control
                        // would compete with the one at the top of the page.
                        ch.id === currentChapterId
                          ? 'border-accent/50'
                          : 'border-accent/10 hover:border-accent'
                      }`}
                    >
                      {/* One label, not two. `title` for a numbered chapter is
                          already "Chapter 7", so showing the number beside it
                          repeated the same fact twice. */}
                      <span className="text-ink flex-1 min-w-0 truncate">
                        {ch.numbered ? `Chapter ${ch.label}` : ch.label}
                      </span>
                      {ch.id === currentChapterId && (
                        <span className="shrink-0 text-[10px] uppercase tracking-widest text-accent">
                          You’re here
                        </span>
                      )}
                      {ch.narrated && (
                        <LuHeadphones
                          size={12}
                          className="text-ink-faint shrink-0"
                          title="Narrated"
                        />
                      )}
                    </Link>
                  ))}
                </div>
              </Scrollable>
            </div>
          </div>

          {characters.length > 0 && (
            <div className="mt-10">
              <p className="text-[11px] uppercase tracking-widest text-ink-faint mb-3">
                Characters ({characters.length})
              </p>
              {/* Only the cast a reader has met by the END of this book — the
                  projection is per book, so a later arrival is absent rather
                  than hidden, and a death is not revealed early. */}
              <div className="flex flex-wrap gap-3">
                {characters.map(c => (
                  <div
                    key={c.id}
                    className="w-32 p-3 rounded-lg bg-surface-raised border border-accent/10 flex flex-col items-center text-center"
                  >
                    <div className="w-16 h-16 rounded-full overflow-hidden bg-surface-overlay border border-accent/15 flex items-center justify-center">
                      {c.photoPath ? (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img src={media(c.photoPath)} alt="" className="w-full h-full object-cover" />
                      ) : (
                        <span className="text-sm text-ink-faint">{c.name.charAt(0)}</span>
                      )}
                    </div>
                    <p className="text-xs text-ink mt-2 leading-tight">{c.name}</p>
                    {c.deceased ? (
                      <p className="text-[10px] uppercase tracking-widest text-ink-faint italic mt-0.5">
                        Deceased
                      </p>
                    ) : c.age !== null ? (
                      <p className="text-[10px] text-ink-faint mt-0.5">Age {c.age}</p>
                    ) : null}
                  </div>
                ))}
              </div>
            </div>
          )}

          {tracks.length > 0 && (
            <div className="mt-10">
              <p className="text-[11px] uppercase tracking-widest text-ink-faint mb-3">
                Soundtrack ({tracks.length})
              </p>
              <div className="flex flex-col gap-2">
                {tracks.map((t, i) => (
                  <TrackRow
                    key={t.id}
                    index={i + 1}
                    title={t.title ?? 'Untitled'}
                    chapter={t.chapter}
                    audioPath={t.audioPath}
                    artPath={`/music/${t.id}-art.jpg`}
                  />
                ))}
              </div>
            </div>
          )}
        </div>
      </main>
    </div>
  )
}
