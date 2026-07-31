import { buildReviewTurn, REVISION_PROMPT } from '@/components/editor/reviewTurn'

// These encode a bug found in real use: "Re-review" sent the opening prompt
// again, so the reviewer was asked for a fresh first-pass review and gave one —
// no reference to the feedback it had already written. A paid round came back
// answering the wrong question, and nothing in the code looked wrong.
//
// Note these tests do not currently run: `npm test` cannot start (KAN-29).
// They were verified by compiling the module and asserting against it directly.

const OLD = 'chapter as first reviewed'
const NEW = 'chapter after revisions'

describe('buildReviewTurn', () => {
  it('uses the opening prompt when no review exists', () => {
    const t = buildReviewTurn({ hasReview: false, previous: null, text: NEW })
    expect(t).toEqual({ kind: 'run', message: undefined, previousText: undefined, isRevision: false })
  })

  it('asks to assess the revision, rather than for a new review', () => {
    const t = buildReviewTurn({ hasReview: true, previous: OLD, text: NEW })
    expect(t.kind).toBe('run')
    if (t.kind !== 'run') return
    expect(t.message).toBe(REVISION_PROMPT)
    expect(t.isRevision).toBe(true)
  })

  it('sends the previous draft as previousText, not the current one', () => {
    // The original defect: lastSentRef was overwritten with the current text
    // before being read back, so the reviewer received two identical drafts
    // and was asked to diff them.
    const t = buildReviewTurn({ hasReview: true, previous: OLD, text: NEW })
    expect(t.kind === 'run' && t.previousText).toBe(OLD)
    expect(t.kind === 'run' && t.previousText).not.toBe(NEW)
  })

  it('refuses an unchanged draft instead of paying to be told the same thing', () => {
    const t = buildReviewTurn({ hasReview: true, previous: OLD, text: OLD })
    expect(t.kind).toBe('refused')
  })

  it('sends a typed question verbatim and does not rewrite it', () => {
    const t = buildReviewTurn({ typed: 'Is the ending earned?', hasReview: true, previous: OLD, text: NEW })
    expect(t.kind === 'run' && t.message).toBe('Is the ending earned?')
    expect(t.kind === 'run' && t.isRevision).toBe(false)
  })

  it('treats a whitespace-only reply as a re-review, not a question', () => {
    const t = buildReviewTurn({ typed: '   ', hasReview: true, previous: OLD, text: NEW })
    expect(t.kind === 'run' && t.message).toBe(REVISION_PROMPT)
  })

  it('still runs when the previous draft is unknown', () => {
    // A reload past the retained few loses the record. That is not evidence
    // the chapter is unchanged, so it must not be refused.
    const t = buildReviewTurn({ hasReview: true, previous: null, text: NEW })
    expect(t.kind === 'run' && t.message).toBe(REVISION_PROMPT)
    expect(t.kind === 'run' && t.previousText).toBeUndefined()
  })

  it('allows a typed question even when the draft is unchanged', () => {
    const t = buildReviewTurn({ typed: 'Why?', hasReview: true, previous: OLD, text: OLD })
    expect(t.kind === 'run' && t.message).toBe('Why?')
  })
})
