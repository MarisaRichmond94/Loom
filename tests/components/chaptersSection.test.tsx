import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import ChaptersSection from '@/components/chapters/ChaptersSection'
import type { BookChapterRow } from '@/lib/bookChapterTags'
import { CHAPTER_CARD_H } from '@/components/chapters/ChaptersBoardSkeleton'

// The Chapters tab (LOOM-120/121). The cases worth pinning are the ones the
// Outline tab gets wrong by construction: a branch chapter must appear, under
// its authored title, in sequence — and the GAPS between matches must survive
// filtering, because the spacing is the actual question being asked.
//
// The filters are searchable dropdowns rather than a wall of chips, built on
// the same popover as EventModal's CharacterPicker. Selecting is therefore
// open-then-choose, which is what these tests drive.

const CHAPTERS: BookChapterRow[] = [
  { chapterId: 'c0', title: 'Prologue', order: 1, chapterNumber: 0, offCanon: false, manualSummary: null, pov: null, date: null, characters: [], events: [] },
  {
    chapterId: 'c1', title: 'Chapter 1', order: 2, chapterNumber: 1, offCanon: false, manualSummary: null, pov: null, date: null,
    characters: [{ id: 'wc-chase', nonCanon: false }], events: [],
  },
  { chapterId: 'c2', title: 'Chapter 2', order: 3, chapterNumber: 2, offCanon: false, manualSummary: null, pov: null, date: null, characters: [], events: [] },
  {
    // Emma is tagged only here — enough to make her offerable, while leaving
    // the Chase gaps (1 and 2) unchanged.
    chapterId: 'c3', title: 'Chapter 3', order: 4, chapterNumber: 3, offCanon: false, manualSummary: null, pov: null, date: null,
    characters: [{ id: 'wc-emma', nonCanon: false }], events: [],
  },
  {
    // The chapter the whole feature exists for: branch-gated, so it has no
    // canon number and no outline card anywhere. Its POV/date come only from
    // Loom's own columns.
    chapterId: 'c4', title: 'Bonus Chapter 1', order: 5, chapterNumber: null, offCanon: true, manualSummary: 'Chase hands Jared the flash drive.', pov: 'Chase', date: 'Friday, December 4th',
    characters: [{ id: 'wc-chase', nonCanon: true }], events: [{ id: 'we-heist', nonCanon: true }],
  },
  { chapterId: 'c5', title: 'Chapter 4', order: 6, chapterNumber: 4, offCanon: false, manualSummary: null, pov: null, date: null, characters: [], events: [] },
]

// Mutable so one test can drive the loading state. Referenced only inside the
// factory's FUNCTION body, which runs at render time — a direct reference in
// the factory itself would hit the TDZ, since jest hoists the mock above this.
const mockChapterState = { chapters: CHAPTERS, loading: false, failed: false }

jest.mock('@/components/chapters/useBookChapterTags', () => ({
  useBookChapterTags: () => ({
    ...mockChapterState,
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

beforeEach(() => {
  mockChapterState.chapters = CHAPTERS
  mockChapterState.loading = false
  mockChapterState.failed = false
})

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
    const title = await screen.findByText('Bonus Chapter 1')
    expect(title).toBeInTheDocument()
    // No separate "Branch only" label — the dashed amber border on the card
    // itself is the only indicator.
    expect(screen.queryByText('Branch only')).not.toBeInTheDocument()
    const card = title.closest('[class*="border-dashed"]')
    expect(card).not.toBeNull()
    // POV/date for a branch chapter come only from Loom's own Chapter columns
    // — it has no outline card to join against.
    expect(within(card as HTMLElement).getByText('Chase')).toBeInTheDocument()
    expect(within(card as HTMLElement).getByText('Friday, December 4th')).toBeInTheDocument()
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
    await waitFor(() => expect(screen.getByText('1 chapter(s) before this')).toBeInTheDocument())
    expect(screen.getByText('2 chapter(s) since the last')).toBeInTheDocument()
    expect(screen.getByText('2 of 6 chapter(s)')).toBeInTheDocument()

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
    await waitFor(() => expect(screen.getByText('2 of 6 chapter(s)')).toBeInTheDocument())

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
    await waitFor(() => expect(screen.getByText('1 of 6 chapter(s)')).toBeInTheDocument())

    // Chapter 1 no longer matches, and its summary is still on screen.
    expect(screen.getByText('Chase meets Emma.')).toBeInTheDocument()
  })
})

describe('ChaptersSection loading', () => {
  it('holds the board’s real footprint while loading', async () => {
    // The skeleton exists to occupy the space the board is about to take. If it
    // guesses, the tab settles and then jumps — worse than no skeleton at all.
    // Both sides import one height constant; this pins that they still agree.
    mockChapterState.loading = true
    mockChapterState.chapters = []

    const { container } = setup()
    // The grid's own children — not `[style*="height"]`, which also matches the
    // board container's max-height.
    const grid = container.querySelector('[style*="grid-template-columns"]')!
    expect(grid.childElementCount).toBeGreaterThan(0)
    for (const card of Array.from(grid.children)) {
      expect((card as HTMLElement).style.height).toBe(`${CHAPTER_CARD_H}px`)
    }

    // The filter bar is drawn too — omitting it lets the whole board slide down
    // the moment the real one arrives.
    expect(container.querySelectorAll('.w-52')).toHaveLength(2)
  })
})

describe('ChaptersSection card activation', () => {
  /** The card element for a chapter, by its title. */
  function cardFor(title: string) {
    return screen.getByText(title).closest('div.group') as HTMLElement
  }

  it('does not scroll a card until it is clicked', async () => {
    // The whole point: nested scroll containers capture the wheel wherever the
    // pointer is, so an always-scrollable card makes scrolling the BOARD a
    // matter of aiming at the gaps between cards.
    setup()
    await screen.findByText('Chase meets Emma.')
    const summary = screen.getByText('Chase meets Emma.')
    expect(summary.className).toContain('overflow-hidden')

    await userEvent.click(cardFor('Chapter 1'))
    await waitFor(() => expect(summary.className).toContain('overflow-y-auto'))
  })

  it('marks the active card with the accent border', async () => {
    setup()
    const card = cardFor('Chapter 1')
    // classList, not a substring match: the INACTIVE border is `border-accent/10`,
    // which contains "border-accent" and would pass a naive assertion.
    expect(card.classList.contains('border-accent')).toBe(false)

    await userEvent.click(card)
    await waitFor(() => expect(card.classList.contains('border-accent')).toBe(true))
    // Thickness is constant so the grid cannot nudge as the selection moves.
    expect(card.classList.contains('border-2')).toBe(true)
  })

  it('moves activation to the card you click next', async () => {
    setup()
    const first = cardFor('Chapter 1')
    const second = cardFor('Chapter 2')

    await userEvent.click(first)
    await waitFor(() => expect(first.classList.contains('border-accent')).toBe(true))

    await userEvent.click(second)
    await waitFor(() => expect(second.classList.contains('border-accent')).toBe(true))
    expect(first.classList.contains('border-accent')).toBe(false)
  })

  it('deactivates when you click away', async () => {
    setup()
    const card = cardFor('Chapter 1')
    await userEvent.click(card)
    await waitFor(() => expect(card.classList.contains('border-accent')).toBe(true))

    await userEvent.click(document.body)
    await waitFor(() => expect(card.classList.contains('border-accent')).toBe(false))
  })

  it('a faded card cannot be activated', async () => {
    setup()
    await pick(/Any character/, 'Emma Bradford')
    await waitFor(() => expect(screen.getByText('1 of 6 chapter(s)')).toBeInTheDocument())

    const faded = cardFor('Chapter 1')
    await userEvent.click(faded)
    expect(faded.classList.contains('border-accent')).toBe(false)
  })
})

describe('ChaptersSection summaries', () => {
  it('lets a branch chapter be edited in place, prefilled', async () => {
    setup()
    const box = await screen.findByRole('textbox', { name: 'Chapter summary' })
    expect(box).toHaveValue('Chase hands Jared the flash drive.')
  })

  it('goes inert when its card is filtered out', async () => {
    // A filtered-out card must not take the pointer at all: no editing, no
    // focus, and nothing that scrolls under a wheel event. A de-emphasised
    // card that still moves reads as an active one.
    setup()
    const box = await screen.findByRole('textbox', { name: 'Chapter summary' })
    expect(box).not.toBeDisabled()

    // Emma is not in the branch chapter, so filtering by her fades it.
    await pick(/Any character/, 'Emma Bradford')
    await waitFor(() => expect(box).toBeDisabled())
    expect(box.className).toContain('overflow-hidden')
    expect(box.className).not.toContain('overflow-y-auto')
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
    await waitFor(() => expect(screen.getByText('2 of 6 chapter(s)')).toBeInTheDocument())

    await userEvent.click(screen.getByRole('button', { name: 'Clear character filter' }))
    await waitFor(() => expect(screen.queryByText('2 of 6 chapter(s)')).not.toBeInTheDocument())
    expect(screen.queryByRole('listbox')).not.toBeInTheDocument()
  })

  it('combines the two filters with AND', async () => {
    // Chase is in two chapters; the heist is in one of them. Together they
    // must NARROW to that one — an OR would widen, which is the opposite of
    // what setting a second filter is for.
    setup()
    await pick(/Any character/, 'Chase Gatlin')
    await waitFor(() => expect(screen.getByText('2 of 6 chapter(s)')).toBeInTheDocument())

    await pick(/Any event/, 'The Heist')
    await waitFor(() => expect(screen.getByText('1 of 6 chapter(s)')).toBeInTheDocument())
  })

  it('keeps each filter independent — clearing one leaves the other', async () => {
    setup()
    await pick(/Any character/, 'Chase Gatlin')
    await pick(/Any event/, 'The Heist')
    await waitFor(() => expect(screen.getByText('1 of 6 chapter(s)')).toBeInTheDocument())

    await userEvent.click(screen.getByRole('button', { name: 'Clear character filter' }))
    // The event filter survives: one chapter carries the heist.
    await waitFor(() => expect(screen.getByText('1 of 6 chapter(s)')).toBeInTheDocument())
    expect(screen.getByRole('button', { name: /The Heist/ })).toBeInTheDocument()
  })
})
