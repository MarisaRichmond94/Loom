import { NextResponse } from 'next/server'
import { access, copyFile, mkdir, readdir, rename, rm, writeFile } from 'fs/promises'
import { createHash } from 'crypto'
import { tmpdir } from 'os'
import path from 'path'
import { defaultStoryState, walkBook } from '@/lib/manuscript/walk'
import { loadManuscriptBook } from '@/lib/manuscript/loadBook'
import { buildManuscriptDocx } from '@/lib/manuscript/docx'
import { docxToPages } from '@/lib/manuscript/pagesConvert'
import { readExportFormatting } from '@/lib/exportFormatting'
import { readProfileSettings } from '@/lib/profileSettings'
import { readFrontMatterDocx } from '@/lib/frontMatter'
import { readCanonExportSettings } from '@/lib/canonExportSettings'
import { loadTemplateStyles, type TemplateStyles } from '@/lib/templateStyles'

// One-shot "save canon to disk" export (the ⌥⇧E hotkey). Unlike the
// interactive export, nothing is asked of the writer: canon means every
// variable at its default value, and — since writers write the canon branch
// first — the first non-bad-ending branch wherever a choice point can't be
// auto-resolved. Ambiguous points become warnings instead of blocking.
//
// The destination comes from the canon-export settings (Settings → Export):
// a root folder holding one folder per book named "<n>. <Book Title>", and
// a subfolder within the matched book folder (empty = the book folder
// itself). We match by the title after the numeric prefix rather than
// hardcoding paths per book. The file is named "<Book Title>.<ext>" and
// each save overwrites the last — it's the book's current canon, not an
// archive.

// Apostrophes and unicode composition are the realistic ways a folder name
// and a DB title can drift apart while still "being" the same title.
function normalizeTitle(s: string): string {
  return s.normalize('NFC').replace(/[‘’]/g, "'").trim().toLowerCase()
}

async function findDestDir(bookTitle: string): Promise<{ dir: string } | { error: string }> {
  const { root, subfolder } = await readCanonExportSettings()
  let entries
  try {
    entries = await readdir(root, { withFileTypes: true })
  } catch {
    return { error: `Canon save folder not found at ${root}. Set it under Settings → Export.` }
  }
  const want = normalizeTitle(bookTitle)
  const matches = entries
    .filter(e => e.isDirectory())
    .filter(e => normalizeTitle(e.name.replace(/^\d+\.\s*/, '')) === want)
  if (matches.length === 0) {
    return { error: `No folder matching "${bookTitle}" in ${root}.` }
  }
  if (matches.length > 1) {
    return { error: `Multiple folders match "${bookTitle}": ${matches.map(m => m.name).join(', ')}.` }
  }
  const dir = path.join(root, matches[0].name, subfolder)
  await mkdir(dir, { recursive: true })
  return { dir }
}

// Content hash of the last successful export per destination path, so an
// autosave that changed nothing (blur without edits, re-visits) skips the
// Pages round-trip entirely — by far the most failure-prone step. Lives on
// globalThis to survive dev-HMR module reloads; a server restart just means
// one extra real export.
const g = globalThis as typeof globalThis & { __loomCanonHashes?: Map<string, string> }
function canonHashes(): Map<string, string> {
  if (!g.__loomCanonHashes) g.__loomCanonHashes = new Map()
  return g.__loomCanonHashes
}

type Params = { params: Promise<{ seriesId: string; bookId: string }> }

export async function POST(req: Request, { params }: Params) {
  const { seriesId, bookId } = await params
  const data = await loadManuscriptBook(seriesId, bookId)
  if (!data) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  const body = await req.json().catch(() => ({})) as { format?: 'pages' | 'docx'; chapterId?: string }
  const format = body.format === 'docx' ? 'docx' : 'pages'

  const dest = await findDestDir(data.bookTitle)
  if ('error' in dest) return NextResponse.json({ error: dest.error }, { status: 422 })

  // Every variable at its default value + no overrides = pure canon walk.
  const result = walkBook(data.chapters, data.variables, defaultStoryState(data.variables), {})
  const warnings = [...result.warnings]
  for (const cp of result.choicePoints.filter(c => c.ambiguous)) {
    const picked = cp.choices.find(c => c.id === cp.resolvedChoiceId)
    warnings.push(`${cp.chapterLabel}: ambiguous choice point — took the first branch "${picked?.label ?? '?'}".`)
  }

  // When the caller passes a chapterId (the Review-in-WriteAI hand-off), map
  // it to the chapter's position in this manuscript, the way WriteAI's
  // chunker will read it back: a bare-number heading is that chapter's
  // number, a literal "Prologue" heading is 0. Anything else — including a
  // chapter the canon walk skipped — isn't addressable there, so null.
  let reviewChapter: number | null = null
  if (body.chapterId) {
    const walked = result.chapters.find(c => c.id === body.chapterId)
    if (walked?.numbered) reviewChapter = Number(walked.label)
    else if (walked && walked.label.trim().toLowerCase() === 'prologue') reviewChapter = 0
  }

  // A configured-but-broken template (moved file, Pages hiccup) downgrades
  // to the built-in styles with a warning rather than blocking the save.
  let templateStyles: TemplateStyles | null = null
  try {
    templateStyles = await loadTemplateStyles()
  } catch (err) {
    warnings.push(`Manuscript template unavailable (${err instanceof Error ? err.message : 'unknown error'}) — used built-in styles.`)
  }

  const [formatting, profile, frontMatter] = await Promise.all([
    readExportFormatting(),
    readProfileSettings(),
    readFrontMatterDocx(bookId),
  ])
  const authorName = (profile.pseudonymEnabled && profile.pseudonym.trim())
    ? profile.pseudonym.trim()
    : profile.authorName.trim() || 'Unknown Author'

  const safeTitle = data.bookTitle.replace(/[/\\:]/g, '-').trim() || 'Manuscript'
  const outPath = path.join(dest.dir, `${safeTitle}.${format}`)

  // Hash every input that shapes the output file (the docx bytes themselves
  // are nondeterministic — JSZip stamps entry dates). If nothing changed
  // since the last successful export to this path and the file is still
  // there, skip the whole build + Pages round-trip.
  const hash = createHash('sha256')
  hash.update(JSON.stringify({ chapters: result.chapters, formatting, authorName, templateStyles, format }))
  if (frontMatter) hash.update(frontMatter)
  const contentHash = hash.digest('hex')
  if (canonHashes().get(outPath) === contentHash) {
    const stillThere = await access(outPath).then(() => true, () => false)
    if (stillThere) return NextResponse.json({ ok: true, path: outPath, warnings, reviewChapter, skipped: true })
  }

  const docx = await buildManuscriptDocx({
    bookTitle: data.bookTitle,
    authorName,
    chapters: result.chapters,
    formatting,
    frontMatterDocx: frontMatter,
    templateStyles,
  })

  if (format === 'docx') {
    // Write-then-rename so a failure mid-write never leaves a truncated
    // manuscript at the destination.
    const tmpPath = `${outPath}.loom-tmp`
    await writeFile(tmpPath, docx)
    await rename(tmpPath, outPath)
    canonHashes().set(outPath, contentHash)
    return NextResponse.json({ ok: true, path: outPath, warnings, reviewChapter })
  }

  const workDir = path.join(tmpdir(), `loom-canon-${bookId}-${Date.now()}`)
  try {
    await mkdir(workDir, { recursive: true })
    const docxPath = path.join(workDir, `${safeTitle}.docx`)
    const pagesPath = path.join(workDir, `${safeTitle}.pages`)
    await writeFile(docxPath, docx)
    await docxToPages(docxPath, pagesPath)
    const tmpPath = `${outPath}.loom-tmp`
    await copyFile(pagesPath, tmpPath)
    await rename(tmpPath, outPath)
    canonHashes().set(outPath, contentHash)
    return NextResponse.json({ ok: true, path: outPath, warnings, reviewChapter })
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Canon export failed'
    return NextResponse.json({ error: message }, { status: 500 })
  } finally {
    await rm(workDir, { recursive: true, force: true }).catch(() => {})
    await rm(`${outPath}.loom-tmp`, { force: true }).catch(() => {})
  }
}
