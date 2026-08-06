import type { ReactNode } from 'react'
import { parseCondition } from '@/components/editor/conditionUI'

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

export default function ConditionSentence({ raw }: { raw: string | null }) {
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
        <span className="font-mono text-[0.95em] text-ink">{cl.var}</span>{' '}
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
