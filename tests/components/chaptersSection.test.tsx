import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import ChaptersSection from '@/components/chapters/ChaptersSection'
import type { BookChapterRow } from '@/lib/bookChapterTags'

// The Chapters tab (LOOM-120/121). The cases worth pinning are the ones the
// Outline tab gets wrong by construction: a branch chapter must appear, under
// its authored title, in sequence — and the GAPS between matches must survive
// filtering, because the spacing is the actual question being asked.
//
// The filters are searchable dropdowns rather than a wall of chips, built on
// the same popover as EventModal's CharacterPicker. Selecting is therefore
// open-then-choose, which is what these tests drive.

const CHAPTERS: BookChapterRow[] = [
  { chapterId: 'c0', title: 'Prologue', order: 1, chapterNumber: 0, offCanon: false, manualSummary: null, characters: [], events: [] },
  {
    chapterId: 'c1', title: 'Chapter 1', order: 2, chapterNumber: 1, offCanon: false, manualSummary: null,
    characters: [{ id: 'wc-chase', nonCanon: false }], events: [],
  },
  { chapterId: 'c2', title: 'Chapter 2', order: 3, chapterNumber: 2, offCanon: false, manualSummary: null, characters: [], events: [] },
  {
    // Emma is tagged only here — enough to make her offerable, while leaving
    // the Chase gaps (1 and 2) unchanged.
    chapterId: 'c3', title: 'Chapter 3', order: 4, chapterNumber: 3, offCanon: false, manualSummary: null,
    characters: [{ id: 'wc-emma', nonCanon: false }], events: [],
  },
  {
    // The chapter the whole feature exists for: branch-gated, so it has no
    // canon number and no outline card anywhere.
    chapterId: 'c4', title: 'Bonus Chapter 1', order: 5, chapterNumber: null, offCanon: true, manualSummary: 'Chase hands Jared the flash drive.',
    characters: [{ id: 'wc-chase', nonCanon: true }], events: [{ id: 'we-heist', nonCanon: true }],
  },
  { chapterId: 'c5', title: 'Chapter 4', order: 6, chapterNumber: 4, offCanon: false, manualSummary: null, characters: [], events: [] },
]

jest.mock('@/components/chapters/useBookChapterTags', () => ({
  useBookChapterTags: () => ({
    chapters: CHAPTERS,
    loading: false,
    failed: false,
    refresh: jest.fn(),
    applyManualSummary: jest.fn(),
  }),
}))

jest.mock('@/components/timeline/useTimelineData', () => ({
  useTimelineData: () => ({
    events: [
      { id: 'we-heist', title: 'The Heist' },
      // Tagged nowhere in this book — must not be offered.
      { id: 'we-untagged', title: 'Never Tagged Event' },
    ],
    locations: [],
    characterPool: [
      { id: 'wc-chase', name: 'Chase Gatlin' },
      { id: 'wc-emma', name: 'Emma Bradford' },
      // Tagged nowhere in this book — must not be offered.
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

/** Open a filter dropdown by its current trigger label. */
async function openFilter(triggerLabel: RegExp) {
  await userEvent.click(await screen.findByRole('button', { name: triggerLabel }))
  return await screen.findByRole('listbox')
}

/** Open a filter and choose an option by name. */
async function pick(triggerLabel: RegExp, optionName: string) {
  const list = await openFilter(triggerLabel)
  await userEvent.click(within(list).getByRole('option', { name: new RegExp(optionName) }))
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
    const list = await openFilter(/Any character/)
    expect(within(list).getByRole('option', { name: /Chase Gatlin/ })).toBeInTheDocument()
    expect(within(list).getByRole('option', { name: /Emma Bradford/ })).toBeInTheDocument()
    expect(within(list).queryByRole('option', { name: /Never Tagged/ })).not.toBeInTheDocument()
  })

  it('narrows the list as you search, and Enter takes the first match', async () => {
    setup()
    await openFilter(/Any character/)
    await userEvent.type(screen.getByLabelText('Search character'), 'emm')

    await waitFor(() =>
      expect(screen.queryByRole('option', { name: /Chase Gatlin/ })).not.toBeInTheDocument(),
    )
    await userEvent.keyboard('{Enter}')

    // Selected, and the popover closed — single-select is complete on choice.
    await waitFor(() => expect(screen.queryByRole('listbox')).not.toBeInTheDocument())
    expect(screen.getByRole('button', { name: /Emma Bradford/ })).toBeInTheDocument()
  })

  it('keeps non-matching chapters in place, and counts the gap', async () => {
    setup()
    await pick(/Any character/, 'Chase Gatlin')

    // Chase is in Chapter 1 and Bonus Chapter 1. One chapter precedes the
    // first match (the prologue); two sit between the two matches (Chapter 2
    // and Chapter 3). Chapter 4 trails the last match and is NOT a gap.
    //
    // The counts live INSIDE the matching cards. They used to be full-width
    // rules between cards, which in a grid is a row-spanning item — it forced a
    // line break wherever it landed, so filtering rearranged the whole board.
    await waitFor(() => expect(screen.getByText('1 chapter before this')).toBeInTheDocument())
    expect(screen.getByText('2 chapters since the last')).toBeInTheDocument()
    expect(screen.getByText('2 of 6 chapters')).toBeInTheDocument()

    // Faded, not removed — the sequence has to stay countable.
    expect(screen.getByText('Chapter 2')).toBeInTheDocument()
    expect(screen.getByText('Chapter 3')).toBeInTheDocument()
  })

  it('renders one grid item per chapter, filtered or not', async () => {
    // The layout must not change when a filter is set. Any extra element in
    // the grid — a gap rule, a wrapper — is what made cards jump rows.
    const { container } = setup()
    await screen.findByText('Bonus Chapter 1')
    const grid = container.querySelector('[style*="grid"]')!
    const before = grid.childElementCount

    await pick(/Any character/, 'Chase Gatlin')
    await waitFor(() => expect(screen.getByText('2 of 6 chapters')).toBeInTheDocument())

    expect(grid.childElementCount).toBe(before)
    expect(before).toBe(CHAPTERS.length)
  })

  it('a filtered-out chapter keeps its summary', async () => {
    // Filtering must not collapse cards away. The summaries you scan PAST are
    // often how you decide where the new chapter goes, and resizing them makes
    // the whole grid jump on every filter change.
    setup()
    expect(await screen.findByText('Chase meets Emma.')).toBeInTheDocument()

    await pick(/Any character/, 'Emma Bradford')
    await waitFor(() => expect(screen.getByText('1 of 6 chapters')).toBeInTheDocument())

    // Chapter 1 no longer matches, and its summary is still on screen.
    expect(screen.getByText('Chase meets Emma.')).toBeInTheDocument()
  })
})

describe('ChaptersSection summaries', () => {
  it('lets a branch chapter be edited in place, prefilled', async () => {
    setup()
    const box = await screen.findByRole('textbox', { name: 'Chapter summary' })
    expect(box).toHaveValue('Chase hands Jared the flash drive.')
  })

  it('offers exactly one editor — canon chapters stay read-only', async () => {
    // Canon summaries belong to WriteAI's outline card and are joined one
    // direction only. An editor over that text would write Loom's copy into a
    // field WriteAI owns and refreshes.
    setup()
    await screen.findByText('Bonus Chapter 1')
    expect(screen.getAllByRole('textbox', { name: 'Chapter summary' })).toHaveLength(1)
  })

  it('saves on blur, to the chapter summary endpoint', async () => {
    const fetchMock = jest
      .fn()
      .mockResolvedValue({ ok: true, json: async () => ({ body: 'Rewritten.' }) })
    global.fetch = fetchMock as unknown as typeof fetch

    setup()
    const box = await screen.findByRole('textbox', { name: 'Chapter summary' })
    await userEvent.clear(box)
    await userEvent.type(box, 'Rewritten.')
    await userEvent.tab()

    await waitFor(() => expect(fetchMock).toHaveBeenCalled())
    const [url, init] = fetchMock.mock.calls[0]
    expect(url).toBe('/api/chapters/c4/summary')
    expect(init.method).toBe('PUT')
    expect(JSON.parse(init.body)).toEqual({ body: 'Rewritten.' })
  })

  it('does not save when nothing changed', async () => {
    // Blur fires on every pass through the field. A PUT per focus would write
    // constantly for no reason.
    const fetchMock = jest.fn()
    global.fetch = fetchMock as unknown as typeof fetch

    setup()
    const box = await screen.findByRole('textbox', { name: 'Chapter summary' })
    await userEvent.click(box)
    await userEvent.tab()

    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('reverts on Escape and saves nothing', async () => {
    const fetchMock = jest.fn()
    global.fetch = fetchMock as unknown as typeof fetch

    setup()
    const box = await screen.findByRole('textbox', { name: 'Chapter summary' })
    await userEvent.type(box, ' and runs')
    await userEvent.keyboard('{Escape}')

    expect(box).toHaveValue('Chase hands Jared the flash drive.')
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('clears the filter from the trigger, without reopening the list', async () => {
    setup()
    await pick(/Any character/, 'Chase Gatlin')
    await waitFor(() => expect(screen.getByText('2 of 6 chapters')).toBeInTheDocument())

    await userEvent.click(screen.getByRole('button', { name: 'Clear character filter' }))
    await waitFor(() => expect(screen.queryByText('2 of 6 chapters')).not.toBeInTheDocument())
    expect(screen.queryByRole('listbox')).not.toBeInTheDocument()
  })

  it('combines the two filters with AND', async () => {
    // Chase is in two chapters; the heist is in one of them. Together they
    // must NARROW to that one — an OR would widen, which is the opposite of
    // what setting a second filter is for.
    setup()
    await pick(/Any character/, 'Chase Gatlin')
    await waitFor(() => expect(screen.getByText('2 of 6 chapters')).toBeInTheDocument())

    await pick(/Any event/, 'The Heist')
    await waitFor(() => expect(screen.getByText('1 of 6 chapters')).toBeInTheDocument())
  })

  it('keeps each filter independent — clearing one leaves the other', async () => {
    setup()
    await pick(/Any character/, 'Chase Gatlin')
    await pick(/Any event/, 'The Heist')
    await waitFor(() => expect(screen.getByText('1 of 6 chapters')).toBeInTheDocument())

    await userEvent.click(screen.getByRole('button', { name: 'Clear character filter' }))
    // The event filter survives: one chapter carries the heist.
    await waitFor(() => expect(screen.getByText('1 of 6 chapters')).toBeInTheDocument())
    expect(screen.getByRole('button', { name: /The Heist/ })).toBeInTheDocument()
  })
})
