import { outlineFileName, outlineToMarkdown, summaryHtmlToMarkdown } from '@/lib/outlineExport'
import type { BookChapterRow } from '@/lib/bookChapterTags'

// The outline download. Pinned: it is the whole book in order, her summary is
// never labelled as AI, and tags print as names — never as raw WriteAI ids.

const row = (over: Partial<BookChapterRow> & Pick<BookChapterRow, 'chapterId' | 'title' | 'order'>): BookChapterRow => ({
  chapterNumber: null, offCanon: false, manualSummary: null, pov: null, date: null, numbered: true,
  characters: [], events: [],
  ...over,
})

describe('summaryHtmlToMarkdown', () => {
  it('keeps paragraphs, lists and emphasis, and decodes entities', () => {
    expect(summaryHtmlToMarkdown('<p>Jared&#x27;s <strong>plan</strong>.</p><p><em>Then</em> &amp; after:</p><ul><li><p>one</p></li><li><p>two</p></li></ul>'))
      .toBe("Jared's **plan**.\n\n_Then_ & after:\n\n- one\n- two")
  })

  it('reads an empty editor as nothing', () => {
    expect(summaryHtmlToMarkdown('<p></p>')).toBe('')
  })
})

describe('outlineToMarkdown', () => {
  const md = outlineToMarkdown({
    bookTitle: 'Book Six',
    exportedOn: '2026-10-18',
    rows: [
      row({ chapterId: 'p', title: 'Prologue', order: 1, pov: 'Chase', date: 'June 3',
        characters: [{ id: 'wc-1', nonCanon: false }, { id: 'wc-gone', nonCanon: false }],
        events: [{ id: 'we-1', nonCanon: false }] }),
      row({ chapterId: 'a', title: 'Chapter 1', order: 2 }),
      row({ chapterId: 'b', title: 'Chapter 2', order: 3 }),
    ],
    summaries: {
      p: { html: '<p>Mine.</p>', source: 'writer', canSync: true },
      a: { html: '<p>Machine.</p>', source: 'ai', canSync: false },
      b: { html: '', source: 'empty', canSync: false },
    },
    characterNames: { 'wc-1': 'Chase' },
    eventNames: { 'we-1': 'The fire' },
  })

  it('writes every chapter, in order, with its details', () => {
    expect(md).toBe([
      '# Book Six — Outline',
      '',
      '_Exported from Loom on 2026-10-18 · 3 chapters_',
      '',
      '## Prologue',
      '',
      '**POV:** Chase · **Date:** June 3  ',
      '**Characters:** Chase  ',
      '**Events:** The fire',
      '',
      'Mine.',
      '',
      '## Chapter 1',
      '',
      'Machine.',
      '',
      '_(AI-generated summary)_',
      '',
      '## Chapter 2',
      '',
      '_No summary yet._',
      '',
    ].join('\n'))
  })

  it('never prints a raw WriteAI id', () => {
    expect(md).not.toContain('wc-')
  })
})

describe('outlineFileName', () => {
  it('slugs the title', () => {
    expect(outlineFileName('The Dark Horse: Book Six')).toBe('the-dark-horse-book-six-outline.md')
    expect(outlineFileName('Café')).toBe('cafe-outline.md')
    expect(outlineFileName('???')).toBe('book-outline.md')
  })
})
