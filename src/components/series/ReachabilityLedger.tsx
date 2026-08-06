'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { LuCircleCheck, LuTriangleAlert, LuCircleSlash, LuArrowRight } from 'react-icons/lu'
import type { Finding, ReachabilityReport } from '@/lib/reachability'

// The Paths tab (LOOM-122) — every branch no reader can reach.
//
// Series-scoped because reachability is: a variable set in book 2 is read in
// book 4, so a per-book view would either start from defaults and call most of
// the later books dead, or walk the earlier books anyway and misreport itself.
//
// It REPORTS. Nothing here blocks a save and nothing is auto-fixed: branches
// get written before the choices that reach them, and a tool that objects
// during drafting is a tool that gets ignored. Every row therefore reads as
// information — what is true, and what would change it — not as an error.

/** Severity styling, drawn entirely from the existing choice-* families. */
const TONE = {
  dead: {
    text: 'text-choice-kill',
    bg: 'bg-choice-kill-bg',
    border: 'border-choice-kill-border',
    icon: LuCircleSlash,
    label: 'Unreachable',
  },
  warning: {
    text: 'text-choice-amber',
    bg: 'bg-choice-amber-bg',
    border: 'border-choice-amber-border',
    icon: LuTriangleAlert,
    label: 'Worth a look',
  },
} as const

function FindingRow({ finding, seriesId }: { finding: Finding; seriesId: string }) {
  const router = useRouter()
  const tone = TONE[finding.severity]
  const Icon = tone.icon
  // Variable-level findings (a name written but never created, or one nothing
  // reads) belong to the series, not to any one chapter — so there is nowhere
  // to send the writer and the row is deliberately not clickable.
  const target = finding.chapterId ? `/author/${seriesId}/chapter/${finding.chapterId}` : null

  return (
    <div
      onClick={target ? () => router.push(target) : undefined}
      role={target ? 'button' : undefined}
      tabIndex={target ? 0 : undefined}
      onKeyDown={target ? e => {
        if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); router.push(target) }
      } : undefined}
      className={`group rounded-lg border ${tone.border} ${tone.bg} p-4 transition-all ${
        target
          ? 'cursor-pointer hover:scale-[1.005] focus:outline-none focus-visible:ring-2 focus-visible:ring-accent'
          : ''
      }`}
    >
      <div className="flex items-start gap-3">
        <Icon size={15} className={`${tone.text} mt-0.5 shrink-0`} />
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
            <span className="text-sm font-semibold text-ink">{finding.title}</span>
            {finding.bookTitle && (
              <span className="text-xs text-ink-faint">
                {finding.bookTitle}
                {finding.chapterOrder != null && ` · Chapter ${finding.chapterOrder}`}
              </span>
            )}
          </div>

          <p className="mt-1.5 text-xs leading-relaxed text-ink-muted">{finding.detail}</p>

          {finding.condition && (
            <pre className="mt-2 overflow-x-auto rounded border border-accent/10 bg-surface-base px-2.5 py-1.5 font-mono text-[11px] text-ink-muted">
              {finding.condition}
            </pre>
          )}

          {/* The evidence. "0 of 8 states" is a proof — the analyzer walked all
              eight states that reach this gate and none satisfied it. A finding
              without this number is one nobody should have to take on faith. */}
          {finding.evaluated > 0 && (
            <p className="mt-2 font-mono text-[11px] text-ink-faint">
              {finding.matched} of {finding.evaluated} possible {finding.evaluated === 1 ? 'path' : 'paths'} reach it
            </p>
          )}
        </div>

        {target && (
          <LuArrowRight
            size={14}
            className="mt-0.5 shrink-0 text-ink-faint opacity-0 transition-opacity group-hover:opacity-100"
          />
        )}
      </div>
    </div>
  )
}

export default function ReachabilityLedger({ seriesId }: { seriesId: string }) {
  const [report, setReport] = useState<ReachabilityReport | null>(null)
  const [failed, setFailed] = useState(false)

  useEffect(() => {
    let cancelled = false
    fetch(`/api/series/${seriesId}/reachability`)
      .then(r => (r.ok ? r.json() : Promise.reject(new Error(String(r.status)))))
      .then(data => { if (!cancelled) setReport(data) })
      .catch(() => { if (!cancelled) setFailed(true) })
    return () => { cancelled = true }
  }, [seriesId])

  if (failed) {
    return (
      <p className="mt-16 text-center text-sm text-ink-faint">
        Couldn&apos;t check the paths just now. Reopening the tab will try again.
      </p>
    )
  }

  if (!report) {
    return (
      <div className="flex flex-col gap-3">
        <div className="h-20 animate-pulse rounded-lg bg-surface-muted" />
        <div className="h-24 animate-pulse rounded-lg bg-surface-muted" />
        <div className="h-24 animate-pulse rounded-lg bg-surface-muted" />
      </div>
    )
  }

  const { findings, summary } = report
  const dead = findings.filter(f => f.severity === 'dead')
  const warnings = findings.filter(f => f.severity === 'warning')

  return (
    <div className="flex flex-col gap-6">
      {/* What was checked, so a clean result means something. Reading "37 choice
          points, 263 alternatives" is what makes "nothing unreachable" a
          finding rather than an absence of one. */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        {[
          { label: 'Unreachable', value: summary.dead, tone: summary.dead > 0 ? 'text-choice-kill' : 'text-ink' },
          { label: 'Worth a look', value: summary.warnings, tone: summary.warnings > 0 ? 'text-choice-amber' : 'text-ink' },
          { label: 'Choice point(s)', value: summary.choicePoints, tone: 'text-ink' },
          { label: 'Alternative(s)', value: summary.overrides, tone: 'text-ink' },
        ].map(({ label, value, tone }) => (
          <div
            key={label}
            className="flex flex-col items-center gap-1 rounded-lg border border-accent/10 bg-surface-overlay px-3 py-4"
          >
            <span className={`text-xl font-bold ${tone}`}>{value}</span>
            <span className="text-xs uppercase tracking-widest text-ink-faint">{label}</span>
          </div>
        ))}
      </div>

      {findings.length === 0 ? (
        <div className="flex flex-col items-center gap-2 px-6 py-16 text-center">
          <LuCircleCheck size={22} className="text-choice-spare" />
          <p className="text-sm font-semibold text-ink">Every branch is reachable</p>
          <p className="max-w-[46ch] text-xs leading-relaxed text-ink-faint">
            All {summary.overrides} alternatives, {summary.chapterGates} chapter conditions and{' '}
            {summary.gatedBlocks} gated sections can be reached by some reader, across{' '}
            {summary.peakStates} possible paths.
          </p>
        </div>
      ) : (
        <>
          {dead.length > 0 && (
            <section className="flex flex-col gap-3">
              <div className="flex items-baseline gap-3">
                <h3 className="text-sm font-semibold text-ink">No reader can get here</h3>
                <span className="text-xs text-ink-faint">
                  written, but nothing on any path reaches it
                </span>
              </div>
              {dead.map(f => <FindingRow key={f.id} finding={f} seriesId={seriesId} />)}
            </section>
          )}

          {warnings.length > 0 && (
            <section className="flex flex-col gap-3">
              <div className="flex items-baseline gap-3">
                <h3 className="text-sm font-semibold text-ink">Worth a look</h3>
                <span className="text-xs text-ink-faint">
                  reachable, but probably not what you meant
                </span>
              </div>
              {warnings.map(f => <FindingRow key={f.id} finding={f} seriesId={seriesId} />)}
            </section>
          )}
        </>
      )}

      <p className="text-center text-[11px] leading-relaxed text-ink-faint">
        Checked {summary.chapters} chapters against every combination of your{' '}
        {summary.variables} variables — {summary.peakStates} distinct paths at the widest point.
        Nothing here changes your writing.
      </p>
    </div>
  )
}
