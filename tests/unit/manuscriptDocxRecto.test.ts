import JSZip from 'jszip'
import { buildManuscriptDocx } from '@/lib/manuscript/docx'
import { EXPORT_FORMATTING_DEFAULTS } from '@/lib/exportFormatting'
import type { ManuscriptChapter } from '@/lib/manuscript/walk'

// The first chapter must open on a front (recto) page. Front matter has a
// variable page count, so the story's section is marked "start on odd page"
// and Pages inserts a blank page only when parity needs one. Verified in a
// real Pages round-trip: the attribute only works on the story's own (final)
// sectPr — on the front matter's closing sectPr Pages ignores it.

const chapter: ManuscriptChapter = {
  id: 'c1',
  label: '1',
  numbered: true,
  pov: null,
  date: null,
  contents: [JSON.stringify({ type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Once.' }] }] })],
  stateByContent: [{}],
} as ManuscriptChapter

async function frontMatterDocx(): Promise<Buffer> {
  const zip = new JSZip()
  zip.file('word/document.xml',
    '<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>' +
    '<w:p><w:r><w:t>Copyright</w:t></w:r></w:p><w:sectPr/></w:body></w:document>')
  return zip.generateAsync({ type: 'nodebuffer' })
}

async function sectPrs(frontMatter: Buffer | null): Promise<string[]> {
  const docx = await buildManuscriptDocx({
    bookTitle: 'Book',
    authorName: 'Author',
    chapters: [chapter],
    formatting: EXPORT_FORMATTING_DEFAULTS,
    frontMatterDocx: frontMatter,
  })
  const xml = await (await JSZip.loadAsync(docx)).file('word/document.xml')!.async('string')
  return [...xml.matchAll(/<w:sectPr>[\s\S]*?<\/w:sectPr>/g)].map(m => m[0])
}

describe('first chapter starts on a recto page', () => {
  it('marks the story section (not the front matter section) as oddPage', async () => {
    const sections = await sectPrs(await frontMatterDocx())
    expect(sections).toHaveLength(2)
    const [fmSection, storySection] = sections
    expect(fmSection).not.toContain('oddPage')
    expect(storySection).toContain('<w:type w:val="oddPage"/>')
    // Schema order: header/footer refs, then type, then pgSz.
    expect(storySection.indexOf('<w:type')).toBeLessThan(storySection.indexOf('<w:pgSz'))
    expect(storySection.lastIndexOf('Reference')).toBeLessThan(storySection.indexOf('<w:type'))
  })

  it('leaves a book without front matter alone — it already starts on page 1', async () => {
    const sections = await sectPrs(null)
    expect(sections).toHaveLength(1)
    expect(sections[0]).not.toContain('oddPage')
  })
})
