'use client'

import { useEffect, useRef, useState } from 'react'
import { LuScanText } from 'react-icons/lu'
import { ReviewMarkdown } from './reviewMarkdown'

// The chapter's latest WriteAI review, in Loom's right dock (KAN-22).
//
// Increment 1 is READ-ONLY: it shows the most recent review conversation for
// this chapter so the writer can revise against it without a second tab or a
// second monitor. Running a review from here is Increment 2 — the fetch and
// the layout are shaped to receive it.
//
// Data comes from Loom's own /api/writeai/review, which filters server-side:
// WriteAI's sessions.json is ~6MB of every conversation ever, and the browser
// has no business receiving that to display one.

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

  useEffect(() => {
    if (!bookId) return
    let cancelled = false
    setLoading(true)
    fetch(`/api/writeai/review?seriesId=${encodeURIComponent(seriesId)}` +
          `&bookId=${encodeURIComponent(bookId)}&chapterId=${encodeURIComponent(chapterId)}`)
      .then(r => r.json())
      .then(d => { if (!cancelled) setData(d) })
      // A review is supplementary. If the lookup fails the editor carries on
      // and the panel says so — it never becomes an error the writer dismisses.
      .catch(() => { if (!cancelled) setData({ review: null, reason: 'writeai-unavailable' }) })
      .finally(() => { if (!cancelled) setLoading(false) })
    return () => { cancelled = true }
  }, [seriesId, bookId, chapterId])

  return { data, loading, hasReview: !!data?.review }
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
}: {
  data: Payload | null
  loading: boolean
}) {
  const endRef = useRef<HTMLDivElement>(null)
  const review = data?.review ?? null

  // Land at the end of the conversation: the newest turn is the one being
  // acted on, and these run long enough that opening at the top would mean
  // scrolling past a review already read.
  useEffect(() => {
    if (review) endRef.current?.scrollIntoView({ block: 'end' })
  }, [review])

  if (loading && !data) {
    return <Empty>Loading review…</Empty>
  }

  if (!review) {
    if (data?.reason === 'writeai-unavailable') {
      return <Empty>WriteAI isn&rsquo;t reachable, so its reviews can&rsquo;t be shown. The chapter is unaffected.</Empty>
    }
    if (data?.reason === 'chapter-not-addressable') {
      return (
        <Empty>
          This chapter has no canon number, so WriteAI has no way to address it.
          Unnumbered chapters and ones the canon walk skips can&rsquo;t be reviewed.
        </Empty>
      )
    }
    return <Empty>No review yet for this chapter.</Empty>
  }

  return (
    <div className="flex-1 overflow-y-auto px-4 py-3 text-xs text-ink-muted">
      <div className="mb-3 flex flex-wrap items-center gap-x-2 gap-y-1 border-b border-accent/10 pb-2">
        <span className="inline-flex items-center gap-1.5 rounded bg-accent/10 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-accent">
          <LuScanText size={11} /> {review.focus ?? 'Review'}
        </span>
        {review.draft && (
          <span className="rounded bg-surface-overlay px-1.5 py-0.5 text-[10px] uppercase tracking-wider text-ink-faint">
            draft
          </span>
        )}
        <span className="ml-auto text-[10px] text-ink-faint">{when(review.timestamp)}</span>
        {(data?.total ?? 0) > 1 && (
          <span
            className="text-[10px] text-ink-faint"
            title={`${data?.total} reviews stored for this chapter — showing the newest`}
          >
            newest of {data?.total}
          </span>
        )}
      </div>

      {(review.messages ?? []).map((m, i) => {
        const mine = m.role === 'user'
        return (
          <div key={m.id ?? i} className={mine ? 'mb-3' : 'mb-4'}>
            <div className="mb-1 text-[10px] uppercase tracking-wider text-ink-faint">
              {mine ? 'You' : (review.focus ?? 'Reviewer')}
            </div>
            <div
              className={mine
                ? 'rounded border border-accent/15 bg-surface-overlay/60 px-2.5 py-2 text-ink-muted'
                : 'text-ink-muted'}
            >
              <ReviewMarkdown text={m.content ?? ''} />
            </div>
          </div>
        )
      })}
      <div ref={endRef} />
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
