'use client'

import { useEffect, useRef, useState } from 'react'
import { LuScanText, LuTrash2, LuPlus, LuSend, LuUnplug, LuCircleSlash } from 'react-icons/lu'
import { ReviewMarkdown } from './reviewMarkdown'
import ReviewAnimation from './ReviewAnimation'
import { DEFAULT_FOCUS, useReviewRunner } from './useReviewRunner'
import { buildReviewTurn } from './reviewTurn'
import { followScrollTop } from './reviewScroll'
import { PanelEmpty, PanelEmptyState } from './PanelEmptyState'

// The chapter's WriteAI review, in Loom's right dock (KAN-22).
//
// The review runs end to end here: the panel arrives pre-populated with this
// book, this chapter and the Literary Agent persona, and waits. Nothing starts
// on open — that would spend money on a page load.
//
// `chapter_text` is sent from the LIVE editor, which is what removes the
// resync step the old two-tab loop needed.

export type ReviewMessage = {
  id?: string
  role?: string
  content?: string
  timestamp?: string
}

export type ReviewSession = {
  id: string
  label?: string
  book?: string
  chapter?: number
  focus?: string
  draft?: boolean
  timestamp?: string
  messages?: ReviewMessage[]
}

type Payload = {
  review: ReviewSession | null
  reason?: string
  chapter?: number | null
  total?: number
}

export function useChapterReview(seriesId: string, bookId: string | undefined, chapterId: string) {
  const [data, setData] = useState<Payload | null>(null)
  const [loading, setLoading] = useState(false)

  const load = useRef<() => void>(() => {})
  load.current = () => {
    if (!bookId) return
    setLoading(true)
    fetch(`/api/writeai/review?seriesId=${encodeURIComponent(seriesId)}` +
          `&bookId=${encodeURIComponent(bookId)}&chapterId=${encodeURIComponent(chapterId)}`)
      .then(r => r.json())
      .then(setData)
      // A review is supplementary. If the lookup fails the editor carries on
      // and the panel says so — never an error the writer must dismiss.
      .catch(() => setData({ review: null, reason: 'writeai-unavailable' }))
      .finally(() => setLoading(false))
  }

  useEffect(() => {
    let cancelled = false
    if (!bookId) return
    setLoading(true)
    fetch(`/api/writeai/review?seriesId=${encodeURIComponent(seriesId)}` +
          `&bookId=${encodeURIComponent(bookId)}&chapterId=${encodeURIComponent(chapterId)}`)
      .then(r => r.json())
      .then(d => { if (!cancelled) setData(d) })
      .catch(() => { if (!cancelled) setData({ review: null, reason: 'writeai-unavailable' }) })
      .finally(() => { if (!cancelled) setLoading(false) })
    return () => { cancelled = true }
  }, [seriesId, bookId, chapterId])

  return {
    data,
    loading,
    hasReview: !!data?.review,
    setData,
    refetch: () => load.current(),
  }
}

// The draft text each chapter was last reviewed against, so "assess the
// changes" still has something to diff after a page reload — otherwise every
// revision pass following a refresh silently degrades to "read this again".
//
// Bounded to a handful of chapters: a chapter's canon text runs to tens of KB,
// and keeping one per chapter would blow the ~5MB localStorage quota well
// before the writer noticed. Losing an old entry costs only the explicit diff;
// the conversation history still carries the earlier feedback.
const REVIEWED_KEY = 'loom-reviewed-drafts'
const REVIEWED_KEEP = 5

function readReviewedDrafts(): Record<string, string> {
  try {
    return JSON.parse(localStorage.getItem(REVIEWED_KEY) ?? '{}') as Record<string, string>
  } catch {
    return {}
  }
}

function rememberReviewedText(chapterId: string, text: string) {
  try {
    const all = readReviewedDrafts()
    delete all[chapterId] // re-insert so this chapter becomes the newest key
    const trimmed = Object.entries(all).slice(-(REVIEWED_KEEP - 1))
    localStorage.setItem(REVIEWED_KEY, JSON.stringify({ ...Object.fromEntries(trimmed), [chapterId]: text }))
  } catch {
    // Quota or a locked-down browser. The diff degrades; the review still runs.
  }
}

// A first review is a genuinely long wait — the reviewer reads the whole
// chapter before it says anything. One frozen line of text for that long reads
// as stalled, so the status names what is actually happening in sequence, the
// way WriteAI's indexing bar does.
//
// Deliberately not fake progress: these are not steps being ticked off, and
// none of them claims a percentage. They pass the time honestly.
const READING_PHRASES = [
  'Reading the chapter…',
  'Following the scene…',
  'Listening for voice…',
  'Weighing the pacing…',
  'Checking continuity…',
  'Reading it again, closely…',
  'Gathering its notes…',
  'Writing up the review…',
]

const REVISION_PHRASES = [
  'Re-reading your revision…',
  'Comparing against the last draft…',
  'Checking what changed…',
  'Weighing it against its notes…',
  'Writing up the assessment…',
]

const PHRASE_MS = 3400

function useCyclingPhrase(phrases: string[], active: boolean) {
  const [i, setI] = useState(0)
  useEffect(() => {
    if (!active) { setI(0); return }
    const id = setInterval(() => setI(n => n + 1), PHRASE_MS)
    return () => clearInterval(id)
  }, [active, phrases])
  return { text: phrases[i % phrases.length], index: i }
}

function when(ts?: string) {
  if (!ts) return ''
  const d = new Date(ts)
  return Number.isNaN(d.getTime()) ? '' : d.toLocaleString(undefined, {
    month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit',
  })
}

export default function ReviewPanel({
  data,
  loading,
  seriesId,
  bookId,
  chapterId,
  bookTitle,
  getCanonText,
  onSession,
  onRefetch,
}: {
  data: Payload | null
  loading: boolean
  seriesId: string
  bookId?: string
  chapterId: string
  bookTitle?: string
  getCanonText: () => string
  onSession: (s: ReviewSession | null) => void
  onRefetch: () => void
}) {
  const [reply, setReply] = useState('')
  // Set when the writer asks for a fresh review while one exists. Both are
  // kept — they are paid for, and comparing a first pass against a later one
  // is more useful than a tidy list — so this only detaches the panel from the
  // stored one until the new review lands.
  const [startingFresh, setStartingFresh] = useState(false)
  const [busy, setBusy] = useState(false)
  // Explains why a click did nothing — currently only "the draft is unchanged".
  const [notice, setNotice] = useState<string | null>(null)
  const lastSentRef = useRef<string>('')

  // Restore what this chapter was last reviewed against, so a revision pass
  // after a reload still diffs.
  useEffect(() => {
    lastSentRef.current = readReviewedDrafts()[chapterId] ?? ''
    setNotice(null)
  }, [chapterId])

  const runner = useReviewRunner(s => {
    onSession(s)
    setReply('')
    setStartingFresh(false)
    onRefetch()
  })

  const stored = data?.review ?? null
  const review = startingFresh ? null : stored
  const chapter = data?.chapter ?? null
  const canRun = !!bookId && !!bookTitle && chapter !== null

  // Keep the newest text in view WITHOUT touching any other scroller.
  //
  // This used to be endRef.scrollIntoView({ block: 'end' }). scrollIntoView
  // scrolls EVERY scrollable ancestor to reveal the element, and there are
  // four above this one: the conversation, its wrapper, the sticky dock, and
  // the page. Because the dock is sticky inside the page scroller, revealing
  // the end of a streaming review scrolled the page — so the writer's chapter
  // text crept downward on its own while the review came in. And because
  // streamText changes on every SSE chunk, that fired dozens of times per
  // review.
  //
  // overscroll-contain does not prevent this. It governs chained scrolling
  // from a user gesture, not a programmatic scroll.
  //
  // Assigning scrollTop moves exactly one element and never propagates.
  const scrollerRef = useRef<HTMLDivElement>(null)
  // The turn being asked, and the reply arriving under it. Both are scroll
  // anchors — see the follow effect below.
  const turnRef = useRef<HTMLDivElement>(null)
  const responseRef = useRef<HTMLDivElement>(null)

  // Shown once the top is genuinely out of reach.
  const [scrolledDown, setScrolledDown] = useState(false)

  // Everything the follow effect needs to know about who moved the scroller.
  // A programmatic scroll and a wheel gesture both fire `scroll`, so the only
  // way to tell them apart is to remember what we last set it to.
  const lastAutoScroll = useRef(-1)
  const writerTookOver = useRef(false)

  function onConversationScroll() {
    const el = scrollerRef.current
    if (!el) return
    setScrolledDown(el.scrollTop > 240)
    // Anything more than a rounding difference from our own last assignment is
    // the writer. From then on the reply streams in without the view moving:
    // she is reading something, and pulling her away from it is the whole
    // problem this behaviour exists to avoid.
    if (Math.abs(el.scrollTop - lastAutoScroll.current) > 2) writerTookOver.current = true
  }

  // A revision pass says different things than a first read, and claiming to
  // be "reading the chapter" when it is diffing two drafts would be wrong.
  const phrase = useCyclingPhrase(
    review ? REVISION_PHRASES : READING_PHRASES,
    runner.streaming && !runner.streamText,
  )

  // The waiting state and the reply occupy different places — one centred in
  // the panel, the other at the top — so they cannot cross-fade in place.
  // Instead the placeholder is lifted out of the flow the moment text arrives
  // and fades over the top of it, which reads as it stepping aside rather than
  // vanishing. 300ms, matching the CSS transition.
  const [handingOff, setHandingOff] = useState(false)
  const hadText = useRef(false)
  useEffect(() => {
    const hasText = !!runner.streamText
    if (hasText && !hadText.current) {
      hadText.current = true
      setHandingOff(true)
      const t = setTimeout(() => setHandingOff(false), 300)
      return () => clearTimeout(t)
    }
    if (!hasText) hadText.current = false
  }, [runner.streamText])

  function scrollToTop() {
    // The smooth scroll fires scroll events that will not match our last
    // assignment, so this also counts as the writer taking over — which is
    // right: having deliberately gone to the top mid-stream, she should not be
    // dragged back down by the next chunk.
    scrollerRef.current?.scrollTo({ top: 0, behavior: 'smooth' })
  }

  /** Distance from the top of the scroller's content to the top of `el`. */
  function offsetWithin(s: HTMLElement, el: HTMLElement) {
    return el.getBoundingClientRect().top - s.getBoundingClientRect().top + s.scrollTop
  }

  // A new turn starts: bring the question toward the top so the reply has the
  // panel to fill beneath it, and hand control back to the follow effect.
  useEffect(() => {
    if (!runner.pending) return
    const s = scrollerRef.current
    const el = turnRef.current
    if (!s || !el) return
    writerTookOver.current = false
    const top = Math.max(0, Math.min(offsetWithin(s, el) - 8, s.scrollHeight - s.clientHeight))
    lastAutoScroll.current = top
    s.scrollTop = top
  }, [runner.pending?.id])  // eslint-disable-line react-hooks/exhaustive-deps

  // Follow the reply as it streams — but only until its first line reaches the
  // top of the panel, then stop and let it fill downward. The arithmetic and
  // the reasoning live in reviewScroll.ts, where they can be tested.
  useEffect(() => {
    if (!runner.streamText || writerTookOver.current) return
    const s = scrollerRef.current
    const el = responseRef.current
    if (!s || !el) return
    const next = followScrollTop({
      targetTop: offsetWithin(s, el) - 8,
      scrollTop: s.scrollTop,
      scrollHeight: s.scrollHeight,
      clientHeight: s.clientHeight,
    })
    if (next !== null) {
      lastAutoScroll.current = next
      s.scrollTop = next
    }
  }, [runner.streamText])

  // Leaving the chapter mid-stream would otherwise keep the request alive.
  useEffect(() => () => runner.cancel(), [chapterId]) // eslint-disable-line react-hooks/exhaustive-deps

  async function start(message?: string) {
    if (!canRun || runner.streaming) return
    const text = getCanonText()

    // Read the previously-reviewed draft BEFORE overwriting it. This used to
    // assign lastSentRef first and then read it back for previousText, so
    // previousText was always identical to chapterText and the reviewer was
    // handed two copies of the same draft to "diff".
    const previous = lastSentRef.current || null

    const turn = buildReviewTurn({ typed: message, hasReview: !!review, previous, text })
    if (turn.kind === 'refused') {
      setNotice(turn.notice)
      return
    }
    setNotice(null)

    lastSentRef.current = text
    rememberReviewedText(chapterId, text)

    await runner.run({
      seriesId, bookId: bookId!, chapterId, bookTitle: bookTitle!,
      chapter, chapterText: text,
      message: turn.message,
      previousText: turn.previousText,
      session: review,
      focus: review?.focus ?? DEFAULT_FOCUS,
    })
  }

  async function remove(id: string) {
    setBusy(true)
    try {
      // No confirmation, by decision: deleting is deliberate, and a dialog to
      // dismiss is friction on a panel meant to stay out of the way.
      await fetch(`/api/writeai/review/session?id=${encodeURIComponent(id)}`, { method: 'DELETE' })
      onSession(null)
      onRefetch()
    } finally {
      setBusy(false)
    }
  }

  if (loading && !data) {
    return (
      <PanelEmpty>
        <PanelEmptyState icon={<LuScanText size={28} />} title="Loading review…" />
      </PanelEmpty>
    )
  }

  if (data?.reason === 'writeai-unavailable') {
    return (
      <PanelEmpty>
        <PanelEmptyState icon={<LuUnplug size={28} />} title="WriteAI isn’t reachable">
          Reviews can’t be shown or run until it’s back. Your chapter is unaffected.
        </PanelEmptyState>
      </PanelEmpty>
    )
  }
  if (data?.reason === 'chapter-not-addressable') {
    return (
      <PanelEmpty>
        <PanelEmptyState icon={<LuCircleSlash size={28} />} title="This chapter can’t be reviewed">
          It has no canon number, so WriteAI has no way to address it. Unnumbered
          chapters, and ones the canon walk skips, aren’t reachable.
        </PanelEmptyState>
      </PanelEmpty>
    )
  }

  const chapterLabel = chapter === 0 ? 'Prologue' : `Chapter ${chapter}`

  return (
    // A review is prose to be read, not a caption, and 12px was too small for
    // it. Base is 14px, and it scales with ⌥⇧+/- off the same
    // --loom-prose-scale the editor and the pins panel use — one control for
    // "make the words bigger", wherever the words are.
    //
    // Only the conversation inherits this. The header chips, cost line and
    // buttons carry their own sizes and stay put: they are chrome, and chrome
    // growing with the prose just costs reading room.
    <div
      className="flex-1 min-h-0 flex flex-col text-ink-muted"
      style={{ fontSize: 'calc(var(--loom-prose-scale, 1) * 0.875rem)' }}
    >
      {/* Pre-populated header: which book, which chapter, which persona — the
          same three things the old Review button filled in before handing off
          to WriteAI.

          A SIBLING of the scroller, not a sticky child of it. It was sticky,
          which left a band of scrolling text visible between it and the tab
          strip: `sticky top-0` pins to the scrollport, but the scroller's own
          top padding is part of that scrollport, so content slid through the
          gap above the header. Cancelling the padding with negative margins
          fought the symptom. A header that never scrolls does not need to be
          sticky at all — outside the scroller there is no gap to cover. */}
      <div className="shrink-0 flex flex-wrap items-center gap-x-2 gap-y-1 border-b border-accent/10 px-4 py-2">
          <span className="inline-flex items-center gap-1.5 rounded bg-accent/10 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-accent">
            <LuScanText size={11} /> {review?.focus ?? DEFAULT_FOCUS}
          </span>
          <span className="text-[10px] text-ink-faint">
            {bookTitle} · {chapterLabel}
          </span>
          <div className="ml-auto flex items-center gap-2">
            {review && (data?.total ?? 0) > 1 && (
              <span className="text-[10px] text-ink-faint" title={`${data?.total} reviews stored — showing the newest`}>
                newest of {data?.total}
              </span>
            )}
            {review && !runner.streaming && (
              <>
                <button
                  onClick={() => setStartingFresh(true)}
                  title="Start a fresh review — the existing one is kept"
                  className="text-ink-faint hover:text-ink transition"
                >
                  <LuPlus size={13} />
                </button>
                <button
                  onClick={() => remove(review.id)}
                  disabled={busy}
                  title="Delete this review"
                  className="text-ink-faint hover:text-choice-kill transition disabled:opacity-50"
                >
                  <LuTrash2 size={12} />
                </button>
              </>
            )}
            {review && <span className="text-[10px] text-ink-faint">{when(review.timestamp)}</span>}
          </div>
      </div>

      {/* `relative` here rather than on the panel root, so the scroll-back-to-top
          control anchors to the bottom of the CONVERSATION — just above the
          reply box — instead of the bottom of the whole panel, where it sat
          alongside the Re-review button. */}
      <div className="relative flex-1 min-h-0 flex flex-col">
        {/* This scroller sits inside SidePanel's, so it needs its own
            overscroll-contain: hitting the top or bottom of a review would
            otherwise hand the gesture to the dock and then to the page. */}
        {/* `flex flex-col` so the empty state can claim the full height and
            centre itself; with content present the children simply stack. */}
        <div
          ref={scrollerRef}
          onScroll={onConversationScroll}
          className="flex-1 flex flex-col overflow-y-auto overscroll-contain px-4 py-3"
        >

        {/* Each writer turn opens a round, so those are the dividers. */}
        {(review?.messages ?? []).map((m, i) => {
          const mine = m.role === 'user'
          return (
            <div key={m.id ?? i} className={mine ? (i === 0 ? 'mb-3' : 'mt-6 mb-3') : 'mb-4'}>
              <div className={`mb-1 text-[10px] font-semibold uppercase tracking-wider ${mine ? 'text-accent' : 'text-ink-faint'}`}>
                {mine ? 'You' : (review?.focus ?? 'Reviewer')}
              </div>
              <div className={mine
                ? 'rounded-r border-l-2 border-accent/60 bg-accent/10 px-2.5 py-2 text-ink'
                : 'text-ink-muted'}>
                <ReviewMarkdown text={m.content ?? ''} />
              </div>
            </div>
          )
        })}

        {/* The question just asked, before the session that will hold it
            exists. Same markup as a stored writer turn, so nothing shifts when
            the two swap over on completion. */}
        {runner.pending && (
          <div ref={turnRef} className={(review?.messages?.length ?? 0) > 0 ? 'mt-6 mb-3' : 'mb-3'}>
            <div className="mb-1 text-[10px] font-semibold uppercase tracking-wider text-accent">
              You
            </div>
            <div className="rounded-r border-l-2 border-accent/60 bg-accent/10 px-2.5 py-2 text-ink">
              <ReviewMarkdown text={runner.pending.content ?? ''} />
            </div>
          </div>
        )}

        {/* The first pass is the slow, expensive one — it includes the Ideal
            Version rewrite and reads the chapter cold. The animation carries
            that wait; follow-ups are quick enough that a line of text is
            honest and a spinning graphic would be theatre. Either way it
            gives way the moment real text arrives. */}
        {/* ONE assistant slot, occupied first by the waiting state and then by
            the reply. It used to be two separate blocks: the waiting state was
            `flex-1 justify-center`, filling the panel and centring itself, and
            the reply was a normal top-aligned block. So the first token made
            the content leap from the middle of the panel to the top — the jolt
            was a change of layout, not a change of content.

            Now the placeholder sits exactly where the reply will be, under the
            same label, and hands over by fading. Nothing moves; the box simply
            fills. The reply then grows downward, which the pin-to-bottom
            follows smoothly. */}
        {runner.streaming && (
          // The waiting state stays centred and full size — it is the best
          // thing on the screen and the wait is long enough to deserve it.
          // `relative` lets it lift OUT of the flow while it fades, so the
          // reply can take its place underneath without the two briefly
          // stacking and doubling the height.
          <div className={runner.streamText ? 'relative' : 'relative flex-1 flex flex-col'}>
            {(!runner.streamText || handingOff) && (
              <div
                className={`flex flex-col items-center justify-center gap-3 py-8 text-center transition-opacity duration-300 ${
                  runner.streamText ? 'pointer-events-none absolute inset-0' : 'flex-1'
                } ${handingOff ? 'opacity-0' : 'opacity-100'}`}
              >
                {/* The graphic earns its place on a first pass, where the wait
                    is long. A follow-up returns fast enough that it would be
                    theatre, so that case gets the words alone. */}
                {!review && <ReviewAnimation />}
                <p
                  // Re-keying on the phrase restarts the animation, so each
                  // line rises in rather than swapping in place.
                  key={phrase.index}
                  className="loom-phrase-in text-[11px] text-ink-faint"
                >
                  {phrase.text}
                </p>
              </div>
            )}
            {runner.streamText && (
              // The scroll anchor: this block's top is what rises to the top of
              // the panel and then stays there.
              <div ref={responseRef} className="loom-fade-in mb-4">
                <div className="mb-1 text-[10px] font-semibold uppercase tracking-wider text-ink-faint">
                  {review?.focus ?? DEFAULT_FOCUS}
                </div>
                <ReviewMarkdown text={runner.streamText} />
              </div>
            )}
          </div>
        )}

        {!review && !runner.streaming && (
          <PanelEmptyState
            icon={<LuScanText size={28} />}
            title="This chapter has never been reviewed"
          >
            It will be read exactly as it stands in the editor right now —
            nothing is exported or synced first.
          </PanelEmptyState>
        )}

        {runner.error && (
          <p className="my-2 rounded border border-choice-kill/40 bg-choice-kill/10 px-2.5 py-2 text-choice-kill">
            {runner.error}
          </p>
        )}

        {/* Not an error — the click was refused on purpose, and saying so is
            better than a button that appears to do nothing. */}
        {notice && (
          <p className="my-2 rounded border border-accent/25 bg-accent/5 px-2.5 py-2 text-ink-muted">
            {notice}
          </p>
        )}

        </div>

        {/* Floats over the end of the conversation, just above the reply box.
            Reviews run long, and after reading to the bottom the header — book,
            chapter, persona — is a scroll of unknown length away. */}
        {scrolledDown && (
          <button
            onClick={scrollToTop}
            className="absolute bottom-2 left-1/2 z-20 -translate-x-1/2 rounded-full border border-accent/30 bg-surface-raised/95 px-3 py-1 text-[11px] font-medium text-accent shadow-lg backdrop-blur-sm transition hover:bg-accent/10"
          >
            Scroll back to top
          </button>
        )}
      </div>

      {/* Action bar. Cost is shown here, at the point of action, rather than
          leaving spend to be found later in WriteAI's Spend pane. */}
      <div className="shrink-0 border-t border-accent/10 px-3 pt-2 pb-3.5">
        {runner.cost !== null && (
          <div className="mb-1.5 text-[10px] text-ink-faint">
            last review cost ${runner.cost.toFixed(3)}
          </div>
        )}
        {review && !runner.streaming && (
          <textarea
            value={reply}
            onChange={e => setReply(e.target.value)}
            rows={2}
            placeholder="Reply, or leave blank to re-review the revised chapter…"
            // No size class, so it inherits the panel's scaled body size.
            // Reading a review at 16px and typing the reply at 12px would be
            // an odd seam in what is one conversation.
            className="mb-1.5 w-full resize-y rounded border border-accent/20 bg-surface-overlay px-2 py-1.5 text-ink placeholder:text-ink-faint outline-none focus:border-accent/50"
          />
        )}
        <div className="flex items-center gap-2">
          {runner.streaming ? (
            <button
              onClick={runner.cancel}
              className="rounded border border-accent/30 px-2.5 py-1 text-[11px] text-ink-muted hover:text-ink transition"
            >
              Stop
            </button>
          ) : (
            <button
              onClick={() => start(reply.trim() || undefined)}
              disabled={!canRun}
              title={canRun ? undefined : 'This chapter has no canon number, so it cannot be reviewed'}
              className="flex items-center gap-1.5 rounded bg-accent px-2.5 py-1 text-[11px] font-medium text-white transition hover:opacity-90 disabled:opacity-50"
            >
              <LuSend size={11} />
              {review ? (reply.trim() ? 'Send' : 'Re-review') : 'Submit'}
            </button>
          )}
          {startingFresh && !runner.streaming && (
            <button
              onClick={() => setStartingFresh(false)}
              className="text-[11px] text-ink-faint hover:text-ink transition"
            >
              cancel
            </button>
          )}
          <span className="ml-auto text-[10px] text-ink-faint">
            {runner.streaming ? 'reviewing…' : 'reads the live editor'}
          </span>
        </div>
      </div>
    </div>
  )
}

/**
 * The panel's "nothing here" view — centred on both axes.
 *
 * This is the DOMINANT state, not an edge case: 92% of chapters have no
 * review. Left-aligned body text in the corner of a third-of-the-viewport
 * panel read like a stray sentence; centred with an icon it reads as a
 * deliberate state.
 */
