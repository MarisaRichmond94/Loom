import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import ChaptersSection from '@/components/chapters/ChaptersSection'
import type { BookChapterRow } from '@/lib/bookChapterTags'

// The Chapters tab (LOOM-120/121). The cases worth pinning are the ones the
// Outline tab gets wrong by construction: a branch chapter must appear, under
// its authored title, in sequence — and the GAPS between matches must survive
// filtering, because the spacing is the actual question being asked.

const CHAPTERS: BookChapterRow[] = [
  { chapterId: 'c0', title: 'Prologue', order: 1, chapterNumber: 0, offCanon: false, characters: [], events: [] },
  {
    chapterId: 'c1', title: 'Chapter 1', order: 2, chapterNumber: 1, offCanon: false,
    characters: [{ id: 'wc-chase', nonCanon: false }], events: [],
  },
  { chapterId: 'c2', title: 'Chapter 2', order: 3, chapterNumber: 2, offCanon: false, characters: [], events: [] },
  { chapterId: 'c3', title: 'Chapter 3', order: 4, chapterNumber: 3, offCanon: false, characters: [], events: [] },
  {
    // The chapter the whole feature exists for: branch-gated, so it has no
    // canon number and no outline card anywhere.
    chapterId: 'c4', title: 'Bonus Chapter 1', order: 5, chapterNumber: null, offCanon: true,
    characters: [{ id: 'wc-chase', nonCanon: true }], events: [],
  },
  { chapterId: 'c5', title: 'Chapter 4', order: 6, chapterNumber: 4, offCanon: false, characters: [], events: [] },
]

jest.mock('@/components/chapters/useBookChapterTags', () => ({
  useBookChapterTags: () => ({
    chapters: CHAPTERS,
    loading: false,
    failed: false,
    refresh: jest.fn(),
  }),
}))

jest.mock('@/components/timeline/useTimelineData', () => ({
  useTimelineData: () => ({
    events: [],
    locations: [],
    characterPool: [
      { id: 'wc-chase', name: 'Chase Gatlin' },
      // Tagged nowhere in this book — must not be offered as a filter.
      { id: 'wc-nobody', name: 'Never Tagged' },
    ],
    characterPhotos: {},
    loading: false,
    unreachable: false,
    refresh: jest.fn(),
  }),
}))

jest.mock('@/components/editor/outlineCache', () => ({
  prefetchBookOutline: jest.fn().mockResolvedValue({
    outline: {
      cards: [
        {
          id: 'ch-1', loom_id: 'c1', chapter: 1, position: 1, status: 'synced',
          heading: 'Chapter 1', pov: '', date: null,
          writer_summary: '<p>Chase meets Emma.</p>', extracted_bullets: [], notes: null,
        },
      ],
      syncState: 'synced',
      writeaiNumber: 1,
    },
    reason: null,
  }),
}))

function setup() {
  return render(<ChaptersSection seriesId="s1" bookId="b1" />)
}

describe('ChaptersSection', () => {
  it('shows the branch chapter under its authored title, in sequence', async () => {
    setup()
    // The label the left-hand sidebar uses — not "Chapter 4", which is what a
    // number-continuing scheme would have produced for it.
    expect(await screen.findByText('Bonus Chapter 1')).toBeInTheDocument()
    expect(screen.getByText('Branch only')).toBeInTheDocument()
  })

  it('joins the outline summary read-only where a card exists', async () => {
    setup()
    // HTML in the store, rendered as TEXT.
    expect(await screen.findByText('Chase meets Emma.')).toBeInTheDocument()
  })

  it('offers only entities actually tagged in this book', async () => {
    setup()
    expect(await screen.findByRole('button', { name: 'Chase Gatlin' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Never Tagged' })).not.toBeInTheDocument()
  })

  it('keeps non-matching chapters in place, and counts the gap', async () => {
    setup()
    await userEvent.click(await screen.findByRole('button', { name: 'Chase Gatlin' }))

    // Chase is in Chapter 1 and Bonus Chapter 1. One chapter precedes the
    // first match (the prologue); two sit between the two matches (Chapter 2
    // and Chapter 3). Chapter 4 trails the last match and is NOT a gap.
    await waitFor(() => expect(screen.getByText('1 chapter without')).toBeInTheDocument())
    expect(screen.getByText('2 chapters without')).toBeInTheDocument()
    expect(screen.queryByText('3 chapters without')).not.toBeInTheDocument()
    expect(screen.getByText('2 of 6 chapters')).toBeInTheDocument()

    // Dimmed, not removed — the sequence has to stay countable.
    expect(screen.getByText('Chapter 2')).toBeInTheDocument()
    expect(screen.getByText('Chapter 3')).toBeInTheDocument()
  })

  it('clears the filter when the same chip is clicked again', async () => {
    setup()
    const chip = await screen.findByRole('button', { name: 'Chase Gatlin' })
    await userEvent.click(chip)
    await waitFor(() => expect(screen.getByText('2 of 6 chapters')).toBeInTheDocument())

    await userEvent.click(screen.getByRole('button', { name: /Chase Gatlin/ }))
    await waitFor(() => expect(screen.queryByText('2 of 6 chapters')).not.toBeInTheDocument())
  })

  it('drops the selection when the filter mode changes', async () => {
    // A character id left selected in event mode matches nothing and would
    // read as "no results" rather than "no filter".
    setup()
    await userEvent.click(await screen.findByRole('button', { name: 'Chase Gatlin' }))
    await waitFor(() => expect(screen.getByText('2 of 6 chapters')).toBeInTheDocument())

    await userEvent.click(screen.getByRole('button', { name: 'events' }))
    await waitFor(() => expect(screen.queryByText(/of 6 chapters/)).not.toBeInTheDocument())
  })
})
