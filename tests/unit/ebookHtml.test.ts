import { buildEbookHtml, chapterTocLabel, isThemeColor, DEFAULT_SECTION_BREAK } from '@/lib/ebook/ebookHtml'

// The nightly EPUB build. Each case is a formatting rule that the old
// Pages-plain-text pipeline lost silently.

const doc = (...content: unknown[]) => JSON.stringify({ type: 'doc', content })
const p = (...content: unknown[]) => ({ type: 'paragraph', content })
const t = (text: string, ...marks: unknown[]) => (marks.length ? { type: 'text', text, marks } : { type: 'text', text })
const italic = { type: 'italic' }
const note = (content: string) => ({ type: 'footnote', attrs: { content } })

const chapter = (contents: string[], over: Partial<{ label: string; numbered: boolean; pov: string | null; date: string | null }> = {}) => ({
  label: '1', numbered: true, pov: 'Jared Gatlin', ...over,
  contents, stateByContent: contents.map(() => ({})),
})

const build = (contents: string[], over = {}, sectionBreakText?: string) =>
  buildEbookHtml({ bookTitle: 'Book', chapters: [chapter(contents, over)], sectionBreakText })

describe('buildEbookHtml', () => {
  it('heads a numbered chapter with "N." and the POV on its own line', () => {
    const { html, tocLabels } = build([doc(p(t('Hi.')))])
    expect(html).toContain('<h1 class="chapter">1.</h1>')
    expect(html).toContain('<div class="pov"><p>Jared Gatlin</p></div>')
    expect(tocLabels).toEqual(['1 - Jared Gatlin'])
  })

  it('puts the in-story date after the POV, before the prose', () => {
    const { html } = build([doc(p(t('Hi.')))], { date: 'Monday, November 9th' })
    expect(html).toContain('<div class="pov"><p>Jared Gatlin</p></div>\n<div class="date"><p>Monday, November 9th</p></div>\n<p>Hi.</p>')
    expect(build([doc(p(t('Hi.')))]).html).not.toContain('class="date"')
  })

  it('keeps a deliberate blank line (pandoc drops an empty <p>)', () => {
    const blankPara = { type: 'paragraph', attrs: { indent: true } }
    const { html } = build([doc(p(t('a')), blankPara, p(t('b')))])
    expect(html).toContain('<p>a</p><div class="blank"><p>&nbsp;</p></div><p>b</p>')
  })

  it('keeps an unnumbered title as-is', () => {
    const { html } = build([doc(p(t('Hi.')))], { label: 'Prologue', numbered: false })
    expect(html).toContain('<h1 class="chapter">Prologue</h1>')
    expect(chapterTocLabel({ label: 'Prologue', pov: null })).toBe('Prologue')
  })

  it('keeps italics', () => {
    expect(build([doc(p(t('I '), t('know', italic), t('.')))]).html).toContain('I <em>know</em>.')
  })

  it('turns a section break into a centered text line, honouring the export setting', () => {
    const json = doc(p(t('a')), { type: 'horizontalRule' }, p(t('b')))
    expect(build([json]).html).toContain(`<div class="scene-break"><p>${DEFAULT_SECTION_BREAK}</p></div>`)
    expect(build([json], {}, '#').html).toContain('<div class="scene-break"><p>#</p></div>')
  })

  it('keeps deliberate colors and drops near-black theme colors', () => {
    const color = (c: string) => ({ type: 'textStyle', attrs: { color: c } })
    const { html } = build([doc(p(t('text msg', color('#b82b33')), t(' plain', color('rgb(26, 26, 42)'))))])
    expect(html).toMatch(/<span style="color: (#b82b33|rgb\(184, 43, 51\));?">text msg<\/span>/)
    expect(html).not.toContain('26, 26, 42')
    expect(html).toContain(' plain')
  })

  it('makes ONE footnote of a note split across italic boundaries', () => {
    const n = note('The note.')
    const { html } = build([doc(p(t('unusual—', n), t('especially', italic, n), t(' for him.', n), t(' Next.')))])
    expect(html.match(/role="doc-noteref"/g)).toHaveLength(1)
    expect(html).toContain('for him.<a href="#fn1"')
    expect(html).toContain('<li id="fn1"><p>The note.')
  })

  it('numbers distinct footnotes across chapters uniquely', () => {
    const { html } = buildEbookHtml({
      bookTitle: 'B',
      chapters: [
        chapter([doc(p(t('a', note('one'))))]),
        chapter([doc(p(t('b', note('two'))))], { label: '2' }),
      ],
    })
    expect(html).toContain('id="fnref1"')
    expect(html).toContain('id="fnref2"')
  })

  it('carries paragraph-level no-indent through a wrapping div (pandoc drops <p> classes)', () => {
    const json = doc({ type: 'paragraph', attrs: { indent: false }, content: [t('flush')] })
    expect(build([json]).html).toContain('<div class="no-indent"><p>flush</p></div>')
  })

  it('escapes markup in headings and POV', () => {
    const { html } = build([doc(p(t('x')))], { pov: 'A <b>' })
    expect(html).toContain('<p>A &lt;b&gt;</p>')
  })
})

describe('isThemeColor', () => {
  it.each([
    ['rgb(26, 26, 42)', true], ['#000', true], ['#ffffff', true],
    ['#a1a8ab', false], ['#4f4481', false], ['rgb(16, 185, 129)', false], ['', false],
  ])('%s -> %s', (c, want) => expect(isThemeColor(c)).toBe(want))
})
