import { render, screen, waitFor, within, fireEvent } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import SectionTabs from '@/components/SectionTabs'
import OutlineSection from '@/components/OutlineSection'
import type { BookChapterRow } from '@/lib/bookChapterTags'
import type { OutlineResult } from '@/components/editor/outlineCache'

// The book page's outline board — every card a real Loom chapter. The cases
// pinned here are the ones that touch the writer's data: what a card shows
// when she has and hasn't written a summary, that Sync and Delete never happen
// without an explicit confirmation, and that a card merely clicked into writes
// nothing.

const row = (over: Partial<BookChapterRow> & Pick<BookChapterRow, 'chapterId' | 'title' | 'order'>): BookChapterRow => ({
  chapterNumber: null, offCanon: false, manualSummary: null, pov: null, date: null, numbered: true,
  characters: [], events: [],
  ...over,
})

const ROWS: BookChapterRow[] = [
  row({ chapterId: 'c0', title: 'Prologue', order: 1, numbered: false }),
  // Written by the writer, with an AI summary to sync to.
  row({ chapterId: 'c1', title: 'Chapter 1', order: 2, manualSummary: '<p>My own plan.</p>' }),
  // Untouched — shows WriteAI's.
  row({ chapterId: 'c2', title: 'Chapter 2', order: 3 }),
  // Written by the writer; WriteAI has nothing for it.
  row({ chapterId: 'c3', title: 'Chapter 3', order: 4, manualSummary: '<p>Only mine.</p>' }),
]

const mockState: { chapters: BookChapterRow[]; outline: OutlineResult } = {
  chapters: ROWS,
  outline: { outline: null, reason: null },
}
const mockRefresh = jest.fn()
const mockApplyManualSummary = jest.fn()
const mockLoadSeries = jest.fn()
const mockCanonSave = jest.fn()

jest.mock('@/components/chapters/useBookChapterTags', () => ({
  useBookChapterTags: () => ({
    chapters: mockState.chapters,
    loading: false,
    failed: false,
    refresh: mockRefresh,
    applyManualSummary: mockApplyManualSummary,
    replaceLocal: jest.fn(),
  }),
}))
jest.mock('@/components/timeline/useTimelineData', () => ({
  useTimelineData: () => ({ events: [], locations: [], characterPool: [], characterPhotos: {}, loading: false, unreachable: false, refresh: jest.fn() }),
}))
jest.mock('@/components/editor/outlineCache', () => ({
  prefetchBookOutline: () => Promise.resolve(mockState.outline),
  invalidateOutlineCache: jest.fn(),
}))
jest.mock('@/lib/authorContext', () => ({ useAuthor: () => ({ loadSeries: mockLoadSeries }) }))
jest.mock('@/components/editor/useCanonSave', () => ({
  useCanonSave: () => ({ saveCanon: jest.fn(), saveCanonAfterStructuralChange: mockCanonSave }),
}))
// TipTap's own round-trip is pinned elsewhere (outlineSummaryRoundTrip); here a
// textarea with the same contract — onChange only on a real edit — is enough.
jest.mock('@/components/editor/OutlineRichText', () => ({
  __esModule: true,
  default: ({ value, onChange, onBlur }: { value: string; onChange: (v: string) => void; onBlur?: () => void }) => (
    <textarea aria-label="summary" value={value} onChange={e => onChange(e.target.value)} onBlur={onBlur} />
  ),
}))

const AI_OUTLINE: OutlineResult = {
  outline: {
    cards: [
      { id: 'k1', book: 1, chapter: 1, position: 1, status: 'synced', heading: 'Chapter 1', pov: '', date: null, writer_summary: '<p>AI one.</p>', summary_source: '<p>AI one.</p>', extracted_bullets: [], notes: null, loom_id: 'c1' },
      { id: 'k2', book: 1, chapter: 2, position: 2, status: 'synced', heading: 'Chapter 2', pov: '', date: null, writer_summary: '<p>AI two.</p>', summary_source: '<p>AI two.</p>', extracted_bullets: [], notes: null, loom_id: 'c2' },
    ],
    syncState: 'synced',
    writeaiNumber: 1,
  },
  reason: null,
}

const fetchMock = jest.fn()
beforeEach(() => {
  mockState.chapters = ROWS
  mockState.outline = AI_OUTLINE
  fetchMock.mockReset()
  fetchMock.mockResolvedValue({ ok: true, json: async () => ({ ok: true, id: 'new' }) })
  global.fetch = fetchMock as unknown as typeof fetch
  ;[mockRefresh, mockApplyManualSummary, mockLoadSeries, mockCanonSave].forEach(m => m.mockReset())
  mockRefresh.mockResolvedValue(undefined)
  mockLoadSeries.mockResolvedValue(undefined)
})

function setup() {
  return render(
    <SectionTabs sections={[{ id: 'outline', label: 'Outline', content: <OutlineSection seriesId="s1" bookId="b1" /> }]} />,
  )
}
const card = (id: string) => screen.getByTestId(`outline-card-${id}`)
const calls = (method: string) => fetchMock.mock.calls.filter(([, init]) => (init?.method ?? 'GET') === method)

describe('outline board', () => {
  it('shows the writer’s summary over the AI one, and badges only AI text', async () => {
    setup()
    await waitFor(() => expect(within(card('c2')).getByLabelText('summary')).toHaveValue('<p>AI two.</p>'))
    expect(within(card('c1')).getByLabelText('summary')).toHaveValue('<p>My own plan.</p>')
    expect(within(card('c2')).getByText('AI generated')).toBeInTheDocument()
    expect(within(card('c1')).queryByText('AI generated')).not.toBeInTheDocument()
  })

  it('still shows every chapter when WriteAI has never seen the book', async () => {
    mockState.outline = { outline: null, reason: 'book-not-in-writeai' }
    setup()
    for (const r of ROWS) expect(await screen.findByText(r.title)).toBeInTheDocument()
    expect(screen.queryByText('AI generated')).not.toBeInTheDocument()
  })

  it('offers Sync only where the writer’s summary covers an AI one', async () => {
    setup()
    await screen.findByLabelText('Sync Chapter 1 with its AI-generated summary')
    expect(screen.queryByLabelText('Sync Chapter 2 with its AI-generated summary')).not.toBeInTheDocument()
    expect(screen.queryByLabelText('Sync Chapter 3 with its AI-generated summary')).not.toBeInTheDocument()
  })

  it('syncs one card only after confirming', async () => {
    setup()
    await userEvent.click(await screen.findByLabelText('Sync Chapter 1 with its AI-generated summary'))
    expect(calls('POST')).toHaveLength(0)
    await userEvent.click(screen.getByRole('button', { name: 'Replace mine' }))
    await waitFor(() => expect(calls('POST')).toHaveLength(1))
    const [url, init] = calls('POST')[0]
    expect(url).toBe('/api/series/s1/books/b1/chapter-summaries/use-ai')
    expect(JSON.parse(init.body)).toEqual({ chapterIds: ['c1'] })
    expect(mockApplyManualSummary).toHaveBeenCalledWith('c1', '')
  })

  it('bulk sync starts with nothing selected and lists only real candidates', async () => {
    setup()
    await screen.findByLabelText('Sync Chapter 1 with its AI-generated summary')
    await userEvent.click(screen.getByRole('button', { name: /Sync summaries/ }))
    const dialog = screen.getByRole('dialog', { name: 'Sync summaries' })
    // Chapter 3 has no AI summary; Chapter 2 already shows it.
    expect(within(dialog).getByText('Chapter 1')).toBeInTheDocument()
    expect(within(dialog).queryByText('Chapter 2')).not.toBeInTheDocument()
    expect(within(dialog).queryByText('Chapter 3')).not.toBeInTheDocument()
    const replace = within(dialog).getByRole('button', { name: /Replace 0 summaries/ })
    expect(replace).toBeDisabled()
    await userEvent.click(within(dialog).getByLabelText('Sync Chapter 1'))
    await userEvent.click(within(dialog).getByRole('button', { name: /Replace 1 summary/ }))
    await waitFor(() => expect(calls('POST')).toHaveLength(1))
    expect(JSON.parse(calls('POST')[0][1].body)).toEqual({ chapterIds: ['c1'] })
  })

  it('deletes only from the confirmation modal', async () => {
    setup()
    await userEvent.click(await screen.findByLabelText('Delete Chapter 2'))
    const dialog = screen.getByRole('dialog', { name: 'Delete "Chapter 2"?' })
    await userEvent.click(within(dialog).getByRole('button', { name: 'Cancel' }))
    expect(calls('DELETE')).toHaveLength(0)

    await userEvent.click(screen.getByLabelText('Delete Chapter 2'))
    await userEvent.click(within(screen.getByRole('dialog', { name: 'Delete "Chapter 2"?' })).getByRole('button', { name: 'Delete' }))
    await waitFor(() => expect(calls('DELETE')).toHaveLength(1))
    expect(calls('DELETE')[0][0]).toBe('/api/series/s1/books/b1/chapters/c2')
    // The same follow-through as the sidebar: rows, sidebar, manuscript.
    await waitFor(() => expect(mockCanonSave).toHaveBeenCalledWith('b1'))
    expect(mockLoadSeries).toHaveBeenCalled()
    expect(mockRefresh).toHaveBeenCalled()
  })

  it('adds a blank "Chapter N" at a real position', async () => {
    setup()
    await userEvent.click(await screen.findByRole('button', { name: /Add chapter/ }))
    await waitFor(() => expect(calls('POST')).toHaveLength(1))
    const [url, init] = calls('POST')[0]
    expect(url).toBe('/api/series/s1/books/b1/chapters')
    expect(JSON.parse(init.body)).toEqual({ title: 'Chapter 4', insertAtOrder: 5 })
  })

  it('inserts straight after the Prologue as Chapter 1', async () => {
    setup()
    await userEvent.click(await screen.findByLabelText('Insert a chapter after Prologue'))
    await waitFor(() => expect(calls('POST')).toHaveLength(1))
    expect(JSON.parse(calls('POST')[0][1].body)).toEqual({ title: 'Chapter 1', insertAtOrder: 2 })
  })

  it('adds ahead of an Epilogue, and offers no insert after it', async () => {
    mockState.chapters = [...ROWS, row({ chapterId: 'c4', title: 'Epilogue', order: 5, numbered: false })]
    setup()
    await screen.findByText('Epilogue')
    expect(screen.queryByLabelText('Insert a chapter after Epilogue')).not.toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: /Add chapter/ }))
    await waitFor(() => expect(calls('POST')).toHaveLength(1))
    expect(JSON.parse(calls('POST')[0][1].body)).toEqual({ title: 'Chapter 4', insertAtOrder: 5 })
  })

  it('offers the prologue/epilogue switch on the first and last card only', async () => {
    setup()
    expect(await screen.findByLabelText('Turn the prologue back into Chapter 1')).toBeInTheDocument()
    expect(screen.getByLabelText('Make this the epilogue')).toBeInTheDocument()
    expect(within(card('c1')).queryByLabelText(/prologue|epilogue/)).not.toBeInTheDocument()
    await userEvent.click(screen.getByLabelText('Make this the epilogue'))
    await waitFor(() => expect(calls('PATCH')).toHaveLength(1))
    const [url, init] = calls('PATCH')[0]
    expect(url).toBe('/api/series/s1/books/b1/chapters/c3/kind')
    expect(JSON.parse(init.body)).toEqual({ kind: 'epilogue' })
  })

  it('writes nothing for a card that was only clicked into', async () => {
    setup()
    const box = within(card('c2')).getByLabelText('summary')
    await waitFor(() => expect(box).toHaveValue('<p>AI two.</p>'))
    fireEvent.focus(box)
    fireEvent.blur(box)
    expect(calls('PUT')).toHaveLength(0)
  })

  it('editing an AI summary makes it the writer’s', async () => {
    setup()
    const box = within(card('c2')).getByLabelText('summary')
    await waitFor(() => expect(box).toHaveValue('<p>AI two.</p>'))
    fireEvent.change(box, { target: { value: '<p>Now mine.</p>' } })
    fireEvent.blur(box)
    await waitFor(() => expect(calls('PUT')).toHaveLength(1))
    const [url, init] = calls('PUT')[0]
    expect(url).toBe('/api/chapters/c2/summary')
    expect(JSON.parse(init.body)).toEqual({ body: '<p>Now mine.</p>' })
  })

  it('clearing a summary stores the "use AI" marker, not a deletion', async () => {
    setup()
    const box = within(card('c1')).getByLabelText('summary')
    fireEvent.change(box, { target: { value: '<p></p>' } })
    fireEvent.blur(box)
    await waitFor(() => expect(calls('PUT')).toHaveLength(1))
    expect(JSON.parse(calls('PUT')[0][1].body)).toEqual({ body: '' })
  })
})
