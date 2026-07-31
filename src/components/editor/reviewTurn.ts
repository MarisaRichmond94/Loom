// What a click on the review panel's send button actually asks for.
//
// Pulled out of ReviewPanel as a pure function so it can be exercised without
// a browser and without spending money on a real review — the behaviour here
// decides what the reviewer is asked, and getting it wrong is invisible until
// a paid round comes back answering the wrong question. Which is exactly what
// happened: Re-review fell through to the opening prompt, so the reviewer was
// asked for a fresh first-pass review and gave one, with no reference to the
// notes it had already written.

// The exact wording WriteAI's "updated draft" button sends.
//
// Copied verbatim rather than paraphrased, on purpose. Both apps write into
// ONE conversation history, so a chapter can be reviewed from Loom and then
// followed up in WriteAI. A reviewer asked two differently-worded versions of
// the same question answers them differently, and the seam would show up in
// the transcript as a change of voice.
export const REVISION_PROMPT =
  "I've revised the chapter — here is my updated draft. Assess the changes against your earlier feedback: what improved, and what still needs work?"

export type ReviewTurn =
  | { kind: 'refused'; notice: string }
  | {
      kind: 'run'
      /** undefined = let the runner use its opening-review prompt. */
      message: string | undefined
      previousText: string | undefined
      isRevision: boolean
    }

export function buildReviewTurn(opts: {
  /** Whatever the writer typed into the reply box, if anything. */
  typed?: string
  /** Whether a review already exists for this chapter. */
  hasReview: boolean
  /** The draft this chapter was last reviewed against, if known. */
  previous: string | null
  /** The chapter as it stands in the editor right now. */
  text: string
}): ReviewTurn {
  const typed = opts.typed?.trim()

  // A typed question is always exactly that question — about the draft as it
  // stands. It is never rewritten into a revision prompt, even if the text
  // also changed, because the writer asked something specific.
  if (typed) {
    return {
      kind: 'run',
      message: typed,
      previousText: opts.previous ?? undefined,
      isRevision: false,
    }
  }

  // No prior review: this is the opening pass. previousText is meaningless.
  if (!opts.hasReview) {
    return { kind: 'run', message: undefined, previousText: undefined, isRevision: false }
  }

  // A review exists and nothing was typed, so the button means "I've addressed
  // your feedback — read it again". Refuse when there is nothing to reassess:
  // re-reviewing a byte-identical draft costs real money to be told the same
  // thing twice. Only refuse when the previous draft is actually KNOWN; a null
  // previous means we lost the record (a reload beyond the retained few), not
  // that the chapter is unchanged.
  if (opts.previous !== null && opts.previous === opts.text) {
    return {
      kind: 'refused',
      notice:
        'This draft is unchanged since the last review — edit the chapter first, or type a question to ask about it as it stands.',
    }
  }

  return {
    kind: 'run',
    message: REVISION_PROMPT,
    previousText: opts.previous ?? undefined,
    isRevision: true,
  }
}
