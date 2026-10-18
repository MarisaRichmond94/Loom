import { buildAiSummaries, resolveSummary, summaryToHtml } from '@/lib/outlineSummaries'
import type { OutlineCard } from '@/lib/writerOutline'

// The precedence the writer set: a summary she wrote ALWAYS wins. These pin the
// three ChapterSummary states and the legacy WriteAI-side edit.

const card = (over: Partial<OutlineCard>): OutlineCard => ({
  id: 'x', book: 1, chapter: 1, position: 1, status: 'synced', heading: 'Chapter 1', pov: '', date: null,
  writer_summary: '', extracted_bullets: [], notes: null, loom_id: 'c1', summary_source: '',
  ...over,
})

describe('buildAiSummaries', () => {
  it('reads an untouched machine summary as AI, not as the writer’s', () => {
    // Byte-different, same text: TipTap re-serialised the entity on load.
    const ai = buildAiSummaries([card({ summary_source: '<p>Jared&#x27;s plan.</p>', writer_summary: "<p>Jared's plan.</p>" })])
    expect(ai.c1).toEqual({ aiHtml: '<p>Jared&#x27;s plan.</p>', legacyWriterHtml: null })
  })

  it('keeps a summary the writer typed into WriteAI’s card', () => {
    const ai = buildAiSummaries([card({ summary_source: '<p>Machine.</p>', writer_summary: '<p>Mine.</p>' })])
    expect(ai.c1).toEqual({ aiHtml: '<p>Machine.</p>', legacyWriterHtml: '<p>Mine.</p>' })
  })

  it('falls back to the extracted bullets, escaped', () => {
    const ai = buildAiSummaries([card({ extracted_bullets: ['A <b>', ' '] })])
    expect(ai.c1.aiHtml).toBe('<ul><li><p>A &lt;b&gt;</p></li></ul>')
  })

  it('skips cards with no Loom chapter behind them', () => {
    expect(buildAiSummaries([card({ loom_id: null, summary_source: '<p>x</p>' })])).toEqual({})
  })
})

describe('resolveSummary', () => {
  const ai = { aiHtml: '<p>AI.</p>', legacyWriterHtml: null }

  it('shows the writer’s summary over the AI one, and offers Sync', () => {
    expect(resolveSummary('<p>Mine.</p>', ai)).toEqual({ html: '<p>Mine.</p>', source: 'writer', canSync: true })
  })

  it('shows the AI summary when the writer has none', () => {
    expect(resolveSummary(null, ai)).toEqual({ html: '<p>AI.</p>', source: 'ai', canSync: false })
  })

  it('treats "" as the writer choosing the AI summary', () => {
    expect(resolveSummary('', ai)).toEqual({ html: '<p>AI.</p>', source: 'ai', canSync: false })
  })

  it('treats a legacy WriteAI-side edit as the writer’s — until she syncs', () => {
    const legacy = { aiHtml: '<p>AI.</p>', legacyWriterHtml: '<p>Old mine.</p>' }
    expect(resolveSummary(null, legacy)).toEqual({ html: '<p>Old mine.</p>', source: 'writer', canSync: true })
    expect(resolveSummary('', legacy)).toEqual({ html: '<p>AI.</p>', source: 'ai', canSync: false })
  })

  it('never offers Sync when there is nothing to sync to', () => {
    expect(resolveSummary('<p>Mine.</p>', undefined)).toEqual({ html: '<p>Mine.</p>', source: 'writer', canSync: false })
    expect(resolveSummary(null, undefined)).toEqual({ html: '', source: 'empty', canSync: false })
  })

  it('turns a plain-text summary into paragraphs', () => {
    expect(resolveSummary('Line one\nLine <two>', undefined).html).toBe('<p>Line one</p><p>Line &lt;two&gt;</p>')
  })
})

describe('summaryToHtml', () => {
  it('passes HTML through untouched', () => {
    expect(summaryToHtml('<p>a</p>')).toBe('<p>a</p>')
  })
})
