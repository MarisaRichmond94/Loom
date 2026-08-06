'use client'

import { useEffect, useState } from 'react'
import { LuCircleCheck, LuTriangleAlert, LuCircleSlash, LuExternalLink } from 'react-icons/lu'
import type { Finding, ReachabilityReport } from '@/lib/reachability'
import ConditionSentence from '@/components/editor/ConditionSentence'
import { subscribeReachabilityChanged } from '@/lib/reachabilitySync'

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
  const tone = TONE[finding.severity]
  const Icon = tone.icon
  // Variable-level findings (a name written but never created, or one nothing
  // reads) belong to the series, not to any one chapter — there is nowhere to
  // send the writer, so the row says so rather than looking clickable and
  // doing nothing.
  // Deep-link to the offending block where there is one, using the editor's
  // existing ?block= parameter — landing at the top of a long chapter still
  // leaves the writer hunting for the override the finding is about.
  const target = finding.chapterId
    ? `/author/${seriesId}/chapter/${finding.chapterId}` +
      (finding.blockId ? `?block=${finding.blockId}` : '')
    : null

  return (
    <div className={`rounded-lg border ${tone.border} ${tone.bg} p-4`}>
      <div className="flex items-start gap-3">
        <Icon size={15} className={`${tone.text} mt-0.5 shrink-0`} />
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
            <span className="text-sm font-semibold text-ink">{finding.title}</span>
            {finding.bookTitle && (
              // The chapter's authored title, verbatim — the same string the
              // outline tree shows. NOT a number derived from `order`: an
              // unnumbered chapter (a prologue) and any chapter hidden behind
              // a condition both leave the running count short, so position 13
              // is routinely titled "Chapter 10". Deriving one here produced a
              // label that disagreed with the chapter it linked to.
              <span className="text-xs text-ink-muted">
                {finding.bookTitle}
                {finding.chapterTitle && ` · ${finding.chapterTitle}`}
              </span>
            )}
          </div>

          <p className="mt-1.5 text-xs leading-relaxed text-ink">{finding.detail}</p>

          {finding.condition && (
            <p className="mt-2 overflow-x-auto rounded border border-accent/10 bg-surface-base px-2.5 py-2 text-xs leading-relaxed">
              <ConditionSentence raw={finding.condition} />
            </p>
          )}

          {/* The evidence. "0 of 8" is a proof — the analyzer walked all eight
              states that reach this gate and none satisfied it. A finding
              without this number is one nobody should have to take on faith. */}
          <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-2">
            {finding.evaluated > 0 && (
              <span className="text-[11px] text-ink-muted">
                <span className="font-mono text-ink">{finding.matched} of {finding.evaluated}</span>
                {' '}possible {finding.evaluated === 1 ? 'path reaches' : 'paths reach'} it
              </span>
            )}

            {/* An explicit control rather than a clickable card. The card was
                only clickable on rows that HAD a chapter, so the same gesture
                worked on some rows and silently did nothing on others. Opens
                in a new tab: this is a worklist, and following a finding
                should not cost you your place in it. */}
            {target ? (
              <a
                href={target}
                target="_blank"
                rel="noopener noreferrer"
                className="ml-auto inline-flex items-center gap-1.5 rounded border border-accent/30 bg-surface-overlay px-2.5 py-1 text-[11px] font-medium text-ink transition hover:border-accent/60 focus:outline-none focus-visible:ring-2 focus-visible:ring-accent"
              >
                Open {finding.chapterTitle ?? 'chapter'} <LuExternalLink size={11} />
              </a>
            ) : (
              <span className="ml-auto text-[11px] text-ink-muted">Series-wide — no single chapter</span>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}

export default function ReachabilityLedger({ seriesId }: { seriesId: string }) {
  const [report, setReport] = useState<ReachabilityReport | null>(null)
  const [failed, setFailed] = useState(false)
  const [revision, setRevision] = useState(0)

  // Re-ask after any edit that can change the answer, so a branch fixed in
  // another tab stops being listed here. Debounced — a condition row fires
  // several saves as clauses are attached.
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
    fetch(`/api/series/${seriesId}/reachability`)
      .then(r => (r.ok ? r.json() : Promise.reject(new Error(String(r.status)))))
      .then(data => { if (!cancelled) setReport(data) })
      .catch(() => { if (!cancelled) setFailed(true) })
    return () => { cancelled = true }
  }, [seriesId, revision])

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
