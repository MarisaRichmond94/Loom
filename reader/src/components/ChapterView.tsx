'use client'

import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import Link from 'next/link'
import { LuArrowLeft, LuArrowRight, LuInfo, LuX } from 'react-icons/lu'
import { useReaderTheme } from '@/components/useReaderTheme'
import ReaderHeader from '@/components/ReaderHeader'
import TrackRow from '@/components/TrackRow'
import NarrationBar from '@/components/NarrationBar'
import { PROSE_CLASS } from '@/shared/proseClass'
import { useProgressRecorder } from '@/components/useProgressRecorder'
import CommentThread from '@/components/CommentThread'
import type { CommentView } from '@/lib/comments'
import type { BookCharacter } from '@/components/BookLanding'

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

/** The hovered mention's character, plus where to put the card. */
type HoverCard = { c: BookCharacter; x: number; y: number }

export default function ChapterView({
  bookId,
  chapterId,
  bookTitle,
  heading,
  pov,
  date,
  blocks,
  prev,
  next,
  narration,
  characters,
  povCharacterId,
  resumeOffset = 0,
  resumeNotice = null,
  comments: initialComments = null,
}: {
  bookId: string
  chapterId: string
  bookTitle: string
  heading: string
  pov: string | null
  date: string | null
  blocks: ProseBlock[]
  prev: ChapterNav
  next: ChapterNav
  narration: {
    audioPath: string
    durationMs: number
    /** Per-token timings driving the word highlight; empty when unavailable. */
    timing: { word: string; timeMs: number }[]
    /** The blocks the recording speaks, in order — publish's list, not a guess. */
    blockIds: string[]
  } | null
  /** This book's cast, for the hover cards. Keyed by writerCharacterId. */
  characters: BookCharacter[]
  /** The POV character, resolved server-side so the byline can be hovered too. */
  povCharacterId: string | null
  /** Paragraph to restore to. 0 (or absent) means start at the top (LOOM-133). */
  resumeOffset?: number
  /** Set only when the resume ladder MOVED them, so we can say why. */
  resumeNotice?: string | null
  /** Null when the viewer has not finished the chapter (LOOM-134). */
  comments?: CommentView[] | null
}) {
  const { lightMode, toggleLightMode, mounted } = useReaderTheme()
  const hoverRootRef = useRef<HTMLDivElement>(null)
  const [hovered, setHovered] = useState<HoverCard | null>(null)
  const byId = new Map(characters.map(c => [c.id, c]))
  const [progress, setProgress] = useState(0)
  const [notice, setNotice] = useState<string | null>(resumeNotice)

  // Number every paragraph in document order, across all prose blocks, so the
  // recorder and the restore below agree on what "paragraph 12" means. Done
  // here rather than at publish time because the prose arrives as an HTML
  // string — there is no React element per paragraph to hang an index on.
  //
  // Runs before paint (layout effect) so a restore never lands on unnumbered
  // nodes and visibly jumps a frame later.
  useLayoutEffect(() => {
    const paras = document.querySelectorAll<HTMLElement>(`.${PROSE_CLASS.split(' ')[0]} p`)
    paras.forEach((p, i) => { p.dataset.para = String(i) })
  }, [blocks])

  // Put the reader back where they were. Only on an explicit resume — someone
  // who clicked a chapter link wants the top of that chapter, not to be thrown
  // into the middle of it.
  useLayoutEffect(() => {
    if (!resumeOffset) return
    // A finished chapter records `count` — one past the last index (LOOM-134's
    // gate signal) — so an exact lookup finds nothing and would silently drop
    // the reader at the top of a chapter they had just finished. Fall back to
    // the last paragraph, which is where they actually were.
    const paras = document.querySelectorAll<HTMLElement>('[data-para]')
    const target =
      document.querySelector<HTMLElement>(`[data-para="${resumeOffset}"]`)
      ?? (paras.length ? paras[paras.length - 1] : null)
    if (!target) return
    // Instant, not smooth: this is where the page STARTS, and animating to it
    // reads as the page moving on its own.
    window.scrollTo({ top: window.scrollY + target.getBoundingClientRect().top - 120 })
  }, [resumeOffset, blocks])

  // Comments (LOOM-134) are gated on the server at render time, so finishing
  // the chapter cannot reveal them on its own — the decision was already made.
  // Re-ask once the finished position has been written. The server still
  // decides; this only gives it a second chance to answer.
  const [comments, setComments] = useState<CommentView[] | null>(initialComments)

  useProgressRecorder(bookId, chapterId, true, () => {
    void fetch(`/api/comments?bookId=${bookId}&chapterId=${chapterId}`)
      .then(r => (r.ok ? r.json() : null))
      .then((d: { comments: CommentView[] } | null) => {
        if (d) setComments(d.comments)
      })
      .catch(() => {
        // A failed re-check leaves the gated line in place, which is the safe
        // side of this particular error.
      })
  })

  // Character mentions are `<span class="character-ref" data-character-name>`
  // inside HTML publish produced, so there is no React element to hang a
  // handler on. One delegated listener beats re-parsing the HTML into
  // components purely to attach a tooltip.
  //
  // Bound to a wrapper that also contains the POV BYLINE. It was on the prose
  // container alone, which is why the byline never produced a card — it sits
  // above the prose, outside that element.
  useEffect(() => {
    const el = hoverRootRef.current
    if (!el) return
    // One handler, set-or-clear. A separate mouseout listener left the card
    // stuck whenever the pointer went somewhere mouseout did not fire for;
    // deciding on every mouseover means the card cannot outlive the mention.
    const over = (e: Event) => {
      const t = (e.target as HTMLElement).closest('.character-ref') as HTMLElement | null
      if (!t) { setHovered(null); return }
      // Prefer the id: names are not identity, and two characters can share
      // one. Fall back to the name only when the mark predates ids.
      const c = (t.dataset.characterId && byId.get(t.dataset.characterId))
        || characters.find(x => x.name === t.dataset.characterName)
      if (!c) { setHovered(null); return }
      const r = t.getBoundingClientRect()
      setHovered({ c, x: r.left + r.width / 2, y: r.top })
    }
    const leave = () => setHovered(null)
    el.addEventListener('mouseover', over)
    el.addEventListener('mouseleave', leave)
    return () => {
      el.removeEventListener('mouseover', over)
      el.removeEventListener('mouseleave', leave)
    }
  }, [blocks, characters])

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
      {/* pb-2, deliberately tighter than Loom's read view (pb-8 at
          ReaderView.tsx:552). It started at pb-24 — padding sized for a FIXED
          footer floating over the text, which this one is not: the rail is
          sticky and in flow, so it already reserves its own height. Loom's
          value still read as a gap here because `prose` zeroes the last
          paragraph's bottom margin, so the padding is the whole distance
          between the last line and the rail rather than an addition to it. */}
      <main ref={hoverRootRef} className="flex-1 px-8 pt-10 pb-2">
        {/* Shown only when the resume ladder MOVED them (LOOM-133). A silent
            jump reads as a bug and invites the reader to think they lost their
            place; saying so plainly costs one line and removes the doubt.
            Dismissible, because it is news, not state. */}
        {notice && (
          <div className="mx-auto mb-8 max-w-2xl flex items-start gap-3 px-4 py-3 rounded-lg bg-surface-raised border border-accent/20">
            <LuInfo size={15} className="text-accent/80 shrink-0 mt-0.5" />
            <p className="flex-1 text-sm text-ink-muted leading-relaxed">{notice}</p>
            <button
              onClick={() => setNotice(null)}
              aria-label="Dismiss"
              className="shrink-0 p-1 rounded text-ink-faint hover:text-ink transition"
            >
              <LuX size={14} />
            </button>
          </div>
        )}

        <h1 className="text-4xl font-bold tracking-wide uppercase text-ink text-center">
          {heading}
        </h1>
        {pov && (
          <p className="text-center mt-2">
            {/* Carries the same mark and data as a mention in the prose, so the
                byline gets a card too — it is the same character. */}
            <span className="character-ref" data-character-id={povCharacterId ?? undefined} data-character-name={pov}>
              {pov}
            </span>
          </p>
        )}

        {narration && (
          <div className="mt-6 flex justify-center">
            <NarrationBar
              audioPath={narration.audioPath}
              durationMs={narration.durationMs}
              timing={narration.timing}
              blockIds={narration.blockIds}
            />
          </div>
        )}

        {date && <p className="text-sm text-ink-muted mt-8">{date}</p>}

        <div className="mt-4 flex flex-col gap-4">
          {blocks.map(b =>
            b.type === 'soundtrack' ? (
              <TrackRow
                key={b.id}
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
                className={PROSE_CLASS}
                dangerouslySetInnerHTML={{ __html: b.content }}
              />
            ),
          )}
        </div>

        {/* Below the end of the prose, past the point the reader has finished.
            Never a margin, never a sidebar, never previewed above (LOOM-134). */}
        <CommentThread bookId={bookId} chapterId={chapterId} comments={comments} />
      </main>

      {/* Sticky footer rail, like Loom's.

          chrome-dark: it stays DARK in light mode. I had removed that on a
          misread of a screenshot — the page above it is cream, the bar is not.

          Progress is a filled accent bar with a dot at its leading edge, not a
          lone dot: a dot on a hairline gave no sense of how far through the
          chapter you were, which is the only thing this rail is for. */}
      <div className="chrome-dark sticky bottom-0 bg-surface-raised">
        <div className="px-8 py-3 flex items-center gap-6">
          {/* Back sits LEFT of the bar and forward sits right, so the pair
              reads as direction of travel rather than as a menu. */}
          <div className="shrink-0 text-xs">
            {prev ? (
              <Link href={`/book/${bookId}/chapter/${prev.id}`} className="flex items-center gap-1.5 text-ink-muted hover:text-ink transition">
                <LuArrowLeft size={12} /> {prev.numbered ? `Chapter ${prev.label}` : prev.label}
              </Link>
            ) : (
              <Link href={`/book/${bookId}`} className="flex items-center gap-1.5 text-ink-muted hover:text-ink transition">
                <LuArrowLeft size={12} /> {bookTitle}
              </Link>
            )}
          </div>

          <div className="relative flex-1 min-w-0 h-1 rounded-full bg-surface-muted/60">
            <div
              className="absolute inset-y-0 left-0 rounded-full bg-accent transition-[width] duration-150"
              style={{ width: `${progress * 100}%` }}
            />
            <div
              className="absolute top-1/2 h-2 w-2 -translate-y-1/2 -translate-x-1/2 rounded-full bg-accent transition-[left] duration-150"
              style={{ left: `${progress * 100}%` }}
            />
          </div>

          <div className="shrink-0 text-xs">
            {next && (
              <Link href={`/book/${bookId}/chapter/${next.id}`} className="flex items-center gap-1.5 text-ink-muted hover:text-ink transition">
                {next.numbered ? `Chapter ${next.label}` : next.label} <LuArrowRight size={12} />
              </Link>
            )}
          </div>
        </div>
      </div>

      {hovered && (
        // Follows the page theme — a dark card on a cream page read as a bug.
        // And it shows the AVATAR: repeating a name the reader just read is no
        // information at all, where a face is the thing worth surfacing
        // mid-chapter.
        <div
          className="fixed z-50 -translate-x-1/2 -translate-y-full pointer-events-none flex items-center gap-3 px-3 py-2 rounded-lg bg-surface-raised border border-accent/20 shadow-lg"
          style={{ left: hovered.x, top: hovered.y - 8 }}
        >
          <div className="w-12 h-12 shrink-0 rounded-full overflow-hidden bg-surface-overlay border border-accent/15 flex items-center justify-center">
            {hovered.c.photoPath ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={hovered.c.photoPath} alt="" className="w-full h-full object-cover" />
            ) : (
              <span className="text-sm text-ink-faint">{hovered.c.name.charAt(0)}</span>
            )}
          </div>
          <div className="min-w-0">
            <p className="text-sm text-ink whitespace-nowrap">{hovered.c.name}</p>
            {hovered.c.deceased ? (
              <p className="text-[10px] uppercase tracking-widest text-ink-faint italic">Deceased</p>
            ) : hovered.c.age !== null ? (
              <p className="text-[11px] text-ink-faint">Age {hovered.c.age}</p>
            ) : null}
          </div>
        </div>
      )}
    </div>
  )
}
