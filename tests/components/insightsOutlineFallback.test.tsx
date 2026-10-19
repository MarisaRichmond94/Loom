import { render, screen, renderHook, waitFor } from '@testing-library/react'
import InsightsPanel from '@/components/editor/InsightsPanel'
import { useChapterInsights, type ChapterInsights } from '@/components/editor/useChapterInsights'

// When WriteAI has nothing for a chapter, the Insights tab shows the summary
// the writer wrote on the Outline tab instead of an empty state — and never
// in place of WriteAI's reading when there is one.

const INSIGHTS: ChapterInsights = { summaryText: 'WriteAI read.', summary: [], facts: [], date: null }
const panel = (over: Partial<React.ComponentProps<typeof InsightsPanel>>) =>
  render(<InsightsPanel insights={null} reason="not-analyzed" outlineSummary={null} loading={false} onRetry={jest.fn()} {...over} />)

describe('InsightsPanel outline fallback', () => {
  it('shows her outline summary when WriteAI has not analysed the chapter', () => {
    panel({ outlineSummary: '<p>Chase finds the map.</p><p>Jared lies.</p>' })
    expect(screen.getByText('Outline summary')).toBeInTheDocument()
    expect(screen.getByText('Chase finds the map.')).toBeInTheDocument()
    expect(screen.getByText('Jared lies.')).toBeInTheDocument()
    expect(screen.getByText(/hasn’t analysed this chapter yet/)).toBeInTheDocument()
    expect(screen.queryByText('Not analysed yet')).not.toBeInTheDocument()
  })

  it('keeps the retry when WriteAI is down', () => {
    const onRetry = jest.fn()
    panel({ reason: 'writeai-unavailable', outlineSummary: '<p>Plan.</p>', onRetry })
    screen.getByRole('button', { name: 'Try again' }).click()
    expect(onRetry).toHaveBeenCalled()
  })

  it('prefers WriteAI’s insights when they exist', () => {
    panel({ insights: INSIGHTS, reason: null, outlineSummary: '<p>Plan.</p>' })
    expect(screen.getByText('WriteAI read.')).toBeInTheDocument()
    expect(screen.queryByText('Plan.')).not.toBeInTheDocument()
  })

  it('falls back to the empty state with no outline summary', () => {
    panel({})
    expect(screen.getByText('Not analysed yet')).toBeInTheDocument()
  })
})

describe('useChapterInsights outline summary', () => {
  const fetchMock = jest.fn()
  beforeEach(() => {
    fetchMock.mockReset()
    global.fetch = fetchMock as unknown as typeof fetch
  })
  const respond = (insights: unknown, summary: unknown) =>
    fetchMock.mockImplementation(async (url: string) => ({
      ok: true,
      json: async () => (url.includes('/summary') ? summary : insights),
    }))

  it('reads the outline summary only when WriteAI has nothing', async () => {
    respond({ insights: null, reason: 'not-analyzed' }, { body: '<p>Mine.</p>' })
    const { result } = renderHook(() => useChapterInsights('s', 'b', 'c1', true))
    await waitFor(() => expect(result.current.outlineSummary).toBe('<p>Mine.</p>'))
    expect(fetchMock.mock.calls.every(([, init]) => (init?.method ?? 'GET') === 'GET')).toBe(true)
  })

  it('skips it when there are insights', async () => {
    respond({ insights: INSIGHTS }, { body: '<p>Mine.</p>' })
    const { result } = renderHook(() => useChapterInsights('s', 'b', 'c1', true))
    await waitFor(() => expect(result.current.insights).toEqual(INSIGHTS))
    expect(fetchMock.mock.calls.some(([url]) => String(url).includes('/summary'))).toBe(false)
    expect(result.current.outlineSummary).toBeNull()
  })

  it('treats the "use AI" marker as no summary', async () => {
    respond({ insights: null, reason: 'not-analyzed' }, { body: '' })
    const { result } = renderHook(() => useChapterInsights('s', 'b', 'c1', true))
    await waitFor(() => expect(result.current.loading).toBe(false))
    await waitFor(() => expect(fetchMock.mock.calls.some(([url]) => String(url).includes('/summary'))).toBe(true))
    expect(result.current.outlineSummary).toBeNull()
  })

  it('still reads it when WriteAI is unreachable', async () => {
    fetchMock.mockImplementation(async (url: string) => {
      if (!url.includes('/summary')) throw new Error('down')
      return { ok: true, json: async () => ({ body: '<p>Mine.</p>' }) }
    })
    const { result } = renderHook(() => useChapterInsights('s', 'b', 'c1', true))
    await waitFor(() => expect(result.current.outlineSummary).toBe('<p>Mine.</p>'))
    expect(result.current.reason).toBe('writeai-unavailable')
  })
})
