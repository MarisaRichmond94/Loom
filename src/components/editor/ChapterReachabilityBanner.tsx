'use client'

import { useEffect, useState } from 'react'
import { useRouter, usePathname } from 'next/navigation'
import { LuTriangleAlert, LuCircleSlash, LuChevronDown, LuExternalLink, LuLocate } from 'react-icons/lu'
import type { Finding, ReachabilityReport } from '@/lib/reachability'
import ConditionSentence from '@/components/editor/ConditionSentence'
import { subscribeReachabilityChanged } from '@/lib/reachabilitySync'

// Reachability for the chapter you are actually writing (LOOM-122).
//
// The Paths tab is a destination you visit; this is the same finding brought
// to where the mistake was made. Collapsed by default and silent when there is
// nothing to say — a banner that is always present is a banner nobody reads.
//
// It REPORTS. No save is blocked and nothing is auto-fixed: a branch written
// before the choice that reaches it is normal drafting, not an error.
//
// Reachability cannot be computed from one chapter — a variable set in book 2
// is read in book 4 — so this reads the series-wide route and filters to this
// chapter. That walk is a pure read and takes milliseconds; there is no
// per-chapter shortcut that would be correct.

export default function ChapterReachabilityBanner({
  seriesId,
  chapterId,
}: {
  seriesId: string
  chapterId: string
}) {
  const [findings, setFindings] = useState<Finding[] | null>(null)
  const [open, setOpen] = useState(false)
  // Bumped when a structural save lands, to re-ask the server.
  const [revision, setRevision] = useState(0)
  const router = useRouter()
  const pathname = usePathname()

  /**
   * Scroll the offending block into view.
   *
   * Reuses the editor's existing `?block=<id>` deep link (BlockEditor reads it
   * from the query string and scrolls that block to centre) rather than
   * reaching into the DOM from here — the Context modal's Origin link already
   * navigates this way, so there is one mechanism to keep working.
   *
   * `replace`, not `push`: jumping to a block is not a place in history the
   * writer wants Back to walk her through. `scroll: false` because the target
   * is the block, not the top of the page.
   */
  function onJumpToBlock(blockId: string) {
    router.replace(`${pathname}?block=${blockId}`, { scroll: false })
  }

  // Re-check after any edit that can change the answer, so fixing a branch
  // clears its warning without a reload. Debounced: a condition row can fire
  // several saves as the writer attaches clauses, and the answer only matters
  // once she stops.
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | null = null
    const unsubscribe = subscribeReachabilityChanged(() => {
      if (timer) clearTimeout(timer)
      timer = setTimeout(() => setRevision(r => r + 1), 600)
    })
    return () => { if (timer) clearTimeout(timer); unsubscribe() }
  }, [])

  useEffect(() => {
    let cancelled = false
    // Only blank the banner on a real chapter change. Clearing it on every
    // re-check would flash the warning away and back while the writer is
    // still editing the condition it is about.
    fetch(`/api/series/${seriesId}/reachability`)
      .then(r => (r.ok ? r.json() : null))
      .then((data: ReachabilityReport | null) => {
        if (cancelled || !data) return
        setFindings(data.findings.filter(f => f.chapterId === chapterId))
      })
      // Silent: a banner that cannot load is a missing banner, never an error
      // thrown across the page you came here to write in.
      .catch(() => {})
    return () => { cancelled = true }
  }, [seriesId, chapterId, revision])

  useEffect(() => { setFindings(null); setOpen(false) }, [chapterId])

  if (!findings || findings.length === 0) return null

  const dead = findings.filter(f => f.severity === 'dead')
  // Unreachable outranks a warning: one is prose no reader can see, the other
  // is something to tidy.
  const severe = dead.length > 0
  const tone = severe
    ? { border: 'border-choice-kill-border', bg: 'bg-choice-kill-bg', text: 'text-choice-kill', Icon: LuCircleSlash }
    : { border: 'border-choice-amber-border', bg: 'bg-choice-amber-bg', text: 'text-choice-amber', Icon: LuTriangleAlert }

  const headline = severe
    ? `${dead.length} branch${dead.length === 1 ? '' : 'es'} here ${dead.length === 1 ? 'is' : 'are'} unreachable`
    : `${findings.length} thing${findings.length === 1 ? '' : 's'} worth a look in this chapter`

  const extra = severe && findings.length > dead.length
    ? ` · ${findings.length - dead.length} more worth a look`
    : ''

  return (
    // mt-3 because nothing sits above this now — the column has no top padding
    // of its own, and the sticky header below supplies its own pt-3.
    <div className={`mt-3 rounded-lg border ${tone.border} ${tone.bg}`}>
      <button
        type="button"
        onClick={() => setOpen(o => !o)}
        aria-expanded={open}
        className="flex w-full items-center gap-2 px-3 py-2 text-left text-xs focus:outline-none focus-visible:ring-2 focus-visible:ring-accent rounded-lg"
      >
        <tone.Icon size={13} className={`${tone.text} shrink-0`} />
        <span className="text-ink">
          <strong className="font-semibold">{headline}</strong>
          <span className="text-ink-muted">
            {extra} — written, but nothing on any path reaches {dead.length === 1 ? 'it' : 'them'}.
          </span>
        </span>
        <span className="ml-auto flex shrink-0 items-center gap-1 text-ink-muted">
          {open ? 'Hide' : 'Details'}
          <LuChevronDown
            size={13}
            className={`transition-transform duration-200 motion-reduce:transition-none ${open ? 'rotate-180' : ''}`}
          />
        </span>
      </button>

      {/* The grid 0fr→1fr expand used elsewhere in the dock: it animates to the
          content's natural height without anyone having to measure it. */}
      <div
        className={`grid transition-[grid-template-rows] duration-200 motion-reduce:transition-none ${
          open ? 'grid-rows-[1fr]' : 'grid-rows-[0fr]'
        }`}
      >
        <div className="overflow-hidden">
          <div className="flex flex-col gap-2 px-3 pb-3">
            {findings.map(f => (
              <div key={f.id} className="rounded border border-accent/10 bg-surface-base px-3 py-2">
                <p className="text-xs font-semibold text-ink">{f.title}</p>
                {f.condition && (
                  <p className="mt-1 text-[11px] leading-relaxed">
                    <ConditionSentence raw={f.condition} />
                  </p>
                )}
                <p className="mt-1 text-[11px] leading-relaxed text-ink-muted">{f.detail}</p>
                {f.evaluated > 0 && (
                  <p className="mt-1 text-[11px] text-ink-muted">
                    <span className="font-mono text-ink">{f.matched} of {f.evaluated}</span>
                    {' '}possible {f.evaluated === 1 ? 'path reaches' : 'paths reach'} it
                  </p>
                )}
                {/* Scrolls the offending block into view and makes it active,
                    via the editor's existing ?block= deep link. Without it,
                    "override #1 in this chapter" is still a hunt through a
                    long page. */}
                {f.blockId && (
                  <button
                    type="button"
                    onClick={() => onJumpToBlock(f.blockId!)}
                    className="mt-2 inline-flex items-center gap-1.5 rounded border border-accent/30 bg-surface-overlay px-2 py-0.5 text-[11px] font-medium text-ink transition hover:border-accent/60 focus:outline-none focus-visible:ring-2 focus-visible:ring-accent"
                  >
                    <LuLocate size={10} /> Show me
                  </button>
                )}
              </div>
            ))}
            {/* A bordered control rather than accent-coloured text. The accent
                is a violet; this sits on choice-kill-bg, which is a deep red in
                dark mode and a mid red in light — the violet is close enough to
                both to read as muddy rather than as a link. Same treatment as
                the ledger's own control, so the two surfaces match. */}
            <a
              href={`/author/${seriesId}`}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex w-fit items-center gap-1.5 rounded border border-accent/30 bg-surface-overlay px-2.5 py-1 text-[11px] font-medium text-ink transition hover:border-accent/60 focus:outline-none focus-visible:ring-2 focus-visible:ring-accent"
            >
              See every path in the series <LuExternalLink size={10} />
            </a>
          </div>
        </div>
      </div>
    </div>
  )
}
