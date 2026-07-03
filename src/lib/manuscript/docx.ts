import JSZip from 'jszip'
import type { ExportFormatting, ManuscriptStyle } from '@/lib/exportFormatting'
import type { TemplateStyles } from '@/lib/templateStyles'
import type { ManuscriptChapter } from './walk'
import { serializeTipTapDoc, escapeXml, type FootnoteCollector } from './tiptapToOoxml'

// Assembles a complete .docx (WordprocessingML zip) for a walked manuscript.
// The XML is built by hand rather than through a docx library so the output
// mirrors the author's real Pages exports part-for-part: identical named
// style IDs (Chapter / POV / Date / Body / "Section Breaks" / Footnotes /
// "Header & Footer"), mirrored even/odd running heads, and tab-positioned
// page numbers. Pages opens the result and recognizes everything natively.

const W_NS =
  'xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main" ' +
  'xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" ' +
  'xmlns:wp="http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing" ' +
  'xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" ' +
  'xmlns:pic="http://schemas.openxmlformats.org/drawingml/2006/picture" ' +
  'xmlns:mc="http://schemas.openxmlformats.org/markup-compatibility/2006" ' +
  'xmlns:w14="http://schemas.microsoft.com/office/word/2010/wordml" mc:Ignorable="w14"'

const XML_DECL = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'

// ---- unit helpers ---------------------------------------------------------

const inTwips = (v: number) => Math.round(v * 1440)
const ptHalf = (v: number) => Math.round(v * 2)
const ptTwentieths = (v: number) => Math.round(v * 20)
// w:line with lineRule="auto": 240 = single spacing.
const lineOf = (multiple: number) => Math.round(multiple * 240)

const JC: Record<string, string> = { left: 'left', center: 'center', right: 'right', justify: 'both' }

function colorVal(hex: string): string {
  return hex.replace('#', '').toLowerCase() || '000000'
}

// ---- styles.xml -----------------------------------------------------------

function styleXml(styleId: string, name: string, s: ManuscriptStyle): string {
  const ind = s.firstLineIndentIn ? `<w:ind w:firstLine="${inTwips(s.firstLineIndentIn)}"/>` : ''
  const tracking = s.letterSpacingPt ? `<w:spacing w:val="${ptTwentieths(s.letterSpacingPt)}"/>` : ''
  return (
    `<w:style w:type="paragraph" w:styleId="${escapeXml(styleId)}">` +
    `<w:name w:val="${escapeXml(name)}"/>` +
    '<w:pPr>' +
    `<w:spacing w:before="0" w:after="${ptTwentieths(s.spaceAfterPt)}" w:line="${lineOf(s.lineSpacing)}" w:lineRule="auto"/>` +
    `<w:jc w:val="${JC[s.align] ?? 'left'}"/>` +
    ind +
    '</w:pPr>' +
    '<w:rPr>' +
    `<w:rFonts w:ascii="${escapeXml(s.font)}" w:hAnsi="${escapeXml(s.font)}" w:cs="${escapeXml(s.font)}" w:eastAsia="${escapeXml(s.font)}"/>` +
    `<w:sz w:val="${ptHalf(s.sizePt)}"/><w:szCs w:val="${ptHalf(s.sizePt)}"/>` +
    `<w:color w:val="${colorVal(s.color)}"/>` +
    tracking +
    '</w:rPr>' +
    '</w:style>'
  )
}

// When a template is configured, its exported definition wins over the
// Export-tab numbers for any style it actually carries — the manuscript
// then matches the template exactly instead of Loom's approximation.
function buildStylesXml(f: ExportFormatting, template: TemplateStyles | null): string {
  const body = f.styles.body
  const structural: Array<[string, ManuscriptStyle]> = [
    ['Chapter', f.styles.chapter],
    ['POV', f.styles.pov],
    ['Date', f.styles.date],
    ['Body', f.styles.body],
    ['Section Breaks', f.styles.sectionBreak],
    ['Footnotes', f.styles.footnote],
    ['Header & Footer', f.styles.header],
  ]
  return (
    `${XML_DECL}<w:styles ${W_NS}>` +
    '<w:docDefaults><w:rPrDefault><w:rPr>' +
    `<w:rFonts w:ascii="${escapeXml(body.font)}" w:hAnsi="${escapeXml(body.font)}"/>` +
    `<w:sz w:val="${ptHalf(body.sizePt)}"/><w:szCs w:val="${ptHalf(body.sizePt)}"/>` +
    '</w:rPr></w:rPrDefault><w:pPrDefault/></w:docDefaults>' +
    '<w:style w:type="paragraph" w:default="1" w:styleId="Normal"><w:name w:val="Normal"/></w:style>' +
    structural
      .map(([name, s]) => template?.paragraphBlocks.get(name) ?? styleXml(name, name, s))
      .join('') +
    // The writer's "<color> Text" styles, verbatim from the template, so
    // colored runs/paragraphs can reference them by name.
    (template?.colorStyles.map(s => s.block).join('') ?? '') +
    '</w:styles>'
  )
}

// ---- headers / footers ----------------------------------------------------

// Running heads are tabbed to the page center on both sides (book title on
// odd pages, author on even). Folios mirror: outer-right on odd pages,
// outer-left on even.
function headerFooterTabs(f: ExportFormatting): string {
  const contentWidth = inTwips(f.page.widthIn - f.page.marginLeftIn - f.page.marginRightIn)
  return `<w:tabs><w:tab w:val="center" w:pos="${Math.round(contentWidth / 2)}"/><w:tab w:val="right" w:pos="${contentWidth}"/></w:tabs>`
}

function headerXml(f: ExportFormatting, text: string, centered: boolean): string {
  const runs = (centered ? '<w:r><w:tab/></w:r>' : '') +
    `<w:r><w:t xml:space="preserve">${escapeXml(text)}</w:t></w:r>`
  return (
    `${XML_DECL}<w:hdr ${W_NS}><w:p><w:pPr>` +
    '<w:pStyle w:val="Header &amp; Footer"/>' +
    headerFooterTabs(f) +
    '<w:jc w:val="left"/>' +
    `</w:pPr>${runs}</w:p></w:hdr>`
  )
}

function footerXml(f: ExportFormatting, side: 'odd' | 'even'): string {
  const pageField =
    '<w:r><w:fldChar w:fldCharType="begin"/></w:r>' +
    '<w:r><w:instrText xml:space="preserve"> PAGE </w:instrText></w:r>' +
    '<w:r><w:fldChar w:fldCharType="separate"/></w:r>' +
    '<w:r><w:t>1</w:t></w:r>' +
    '<w:r><w:fldChar w:fldCharType="end"/></w:r>'
  const runs = side === 'odd' ? `<w:r><w:tab/><w:tab/></w:r>${pageField}` : pageField
  return (
    `${XML_DECL}<w:ftr ${W_NS}><w:p><w:pPr>` +
    '<w:pStyle w:val="Header &amp; Footer"/>' +
    headerFooterTabs(f) +
    '<w:jc w:val="left"/>' +
    `</w:pPr>${runs}</w:p></w:ftr>`
  )
}

// ---- footnotes.xml --------------------------------------------------------

function buildFootnotesXml(notes: string[]): string {
  const sep =
    '<w:footnote w:type="separator" w:id="-1"><w:p><w:pPr><w:pStyle w:val="Footnotes"/></w:pPr><w:r><w:separator/></w:r></w:p></w:footnote>' +
    '<w:footnote w:type="continuationSeparator" w:id="0"><w:p><w:pPr><w:pStyle w:val="Footnotes"/></w:pPr><w:r><w:continuationSeparator/></w:r></w:p></w:footnote>'
  const items = notes.map((text, i) =>
    `<w:footnote w:id="${i + 1}"><w:p><w:pPr><w:pStyle w:val="Footnotes"/></w:pPr>` +
    '<w:r><w:rPr><w:vertAlign w:val="superscript"/></w:rPr><w:footnoteRef/></w:r>' +
    `<w:r><w:t xml:space="preserve"> ${escapeXml(text)}</w:t></w:r>` +
    '</w:p></w:footnote>',
  ).join('')
  return `${XML_DECL}<w:footnotes ${W_NS}>${sep}${items}</w:footnotes>`
}

// ---- document body --------------------------------------------------------

function chapterHeadingXml(chapter: ManuscriptChapter): string {
  // Tall empty Chapter-styled spacer pushes the number down the page, then
  // the number (or authored title), POV, and in-story date — the exact
  // opening the author uses in Pages.
  let xml = '<w:p><w:pPr><w:pStyle w:val="Chapter"/></w:pPr></w:p>'
  xml += `<w:p><w:pPr><w:pStyle w:val="Chapter"/></w:pPr><w:r><w:t xml:space="preserve">${escapeXml(chapter.label)}</w:t></w:r></w:p>`
  if (chapter.pov) {
    xml += `<w:p><w:pPr><w:pStyle w:val="POV"/></w:pPr><w:r><w:t xml:space="preserve">${escapeXml(chapter.pov)}</w:t></w:r></w:p>`
  }
  if (chapter.date) {
    xml += `<w:p><w:pPr><w:pStyle w:val="Date"/></w:pPr><w:r><w:t xml:space="preserve">${escapeXml(chapter.date)}</w:t></w:r></w:p>`
  }
  return xml
}

const PAGE_BREAK_P = '<w:p><w:r><w:br w:type="page"/></w:r></w:p>'

function sectPrXml(f: ExportFormatting, withRefs: boolean): string {
  const refs = withRefs
    ? (f.runningHeaders
        ? '<w:headerReference w:type="default" r:id="rIdHdr1"/><w:headerReference w:type="even" r:id="rIdHdr2"/>'
        : '') +
      (f.pageNumbers
        ? '<w:footerReference w:type="default" r:id="rIdFtr1"/><w:footerReference w:type="even" r:id="rIdFtr2"/>'
        : '')
    : ''
  return (
    refs +
    `<w:pgSz w:w="${inTwips(f.page.widthIn)}" w:h="${inTwips(f.page.heightIn)}" w:orient="portrait"/>` +
    `<w:pgMar w:top="${inTwips(f.page.marginTopIn)}" w:right="${inTwips(f.page.marginRightIn)}" ` +
    `w:bottom="${inTwips(f.page.marginBottomIn)}" w:left="${inTwips(f.page.marginLeftIn)}" ` +
    'w:header="720" w:footer="720"/>'
  )
}

// ---- front matter splice --------------------------------------------------

type FrontMatterParts = {
  bodyXml: string
  rels: string[]        // additional <Relationship/> entries for document.xml.rels
  media: Array<{ path: string; data: Uint8Array }>
  extraStyles: string   // fm styles whose ids we don't already define
  contentTypeDefaults: Map<string, string> // extension -> content type
}

const IMAGE_CONTENT_TYPES: Record<string, string> = {
  png: 'image/png', jpeg: 'image/jpeg', jpg: 'image/jpeg', gif: 'image/gif',
  tiff: 'image/tiff', tif: 'image/tiff', bmp: 'image/bmp',
}

// Extracts the body of an uploaded front-matter .docx so it can be spliced
// ahead of the generated chapters: media and hyperlink relationships are
// re-registered under fresh ids, section properties are collapsed to plain
// page breaks (the manuscript owns the section layout), and footnote /
// comment references are dropped (their parts aren't carried over).
async function extractFrontMatter(buffer: Buffer, knownStyleIds: Set<string>): Promise<FrontMatterParts | null> {
  const zip = await JSZip.loadAsync(buffer)
  const docFile = zip.file('word/document.xml')
  if (!docFile) return null
  let xml = await docFile.async('string')
  const bodyMatch = xml.match(/<w:body>([\s\S]*)<\/w:body>/)
  if (!bodyMatch) return null
  let body = bodyMatch[1]

  // Relationship remapping.
  const rels: string[] = []
  const media: FrontMatterParts['media'] = []
  const contentTypeDefaults = new Map<string, string>()
  const relsFile = zip.file('word/_rels/document.xml.rels')
  if (relsFile) {
    const relsXml = await relsFile.async('string')
    const entries = [...relsXml.matchAll(/<Relationship\b[^>]*\/>/g)].map(m => m[0])
    let n = 0
    for (const entry of entries) {
      const id = entry.match(/ Id="([^"]+)"/)?.[1]
      const type = entry.match(/ Type="([^"]+)"/)?.[1] ?? ''
      const target = entry.match(/ Target="([^"]+)"/)?.[1] ?? ''
      const external = / TargetMode="External"/.test(entry)
      if (!id) continue
      if (type.endsWith('/image') && !external) {
        const file = zip.file(`word/${target}`)
        if (!file) continue
        const data = await file.async('uint8array')
        const base = target.split('/').pop() ?? `image${n}`
        const newTarget = `media/fm_${base}`
        const newId = `rIdFM${++n}`
        media.push({ path: `word/${newTarget}`, data })
        rels.push(`<Relationship Id="${newId}" Type="${type}" Target="${newTarget}"/>`)
        body = body.replaceAll(`"${id}"`, `"${newId}"`)
        const ext = base.split('.').pop()?.toLowerCase() ?? ''
        if (IMAGE_CONTENT_TYPES[ext]) contentTypeDefaults.set(ext, IMAGE_CONTENT_TYPES[ext])
      } else if (type.endsWith('/hyperlink') && external) {
        const newId = `rIdFM${++n}`
        // `target` was read out of XML, so it's still entity-encoded.
        rels.push(`<Relationship Id="${newId}" Type="${type}" Target="${target}" TargetMode="External"/>`)
        body = body.replaceAll(`"${id}"`, `"${newId}"`)
      }
      // Everything else (styles, headers, fonts, …) belongs to the uploaded
      // file's own packaging and is intentionally dropped.
    }
  }

  // Section properties → page breaks. A sectPr inside a paragraph's pPr
  // means "this paragraph ends a section"; the trailing body-level sectPr
  // just ends the document.
  body = body.replace(/<w:p\b[^>]*>[\s\S]*?<\/w:p>/g, para => {
    if (!para.includes('<w:sectPr')) return para
    const cleaned = para.replace(/<w:sectPr\b[\s\S]*?<\/w:sectPr>/g, '')
    return cleaned + PAGE_BREAK_P
  })
  body = body.replace(/<w:sectPr\b[\s\S]*?<\/w:sectPr>/g, '')

  // References into parts we don't carry over.
  body = body
    .replace(/<w:footnoteReference\b[^>]*\/>/g, '')
    .replace(/<w:endnoteReference\b[^>]*\/>/g, '')
    .replace(/<w:commentReference\b[^>]*\/>/g, '')
    .replace(/<w:commentRangeStart\b[^>]*\/>/g, '')
    .replace(/<w:commentRangeEnd\b[^>]*\/>/g, '')

  // Carry over fm-only styles so custom front-matter formatting survives.
  // The captured styleId is still XML-escaped ("Header &amp; Footer") —
  // unescape before checking, or styles we already define duplicate.
  // Word's structural boilerplate is skipped outright; it exists in every
  // docx and only pads the style list.
  const boilerplate = new Set(['Normal', 'Default Paragraph Font', 'Table Normal', 'No List', 'Hyperlink'])
  let extraStyles = ''
  const stylesFile = zip.file('word/styles.xml')
  if (stylesFile) {
    const stylesXml = await stylesFile.async('string')
    for (const m of stylesXml.matchAll(/<w:style\b[^>]*w:styleId="([^"]+)"[^>]*>[\s\S]*?<\/w:style>/g)) {
      const id = m[1].replace(/&quot;/g, '"').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&')
      if (!knownStyleIds.has(id) && !boilerplate.has(id)) extraStyles += m[0]
    }
  }

  return { bodyXml: body, rels, media, extraStyles, contentTypeDefaults }
}

// ---- top-level build ------------------------------------------------------

export type BuildManuscriptOptions = {
  bookTitle: string
  authorName: string
  chapters: ManuscriptChapter[]
  formatting: ExportFormatting
  frontMatterDocx?: Buffer | null
  templateStyles?: TemplateStyles | null
}

export async function buildManuscriptDocx(opts: BuildManuscriptOptions): Promise<Buffer> {
  const f = opts.formatting
  const template = opts.templateStyles ?? null
  const footnotes: FootnoteCollector = { notes: [] }

  let chaptersXml = ''
  opts.chapters.forEach((chapter, idx) => {
    if (idx > 0) chaptersXml += PAGE_BREAK_P
    chaptersXml += chapterHeadingXml(chapter)
    chapter.contents.forEach((content, ci) => {
      chaptersXml += serializeTipTapDoc(content, {
        sectionBreakText: f.sectionBreakText,
        storyState: chapter.stateByContent[ci] ?? {},
        colorStyles: template?.colorStyles,
      }, footnotes)
    })
  })

  const knownStyleIds = new Set(['Normal', 'Chapter', 'POV', 'Date', 'Body', 'Section Breaks', 'Footnotes', 'Header & Footer'])
  for (const s of template?.colorStyles ?? []) knownStyleIds.add(s.name)
  const fm = opts.frontMatterDocx
    ? await extractFrontMatter(opts.frontMatterDocx, knownStyleIds)
    : null

  // Front matter lives in its own section with no header/footer references,
  // so running heads and folios only start with the story itself.
  const fmSectionXml = fm
    ? fm.bodyXml + `<w:p><w:pPr>${/* section break */''}<w:sectPr>${sectPrXml(f, false)}</w:sectPr></w:pPr></w:p>`
    : ''

  const documentXml =
    `${XML_DECL}<w:document ${W_NS}><w:body>` +
    fmSectionXml +
    chaptersXml +
    `<w:sectPr>${sectPrXml(f, true)}</w:sectPr>` +
    '</w:body></w:document>'

  let stylesXml = buildStylesXml(f, template)
  if (fm?.extraStyles) stylesXml = stylesXml.replace('</w:styles>', `${fm.extraStyles}</w:styles>`)

  const hasHeaders = f.runningHeaders
  const hasFooters = f.pageNumbers
  const hasNotes = footnotes.notes.length > 0

  const contentTypeDefaults = new Map<string, string>([
    ['rels', 'application/vnd.openxmlformats-package.relationships+xml'],
    ['xml', 'application/xml'],
    ['png', 'image/png'],
    ['jpeg', 'image/jpeg'],
    ['jpg', 'image/jpeg'],
  ])
  for (const [ext, type] of fm?.contentTypeDefaults ?? []) contentTypeDefaults.set(ext, type)

  const overrides: Array<[string, string]> = [
    ['/word/document.xml', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml'],
    ['/word/styles.xml', 'application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml'],
    ['/word/settings.xml', 'application/vnd.openxmlformats-officedocument.wordprocessingml.settings+xml'],
    ['/docProps/core.xml', 'application/vnd.openxmlformats-package.core-properties+xml'],
    ['/docProps/app.xml', 'application/vnd.openxmlformats-officedocument.extended-properties+xml'],
  ]
  if (hasNotes) overrides.push(['/word/footnotes.xml', 'application/vnd.openxmlformats-officedocument.wordprocessingml.footnotes+xml'])
  if (hasHeaders) {
    overrides.push(['/word/header1.xml', 'application/vnd.openxmlformats-officedocument.wordprocessingml.header+xml'])
    overrides.push(['/word/header2.xml', 'application/vnd.openxmlformats-officedocument.wordprocessingml.header+xml'])
  }
  if (hasFooters) {
    overrides.push(['/word/footer1.xml', 'application/vnd.openxmlformats-officedocument.wordprocessingml.footer+xml'])
    overrides.push(['/word/footer2.xml', 'application/vnd.openxmlformats-officedocument.wordprocessingml.footer+xml'])
  }

  const contentTypesXml =
    `${XML_DECL}<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">` +
    [...contentTypeDefaults].map(([ext, type]) => `<Default Extension="${ext}" ContentType="${type}"/>`).join('') +
    overrides.map(([part, type]) => `<Override PartName="${part}" ContentType="${type}"/>`).join('') +
    '</Types>'

  const docRels: string[] = [
    '<Relationship Id="rIdStyles" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>',
    '<Relationship Id="rIdSettings" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/settings" Target="settings.xml"/>',
  ]
  if (hasNotes) docRels.push('<Relationship Id="rIdFootnotes" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/footnotes" Target="footnotes.xml"/>')
  if (hasHeaders) {
    docRels.push('<Relationship Id="rIdHdr1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/header" Target="header1.xml"/>')
    docRels.push('<Relationship Id="rIdHdr2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/header" Target="header2.xml"/>')
  }
  if (hasFooters) {
    docRels.push('<Relationship Id="rIdFtr1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/footer" Target="footer1.xml"/>')
    docRels.push('<Relationship Id="rIdFtr2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/footer" Target="footer2.xml"/>')
  }
  if (fm) docRels.push(...fm.rels)

  const docRelsXml =
    `${XML_DECL}<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${docRels.join('')}</Relationships>`

  const rootRelsXml =
    `${XML_DECL}<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">` +
    '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>' +
    '<Relationship Id="rId2" Type="http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties" Target="docProps/core.xml"/>' +
    '<Relationship Id="rId3" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/extended-properties" Target="docProps/app.xml"/>' +
    '</Relationships>'

  const settingsXml =
    `${XML_DECL}<w:settings ${W_NS}>` +
    ((hasHeaders || hasFooters) ? '<w:evenAndOddHeaders w:val="true"/>' : '') +
    '</w:settings>'

  const coreXml =
    `${XML_DECL}<cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties" ` +
    'xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:dcterms="http://purl.org/dc/terms/" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance">' +
    `<dc:title>${escapeXml(opts.bookTitle)}</dc:title>` +
    `<dc:creator>${escapeXml(opts.authorName)}</dc:creator>` +
    '</cp:coreProperties>'

  const appXml =
    `${XML_DECL}<Properties xmlns="http://schemas.openxmlformats.org/officeDocument/2006/extended-properties">` +
    '<Application>Loom</Application></Properties>'

  const zip = new JSZip()
  zip.file('[Content_Types].xml', contentTypesXml)
  zip.file('_rels/.rels', rootRelsXml)
  zip.file('word/document.xml', documentXml)
  zip.file('word/styles.xml', stylesXml)
  zip.file('word/settings.xml', settingsXml)
  zip.file('word/_rels/document.xml.rels', docRelsXml)
  zip.file('docProps/core.xml', coreXml)
  zip.file('docProps/app.xml', appXml)
  if (hasNotes) zip.file('word/footnotes.xml', buildFootnotesXml(footnotes.notes))
  if (hasHeaders) {
    zip.file('word/header1.xml', headerXml(f, opts.bookTitle, true))
    zip.file('word/header2.xml', headerXml(f, opts.authorName, true))
  }
  if (hasFooters) {
    zip.file('word/footer1.xml', footerXml(f, 'odd'))
    zip.file('word/footer2.xml', footerXml(f, 'even'))
  }
  for (const m of fm?.media ?? []) zip.file(m.path, m.data)

  return zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE' })
}
