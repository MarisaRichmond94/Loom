'use client'

import type { ReactNode } from 'react'
import { parseCondition } from '@/components/editor/conditionUI'
import { showToast } from '@/lib/notifications'

// A stored condition, read as a sentence (LOOM-122).
//
// The on-disk form is JSON, and that is what the reachability surfaces showed
// first: `{"didNoahUseSteroids":true,"isNoahUsingSteroids":true}`. The variable
// names are the writer's own and worth keeping verbatim — so they stay in mono
// — but the braces, quotes and colons carry nothing she needs, and decoding
// them is work she is doing on the tool's behalf.
//
// Parsing is delegated to conditionUI's parseCondition, which the condition
// EDITOR already uses. Same normalisation of the legacy and compound shapes,
// same polarity rule, so a condition cannot read one way here and another way
// in the row that edits it.

/** Comparison operators, in words rather than symbols. */
const CMP_WORDS: Record<string, string> = {
  '=': 'is',
  '>': 'is above',
  '<': 'is below',
  '>=': 'is at least',
  '<=': 'is at most',
}

/**
 * A variable name you can click to copy.
 *
 * Worth the interaction because of what the writer does next: the name is the
 * search term for finding the thing in the manuscript, and retyping
 * `didEmmaLearnJaredIsAfraidOfNoahLeaving` by eye is both slow and the kind of
 * thing a single wrong character makes silently useless — which is how the
 * broken clause this whole feature found got written in the first place.
 */
function CopyableName({ name }: { name: string }) {
  async function copy() {
    try {
      await navigator.clipboard.writeText(name)
      // A toast, NOT a swap of the label to "copied". The name sits mid-
      // sentence, so replacing it rewrites the line you are reading and
      // reflows what is around it — the confirmation lands as a flinch in the
      // thing you were looking at. The toast confirms in the corner the writer
      // already watches for autosave, and leaves the sentence alone.
      //
      // Short: this is the most trivial confirmation in the app, and copying
      // several names in a row should not stack a column of them.
      showToast({ kind: 'ok', message: 'Copy successful', durationMs: 2000 })
    } catch {
      // Clipboard blocked (insecure context, denied permission). Say nothing:
      // the name is still selectable by hand, and an error toast for a
      // convenience affordance is worse than the affordance not firing.
    }
  }

  return (
    <button
      type="button"
      onClick={copy}
      title={`Copy "${name}"`}
      aria-label={`Copy ${name}`}
      className="rounded font-mono text-[0.95em] text-ink underline decoration-dotted decoration-ink-faint underline-offset-2 transition hover:decoration-accent focus:outline-none focus-visible:ring-2 focus-visible:ring-accent"
    >
      {name}
    </button>
  )
}

export default function ConditionSentence({
  raw,
  copyable = false,
}: {
  raw: string | null
  /** Render variable names as click-to-copy controls. */
  copyable?: boolean
}) {
  const { op, polarity, clauses } = parseCondition(raw)

  if (clauses.length === 0) {
    return <span className="text-ink-muted">Always shows</span>
  }

  const parts: ReactNode[] = []
  clauses.forEach((cl, i) => {
    if (i > 0) {
      parts.push(
        <span key={`j${i}`} className="text-ink-muted">{op === 'or' ? ' or ' : ' and '}</span>,
      )
    }
    parts.push(
      <span key={`c${i}`}>
        {copyable
          ? <CopyableName name={cl.var} />
          : <span className="font-mono text-[0.95em] text-ink">{cl.var}</span>}{' '}
        <span className="text-ink-muted">{CMP_WORDS[cl.cmp ?? '='] ?? 'is'}</span>{' '}
        <span className="font-mono text-[0.95em] text-ink">
          {typeof cl.value === 'string' ? `"${cl.value}"` : String(cl.value)}
        </span>
      </span>,
    )
  })

  // 'hide' inverts the whole condition, so it replaces the lead-in rather than
  // adding to it — "Hidden when x is true", never "Shows when hidden when…".
  return (
    <>
      <span className="text-ink-muted">{polarity === 'hide' ? 'Hidden when ' : 'Shows when '}</span>
      {parts}
    </>
  )
}
