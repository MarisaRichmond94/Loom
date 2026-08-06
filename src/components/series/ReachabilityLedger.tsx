'use client'

import { useEffect, useState, type ReactNode } from 'react'
import { LuCircleCheck, LuTriangleAlert, LuCircleSlash, LuExternalLink } from 'react-icons/lu'
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

/**
 * A condition, in words.
 *
 * The stored form is JSON, and that is what a writer had to decode here
 * before: `{"didNoahUseSteroids":true,"isNoahUsingSteroids":true}`. The
 * variable names are the writer's own and worth keeping verbatim — so they
 * stay in mono — but the braces, quotes and colons carry nothing she needs,
 * and reading them is work. The sentence carries the same information.
 */
function ConditionText({ raw }: { raw: string }) {
  let parsed: unknown
  try { parsed = JSON.parse(raw) } catch { return <>{raw}</> }
  if (!parsed || typeof parsed !== 'object') return <>{raw}</>

  const name = (n: string) => (
    <span key={n} className="font-mono text-[11.5px] text-ink">{n}</span>
  )
  const value = (v: unknown) => (
    <span className="font-mono text-[11.5px] text-ink">{typeof v === 'string' ? `"${v}"` : String(v)}</span>
  )
  const CMP: Record<string, string> = {
    '=': 'is', '>': 'is above', '<': 'is below', '>=': 'is at least', '<=': 'is at most',
  }

  const compound = parsed as { op?: string; clauses?: { var: string; value: unknown; cmp?: string }[]; mode?: string }
  const clauses: { var: string; value: unknown; cmp?: string }[] = Array.isArray(compound.clauses)
    ? compound.clauses
    : Object.entries(parsed as Record<string, unknown>).map(([k, v]) => ({ var: k, value: v }))

  if (clauses.length === 0) return <span className="text-ink-muted">always</span>

  const joiner = compound.op === 'or' ? ' or ' : ' and '
  const parts: ReactNode[] = []
  clauses.forEach((cl, i) => {
    if (i > 0) parts.push(<span key={`j${i}`} className="text-ink-muted">{joiner}</span>)
    parts.push(
      <span key={`c${i}`}>
        {name(cl.var)} <span className="text-ink-muted">{CMP[cl.cmp ?? '='] ?? 'is'}</span> {value(cl.value)}
      </span>,
    )
  })

  // 'hide' flips the polarity of the whole condition, so it changes the lead-in
  // rather than adding to it — "Hidden when x is true", never "Shows when
  // hidden when x is true".
  return (
    <>
      <span className="text-ink-muted">{compound.mode === 'hide' ? 'Hidden when ' : 'Shows when '}</span>
      {parts}
    </>
  )
}

function FindingRow({ finding, seriesId }: { finding: Finding; seriesId: string }) {
  const tone = TONE[finding.severity]
  const Icon = tone.icon
  // Variable-level findings (a name written but never created, or one nothing
  // reads) belong to the series, not to any one chapter — there is nowhere to
  // send the writer, so the row says so rather than looking clickable and
  // doing nothing.
  const target = finding.chapterId ? `/author/${seriesId}/chapter/${finding.chapterId}` : null

  return (
    <div className={`rounded-lg border ${tone.border} ${tone.bg} p-4`}>
      <div className="flex items-start gap-3">
        <Icon size={15} className={`${tone.text} mt-0.5 shrink-0`} />
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
            <span className="text-sm font-semibold text-ink">{finding.title}</span>
            {finding.bookTitle && (
              <span className="text-xs text-ink-muted">
                {finding.bookTitle}
                {finding.chapterOrder != null && ` · Chapter ${finding.chapterOrder}`}
              </span>
            )}
          </div>

          <p className="mt-1.5 text-xs leading-relaxed text-ink">{finding.detail}</p>

          {finding.condition && (
            <p className="mt-2 overflow-x-auto rounded border border-accent/10 bg-surface-base px-2.5 py-2 text-xs leading-relaxed">
              <ConditionText raw={finding.condition} />
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
                Open Chapter {finding.chapterOrder} <LuExternalLink size={11} />
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
