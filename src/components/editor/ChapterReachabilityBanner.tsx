'use client'

import { useEffect, useState } from 'react'
import { LuTriangleAlert, LuCircleSlash, LuChevronDown, LuExternalLink } from 'react-icons/lu'
import type { Finding, ReachabilityReport } from '@/lib/reachability'
import ConditionSentence from '@/components/editor/ConditionSentence'

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

  useEffect(() => {
    let cancelled = false
    setFindings(null)
    setOpen(false)
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
  }, [seriesId, chapterId])

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
    <div className={`mb-3 rounded-lg border ${tone.border} ${tone.bg}`}>
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
              </div>
            ))}
            <a
              href={`/author/${seriesId}`}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex w-fit items-center gap-1.5 text-[11px] text-accent hover:underline"
            >
              See every path in the series <LuExternalLink size={10} />
            </a>
          </div>
        </div>
      </div>
    </div>
  )
}
