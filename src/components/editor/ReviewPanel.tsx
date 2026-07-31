'use client'

import { useEffect, useRef, useState } from 'react'
import { LuScanText, LuTrash2, LuPlus, LuSend } from 'react-icons/lu'
import { ReviewMarkdown } from './reviewMarkdown'
import { DEFAULT_FOCUS, useReviewRunner } from './useReviewRunner'

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
  const endRef = useRef<HTMLDivElement>(null)
  const [reply, setReply] = useState('')
  // Set when the writer asks for a fresh review while one exists. Both are
  // kept — they are paid for, and comparing a first pass against a later one
  // is more useful than a tidy list — so this only detaches the panel from the
  // stored one until the new review lands.
  const [startingFresh, setStartingFresh] = useState(false)
  const [busy, setBusy] = useState(false)
  const lastSentRef = useRef<string>('')

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

  useEffect(() => {
    if (review || runner.streamText) endRef.current?.scrollIntoView({ block: 'end' })
  }, [review, runner.streamText])

  // Leaving the chapter mid-stream would otherwise keep the request alive.
  useEffect(() => () => runner.cancel(), [chapterId]) // eslint-disable-line react-hooks/exhaustive-deps

  async function start(message?: string) {
    if (!canRun || runner.streaming) return
    const text = getCanonText()
    lastSentRef.current = text
    await runner.run({
      seriesId, bookId: bookId!, chapterId, bookTitle: bookTitle!,
      chapter, chapterText: text,
      message,
      // The draft reviewed last turn, so a follow-up diffs rather than
      // starting over. Only meaningful once a round has happened.
      previousText: review ? lastSentRef.current : undefined,
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

  if (loading && !data) return <Empty>Loading review…</Empty>

  if (data?.reason === 'writeai-unavailable') {
    return <Empty>WriteAI isn&rsquo;t reachable, so reviews can&rsquo;t be shown or run. The chapter is unaffected.</Empty>
  }
  if (data?.reason === 'chapter-not-addressable') {
    return (
      <Empty>
        This chapter has no canon number, so WriteAI has no way to address it.
        Unnumbered chapters and ones the canon walk skips can&rsquo;t be reviewed.
      </Empty>
    )
  }

  const chapterLabel = chapter === 0 ? 'Prologue' : `Chapter ${chapter}`

  return (
    <div className="flex-1 min-h-0 flex flex-col">
      <div className="flex-1 overflow-y-auto px-4 py-3 text-xs text-ink-muted">
        {/* Pre-populated header: which book, which chapter, which persona —
            the same three things the old Review button filled in before
            handing off to WriteAI. */}
        <div className="mb-3 flex flex-wrap items-center gap-x-2 gap-y-1 border-b border-accent/10 pb-2">
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

        {runner.streaming && (
          <div className="mb-4">
            <div className="mb-1 text-[10px] font-semibold uppercase tracking-wider text-ink-faint">
              {review?.focus ?? DEFAULT_FOCUS}
            </div>
            {runner.streamText
              ? <ReviewMarkdown text={runner.streamText} />
              : <span className="text-ink-faint italic">Reading the chapter…</span>}
          </div>
        )}

        {!review && !runner.streaming && (
          <p className="py-2 text-ink-faint leading-relaxed">
            No review yet for this chapter. It will be read exactly as it stands
            in the editor right now — nothing is exported or synced first.
          </p>
        )}

        {runner.error && (
          <p className="my-2 rounded border border-choice-kill/40 bg-choice-kill/10 px-2.5 py-2 text-choice-kill">
            {runner.error}
          </p>
        )}

        <div ref={endRef} />
      </div>

      {/* Action bar. Cost is shown here, at the point of action, rather than
          leaving spend to be found later in WriteAI's Spend pane. */}
      <div className="shrink-0 border-t border-accent/10 px-3 py-2">
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
            className="mb-1.5 w-full resize-y rounded border border-accent/20 bg-surface-overlay px-2 py-1.5 text-xs text-ink placeholder:text-ink-faint outline-none focus:border-accent/50"
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
              {review ? (reply.trim() ? 'Send' : 'Re-review') : 'Run review'}
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

function Empty({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex-1 overflow-y-auto px-4 py-6 text-xs leading-relaxed text-ink-faint">
      {children}
    </div>
  )
}
