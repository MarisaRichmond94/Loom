import { render, screen } from '@testing-library/react'
import ReachabilityLedger from '@/components/series/ReachabilityLedger'

// Why the ledger shows a chapter's TITLE and never a number it derives itself
// (LOOM-122).
//
// `Chapter.order` is a position in the book, not the number the writer sees.
// Two things break the correspondence, and this series has both:
//
//   - `numbered: false` chapters (a prologue) render their authored title and
//     do not advance the running count.
//   - A chapter behind a visibility condition does not advance it either.
//
// So position 13 in "The Secrets We Keep" is the chapter titled "Chapter 10",
// and every book here was off by three. The ledger rendered `order + 1` as
// "Chapter 13" while linking, correctly, to the chapter titled "Chapter 10" —
// so the label accused the link of being broken when the link was fine.
//
// The fix is to show `chapterTitle`, the same string the outline tree shows.
// These tests pin that: a derived number must not reappear.

const FINDING = {
  id: 'ov1',
  kind: 'unreachable-combination' as const,
  severity: 'dead' as const,
  targetType: 'override' as const,
  title: 'Override #2 needs a combination that never happens',
  detail: 'All 8 states that reach this fragment were checked.',
  condition: JSON.stringify({ didJaredLetEmmaWalkOutTheDoor: true }),
  bookId: 'bk4',
  bookTitle: 'The Secrets We Keep',
  chapterId: 'chapter-cuid',
  chapterTitle: 'Chapter 10',
  // The trap: position 13 in the book, titled "Chapter 10".
  chapterOrder: 13,
  evaluated: 8,
  matched: 0,
}

const REPORT = {
  findings: [FINDING],
  summary: {
    chapters: 343, choicePoints: 37, overrides: 263, gatedBlocks: 13,
    chapterGates: 19, gatedChoices: 1, variables: 28, peakStates: 152,
    dead: 1, warnings: 0, deadByBook: { bk4: 1 },
  },
}

beforeEach(() => {
  global.fetch = jest.fn().mockResolvedValue({
    ok: true,
    json: async () => REPORT,
  }) as unknown as typeof fetch
})

describe('ReachabilityLedger chapter labelling', () => {
  it('shows the chapter title, not a number derived from its position', async () => {
    render(<ReachabilityLedger seriesId="s1" />)

    // The authored title appears, in the location line and on the control.
    expect(await screen.findByText(/Open Chapter 10/)).toBeInTheDocument()
    // The position must never be shown as if it were the chapter number.
    expect(screen.queryByText(/Chapter 13/)).not.toBeInTheDocument()
    expect(screen.queryByText(/Chapter 14/)).not.toBeInTheDocument()
  })

  it('links by chapter id, so the destination cannot drift from the label', async () => {
    render(<ReachabilityLedger seriesId="s1" />)

    const link = await screen.findByRole('link', { name: /Open Chapter 10/ })
    expect(link).toHaveAttribute('href', '/author/s1/chapter/chapter-cuid')
    // A worklist: following a finding must not cost you your place in it.
    expect(link).toHaveAttribute('target', '_blank')
  })

  it('says so plainly when a finding belongs to no single chapter', async () => {
    ;(global.fetch as jest.Mock).mockResolvedValue({
      ok: true,
      json: async () => ({
        ...REPORT,
        findings: [{
          ...FINDING,
          id: 'undeclared-write:jaredKillCount',
          title: '"jaredKillCount" is set but was never created',
          bookId: undefined, bookTitle: undefined,
          chapterId: undefined, chapterTitle: undefined, chapterOrder: undefined,
          condition: undefined, evaluated: 0,
        }],
      }),
    })

    render(<ReachabilityLedger seriesId="s1" />)

    // No link at all, and an explanation of why — rather than a card that
    // looks clickable and silently does nothing.
    expect(await screen.findByText(/Series-wide/)).toBeInTheDocument()
    expect(screen.queryByRole('link')).not.toBeInTheDocument()
  })
})
