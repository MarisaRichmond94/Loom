import JSZip from 'jszip'

// Plain-text projection of a built manuscript .docx — the machine-readable
// sidecar WriteAI's sync ingests. One line per paragraph, hard breaks as
// newlines, footnote bodies excluded (they live in word/footnotes.xml):
// the same shape Pages' "export as unformatted text" produces from this
// document, so switching a consumer between the two never churns its view
// of the prose.

function unescapeXml(s: string): string {
  return s
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&#x([0-9a-fA-F]+);/g, (_, h) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(Number(d)))
    .replace(/&amp;/g, '&')
}

// <w:tab/> and <w:br/> must be tried before <w:t …> so the tab tag can't be
// misread as a <w:t> open tag.
const INLINE_RE = /<w:tab\/>|<w:br\/>|<w:t(?: [^>]*)?>([\s\S]*?)<\/w:t>/g

function paragraphText(paraXml: string): string {
  let out = ''
  for (const m of paraXml.matchAll(INLINE_RE)) {
    if (m[0] === '<w:tab/>') out += '\t'
    else if (m[0] === '<w:br/>') out += '\n'
    else out += unescapeXml(m[1])
  }
  return out
}

export async function docxToPlainText(docx: Buffer): Promise<string> {
  const zip = await JSZip.loadAsync(docx)
  const doc = zip.file('word/document.xml')
  if (!doc) throw new Error('word/document.xml missing from docx')
  const xml = await doc.async('string')
  const paragraphs = xml.match(/<w:p[ >][\s\S]*?<\/w:p>/g) ?? []
  return paragraphs.map(paragraphText).join('\n')
}
