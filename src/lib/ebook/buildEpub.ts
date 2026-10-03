import { spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import JSZip from 'jszip'
import { openReadOnly } from '@/lib/readonlyDb'
import { normBookTitle } from '@/lib/bookTitleMatch'
import { chapterReader } from '@/lib/manuscript/readChapters'
import { defaultStoryState, walkBook, type ChapterInWalk, type VariableIn } from '@/lib/manuscript/walk'
import { readExportFormatting } from '@/lib/exportFormatting'
import { buildEbookHtml } from '@/lib/ebook/ebookHtml'
import { EBOOK_CSS } from '@/lib/ebook/ebookCss'

/**
 * Builds one book's EPUB from Loom's manuscript (the nightly `generate_ebook.sh`).
 *
 * DATA SAFETY. dev.db is the only copy of the prose, so this touches it in the
 * narrowest way available: `openReadOnly` (writes throw at the SQLite layer),
 * one short read transaction that pulls rows into memory, then the handle is
 * closed before any rendering or pandoc work starts. The editor's writer waits
 * on a lock rather than failing, and the read is held for milliseconds.
 * Nothing here writes anywhere but the EPUB output folder.
 *
 * Canon is the canon export's canon: every variable at its default, no
 * overrides, first branch at an ambiguous choice point. Non-canon books are
 * refused, as they are everywhere else that leaves Loom.
 */

/**
 * Bump when the EPUB's look changes, so every book rebuilds once even though
 * its prose did not.
 */
const FORMAT_VERSION = 'loom-ebook-1'

export type BuildEpubOptions = {
  /** dev.db path (already resolved). */
  dbPath: string
  bookTitle: string
  author: string
  outPath: string
  coverPath?: string
  /** Skip when the content hash matches the last successful build. */
  ifChanged?: boolean
  /** Where per-book content hashes live between runs. */
  stateDir: string
}

export type BuildEpubResult = {
  status: 'built' | 'unchanged'
  chapters: number
  footnotes: number
  warnings: string[]
  readMs: number
}

type Row = { id: string; title: string; seriesId: string; canon: number }

function loadCanonBook(dbPath: string, bookTitle: string) {
  const source = openReadOnly(dbPath)
  source.pragma('busy_timeout = 15000')
  const started = Date.now()
  let chapters: ChapterInWalk[]
  let variables: VariableIn[]
  let book: Row
  try {
    source.exec('BEGIN DEFERRED')
    try {
      const want = normBookTitle(bookTitle)
      const matches = (source.prepare(`SELECT id, title, seriesId, canon FROM Book`).all() as Row[])
        .filter(b => normBookTitle(b.title) === want)
      if (matches.length === 0) throw new Error(`No book titled "${bookTitle}" in ${dbPath}`)
      if (matches.length > 1) throw new Error(`${matches.length} books are titled "${bookTitle}" — refusing to guess which one`)
      book = matches[0]
      if (!book.canon) throw new Error(`"${book.title}" is a non-canon book — it is never exported`)
      variables = source.prepare(
        `SELECT name, type, defaultValue FROM StoryVariable WHERE seriesId = ?`,
      ).all(book.seriesId) as VariableIn[]
      chapters = chapterReader(source)(book.id)
    } finally {
      source.exec('COMMIT')
    }
  } finally {
    source.close()
  }
  return { book, chapters, variables, readMs: Date.now() - started }
}

/**
 * pandoc can only title a TOC entry with its heading's text, and the heading
 * here is just "1." — so the labels are rewritten after the fact, in both the
 * EPUB 3 nav and the EPUB 2 NCX that older readers use. Matched by position,
 * and refused outright if the counts disagree: a TOC whose labels point at the
 * wrong chapters is worse than pandoc's own.
 */
async function patchTocLabels(epubPath: string, labels: string[]): Promise<void> {
  const zip = await JSZip.loadAsync(readFileSync(epubPath))
  const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')

  const navName = Object.keys(zip.files).find(n => n.endsWith('nav.xhtml'))
  const ncxName = Object.keys(zip.files).find(n => n.endsWith('toc.ncx'))
  if (!navName || !ncxName) throw new Error('pandoc output has no nav.xhtml / toc.ncx')

  const nav = await zip.file(navName)!.async('string')
  const tocStart = nav.indexOf('<ol class="toc">')
  const tocEnd = nav.indexOf('</nav>', tocStart)
  if (tocStart < 0 || tocEnd < 0) throw new Error('could not find the TOC list in nav.xhtml')
  let i = 0
  const tocList = nav.slice(tocStart, tocEnd).replace(
    /(<a href="text\/[^"]+">)[\s\S]*?(<\/a>)/g,
    (_m, open, close) => `${open}${esc(labels[i++] ?? '')}${close}`,
  )
  if (i !== labels.length) throw new Error(`TOC has ${i} entries, expected ${labels.length}`)
  zip.file(navName, nav.slice(0, tocStart) + tocList + nav.slice(tocEnd))

  // The NCX's first navPoint is the title page; chapters follow.
  const ncx = await zip.file(ncxName)!.async('string')
  let j = 0
  const patchedNcx = ncx.replace(
    /(<navPoint id="navPoint-(\d+)">\s*<navLabel>\s*<text>)[\s\S]*?(<\/text>)/g,
    (m, open, num, close) => {
      if (num === '0') return m
      return `${open}${esc(labels[j++] ?? '')}${close}`
    },
  )
  if (j !== labels.length) throw new Error(`NCX has ${j} chapter entries, expected ${labels.length}`)
  zip.file(ncxName, patchedNcx)

  // EPUB requires `mimetype` first and uncompressed.
  const mimetype = await zip.file('mimetype')!.async('string')
  zip.remove('mimetype')
  const out = new JSZip()
  out.file('mimetype', mimetype, { compression: 'STORE' })
  for (const [name, entry] of Object.entries(zip.files)) {
    if (entry.dir) continue
    out.file(name, await entry.async('uint8array'), { compression: 'DEFLATE' })
  }
  writeFileSync(epubPath, await out.generateAsync({ type: 'nodebuffer', mimeType: 'application/epub+zip' }))
}

export async function buildEpub(opts: BuildEpubOptions): Promise<BuildEpubResult> {
  const { book, chapters: rawChapters, variables, readMs } = loadCanonBook(opts.dbPath, opts.bookTitle)

  const walk = walkBook(rawChapters, variables, defaultStoryState(variables), {})
  const warnings = [...walk.warnings]
  for (const cp of walk.choicePoints.filter(c => c.ambiguous)) {
    const picked = cp.choices.find(c => c.id === cp.resolvedChoiceId)
    warnings.push(`${cp.chapterLabel}: ambiguous choice point — took the first branch "${picked?.label ?? '?'}".`)
  }
  if (walk.chapters.length === 0) throw new Error(`"${book.title}" has no chapters on the canon path`)

  const formatting = await readExportFormatting()
  const { html, tocLabels } = buildEbookHtml({
    bookTitle: book.title,
    chapters: walk.chapters,
    sectionBreakText: formatting.sectionBreakText,
  })
  const footnotes = (html.match(/role="doc-noteref"/g) ?? []).length

  const hash = createHash('sha256')
  hash.update(JSON.stringify({ FORMAT_VERSION, html, tocLabels, css: EBOOK_CSS, author: opts.author, title: book.title }))
  if (opts.coverPath && existsSync(opts.coverPath)) hash.update(readFileSync(opts.coverPath))
  const contentHash = hash.digest('hex')

  mkdirSync(opts.stateDir, { recursive: true })
  const stateFile = path.join(opts.stateDir, `${book.title.replace(/[/:]/g, '_')}.sha256`)
  const lastHash = existsSync(stateFile) ? readFileSync(stateFile, 'utf8').trim() : ''
  if (opts.ifChanged && lastHash === contentHash && existsSync(opts.outPath)) {
    return { status: 'unchanged', chapters: walk.chapters.length, footnotes, warnings, readMs }
  }

  const work = mkdtempSync(path.join(os.tmpdir(), 'loom-ebook-'))
  try {
    const htmlPath = path.join(work, 'book.html')
    const cssPath = path.join(work, 'book.css')
    const tmpOut = path.join(work, 'book.epub')
    writeFileSync(htmlPath, html)
    writeFileSync(cssPath, EBOOK_CSS)
    const args = [
      htmlPath, '-f', 'html', '-t', 'epub3', '-o', tmpOut,
      '--toc', '--toc-depth=1', '--split-level=1', '--css', cssPath,
      '--metadata', `title=${book.title}`,
      '--metadata', `author=${opts.author}`,
      '--metadata', 'lang=en-US',
    ]
    if (opts.coverPath && existsSync(opts.coverPath)) args.push('--epub-cover-image', opts.coverPath)
    const run = spawnSync('pandoc', args, { encoding: 'utf8' })
    if (run.status !== 0 || !existsSync(tmpOut)) {
      throw new Error(`pandoc failed (${run.status}): ${(run.stderr || run.error?.message || '').trim()}`)
    }
    await patchTocLabels(tmpOut, tocLabels)

    // Swap into place only once the whole file is good — a failed build
    // leaves yesterday's EPUB untouched.
    mkdirSync(path.dirname(opts.outPath), { recursive: true })
    const staged = `${opts.outPath}.loom-tmp`
    writeFileSync(staged, readFileSync(tmpOut))
    renameSync(staged, opts.outPath)
    writeFileSync(stateFile, contentHash + '\n')
  } finally {
    rmSync(work, { recursive: true, force: true })
    rmSync(`${opts.outPath}.loom-tmp`, { force: true })
  }
  return { status: 'built', chapters: walk.chapters.length, footnotes, warnings, readMs }
}
