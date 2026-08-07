'use client'

import Link from 'next/link'
import { LuArrowRight } from 'react-icons/lu'
import { useReaderTheme } from '@/components/useReaderTheme'
import ReaderHeader from '@/components/ReaderHeader'

/**
 * The series landing (LOOM-131) — forked from Loom's
 * `(home)/preview/series/[seriesId]`, which is the design the author already
 * built and reviews against.
 *
 * Forked rather than shared because the two diverge on purpose: the author's
 * copy reads dev.db and shows drafts and branches; this one reads only the
 * published snapshot. Sharing would mean `isAuthor &&` threaded through both.
 */

export type LandingBook = {
  id: string
  title: string
  synopsis: string
  coverPath: string | null
  order: number
  published: boolean
}

export type LandingSeries = {
  title: string
  description: string
  authorName: string
  genres: string[]
  keywords: string[]
}

/** A book this reader has already started (LOOM-133). */
export type ContinueCard = {
  bookId: string
  title: string
  coverPath: string | null
  chapterId: string
  chapterLabel: string
  chapterNumbered: boolean
  offset: number
  notice: string | null
  updatedAt: string
}

/** Where the primary button sends them, resolved server-side through the ladder. */
export type ResumeTarget = {
  href: string
  label: string
} | null

export default function SeriesLanding({
  series,
  books,
  resume,
  continueReading,
}: {
  series: LandingSeries
  books: LandingBook[]
  resume: ResumeTarget
  continueReading: ContinueCard[]
}) {
  const { lightMode, toggleLightMode, mounted } = useReaderTheme()

  return (
    <div className="min-h-screen bg-surface-base flex flex-col">
      <ReaderHeader lightMode={lightMode} onToggleLightMode={toggleLightMode} mounted={mounted} />

      {/* Light mode is scoped to the page body, never the header — the same
          rule Loom and WriteAI both keep. */}
      <main className="flex-1">
        <div className="max-w-4xl mx-auto px-6 pt-12 pb-10">
          <div className="flex items-start justify-between gap-6">
            <div className="min-w-0">
              <h1 className="text-4xl font-bold tracking-wide uppercase text-ink leading-tight">
                {series.title}
              </h1>
              {series.authorName && (
                <p className="text-sm text-ink-muted mt-2">by {series.authorName}</p>
              )}
            </div>
            {/* Live as of LOOM-133. The destination is resolved on the server
                through the resume ladder, so a position pointing at a chapter
                that was since unpublished lands somewhere real rather than
                404-ing the one button on the page.

                Still disabled when there is genuinely nothing to open — a
                series with no published books — rather than hidden, so the
                page keeps its shape. */}
            {resume ? (
              <Link
                href={resume.href}
                className="shrink-0 px-5 py-2.5 rounded-lg bg-accent text-white text-sm font-medium hover:brightness-110 transition flex items-center gap-2"
              >
                {resume.label} <LuArrowRight size={14} />
              </Link>
            ) : (
              <button
                disabled
                title="Nothing has been published yet."
                className="shrink-0 px-5 py-2.5 rounded-lg bg-accent text-white text-sm font-medium opacity-40 cursor-not-allowed flex items-center gap-2"
              >
                Start reading <LuArrowRight size={14} />
              </button>
            )}
          </div>

          {series.description && (
            <p className="text-ink mt-6 leading-relaxed">{series.description}</p>
          )}

          {series.genres.length > 0 && (
            <div className="flex items-center gap-2 mt-8 flex-wrap">
              <span className="text-[11px] uppercase tracking-widest text-ink-faint shrink-0">
                Genre(s)
              </span>
              {series.genres.map(g => (
                <span key={g} className="text-xs rounded-full px-3 py-1 bg-accent text-white">
                  {g}
                </span>
              ))}
            </div>
          )}
          {series.keywords.length > 0 && (
            <div className="flex items-center gap-2 mt-2 flex-wrap">
              <span className="text-[11px] uppercase tracking-widest text-ink-faint shrink-0">
                Keyword(s)
              </span>
              {series.keywords.map(k => (
                <span key={k} className="text-xs rounded-full px-3 py-1 bg-accent/15 text-ink border border-accent/20">
                  {k}
                </span>
              ))}
            </div>
          )}
        </div>

        {/* Continue reading (LOOM-133). Server-driven — the position lives in
            reader.db, so it follows the person to whatever device they pick up
            next rather than living in one browser's localStorage.

            Above the catalog because it answers the question someone returning
            to the site actually has. Absent entirely for a reader who has not
            started anything: an empty rail is furniture. */}
        {continueReading.length > 0 && (
          <div className="border-t border-accent/10">
            <div className="max-w-4xl mx-auto px-6 py-8">
              <p className="text-[11px] uppercase tracking-widest text-ink-faint mb-4">
                Continue reading
              </p>
              <div className="flex flex-col gap-3">
                {continueReading.map(c => (
                  <Link
                    key={c.bookId}
                    href={`/book/${c.bookId}/chapter/${c.chapterId}?resume=1${c.notice ? '&moved=previous' : ''}`}
                    className="flex items-center gap-4 p-4 rounded-lg bg-surface-raised border border-accent/10 hover:border-accent/40 transition-colors group/continue"
                  >
                    <div className="w-10 h-15 shrink-0 rounded overflow-hidden bg-surface-overlay border border-accent/15">
                      {c.coverPath && (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img src={c.coverPath} alt="" className="w-full h-full object-cover" />
                      )}
                    </div>
                    <div className="min-w-0 flex-1">
                      <p className="text-sm text-ink truncate">{c.title}</p>
                      <p className="text-xs text-ink-faint">
                        {c.chapterNumbered ? `Chapter ${c.chapterLabel}` : c.chapterLabel}
                        {c.notice && ' · revised since you were here'}
                      </p>
                    </div>
                    <LuArrowRight
                      size={14}
                      className="shrink-0 text-ink-faint group-hover/continue:text-accent transition-colors"
                    />
                  </Link>
                ))}
              </div>
            </div>
          </div>
        )}

        <div className="border-t border-accent/10">
          <div className="max-w-4xl mx-auto px-6 py-8">
            <p className="text-[11px] uppercase tracking-widest text-ink-faint mb-4">
              Books in this series
            </p>
            <div className="flex flex-col gap-4">
              {books.map(book => {
                const card = (
                <div
                  className={`flex gap-5 p-5 rounded-lg bg-surface-raised border transition-all duration-150 ${
                    // Motion and the accent border are affordances, so they are
                    // only on cards that actually go somewhere. A draft that
                    // lifts and glows on hover is promising a click it cannot
                    // honour.
                    book.published
                      ? 'border-accent/10 hover:border-accent hover:scale-[1.01] cursor-pointer'
                      : 'border-accent/10'
                  }`}
                >
                  <div
                    className={`relative w-40 shrink-0 rounded overflow-hidden bg-surface-overlay border border-accent/10 aspect-[2/3] flex items-center justify-center ${
                      book.published ? '' : 'opacity-40'
                    }`}
                  >
                    {book.coverPath ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img src={book.coverPath} alt="" className="w-full h-full object-cover" />
                    ) : (
                      <span className="text-xs text-ink-faint px-2 text-center">No cover</span>
                    )}
                  </div>

                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="text-[11px] uppercase tracking-widest text-ink-faint">
                        Book {book.order}
                      </span>
                      {!book.published && (
                        <span className="text-[10px] uppercase tracking-widest text-ink-faint border border-accent/25 rounded px-1.5 py-0.5">
                          Coming soon
                        </span>
                      )}
                    </div>
                    <p className={`font-semibold text-lg mt-1 leading-tight ${book.published ? 'text-ink' : 'text-ink-muted'}`}>
                      {book.title}
                    </p>

                    {book.published && book.synopsis && (
                      <>
                        <p className="text-sm text-ink-muted mt-2 leading-relaxed line-clamp-8">
                          {book.synopsis}
                        </p>
                        {/* The clamp hides the rest of the blurb; this says so
                            and points at the book page, where it is whole. */}
                        <div className="mt-2 text-right">
                          <span className="text-xs text-accent font-medium group-hover/card:underline">
                            See more
                          </span>
                        </div>
                      </>
                    )}

                    {!book.published && (
                      // Blurred LOREM, never the real blurb — matching Loom's
                      // own landing. The unpublished synopsis is not in this
                      // app's database at all, so there is nothing here to
                      // un-blur, copy, or read out of a network response.
                      <p
                        aria-hidden
                        className="text-sm text-ink-muted mt-2 line-clamp-8 leading-relaxed blur-sm select-none pointer-events-none"
                      >
                        Lorem ipsum dolor sit amet, consectetur adipiscing elit.
                        Sed do eiusmod tempor incididunt ut labore et dolore magna
                        aliqua. Ut enim ad minim veniam, quis nostrud exercitation
                        ullamco laboris nisi ut aliquip ex ea commodo consequat.
                        Duis aute irure dolor in reprehenderit in voluptate velit
                        esse cillum dolore eu fugiat nulla pariatur. Excepteur sint
                        occaecat cupidatat non proident, sunt in culpa qui officia
                        deserunt mollit anim id est laborum. Curabitur pretium
                        tincidunt lacus, nulla gravida orci a odio. Nullam varius,
                        turpis et commodo pharetra, est eros bibendum elit.
                      </p>
                    )}
                  </div>
                </div>
                )
                // Only a published book has a page to open. A draft renders the
                // same card without a link, so nothing invites a dead click.
                return book.published ? (
                  <Link key={book.id} href={`/book/${book.id}`} className="group/card block">
                    {card}
                  </Link>
                ) : (
                  <div key={book.id}>{card}</div>
                )
              })}
            </div>
          </div>
        </div>
      </main>
    </div>
  )
}
