import { NextResponse } from 'next/server'
import { readFile, writeFile, mkdir, rm } from 'fs/promises'
import { tmpdir } from 'os'
import path from 'path'
import { walkBook } from '@/lib/manuscript/walk'
import { loadManuscriptBook, coerceTargetState } from '@/lib/manuscript/loadBook'
import { buildManuscriptDocx } from '@/lib/manuscript/docx'
import { docxToPages } from '@/lib/manuscript/pagesConvert'
import { readExportFormatting } from '@/lib/exportFormatting'
import { readProfileSettings } from '@/lib/profileSettings'
import { readFrontMatterDocx } from '@/lib/frontMatter'
import { loadTemplateStyles, type TemplateStyles } from '@/lib/templateStyles'

// Generates the flattened manuscript for one book under the writer's chosen
// context and streams it back as a download. format 'pages' (default) runs
// the generated .docx through Pages.app for a native .pages file; 'docx'
// skips the conversion.

type Params = { params: Promise<{ seriesId: string; bookId: string }> }

export async function POST(req: Request, { params }: Params) {
  const { seriesId, bookId } = await params
  const data = await loadManuscriptBook(seriesId, bookId)
  if (!data) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  const body = await req.json().catch(() => ({})) as {
    targetState?: Record<string, unknown>
    choiceOverrides?: Record<string, string>
    format?: 'pages' | 'docx'
  }
  const format = body.format === 'docx' ? 'docx' : 'pages'

  const result = walkBook(
    data.chapters,
    data.variables,
    coerceTargetState(body.targetState, data.variables),
    body.choiceOverrides ?? {},
  )

  const unresolved = result.choicePoints.filter(cp => cp.ambiguous)
  if (unresolved.length > 0) {
    return NextResponse.json({
      error: 'Some choice points need a decision before exporting.',
      choicePoints: unresolved,
    }, { status: 422 })
  }

  // A configured-but-broken template downgrades to the built-in styles
  // with a warning rather than blocking the export.
  let templateStyles: TemplateStyles | null = null
  try {
    templateStyles = await loadTemplateStyles()
  } catch (err) {
    result.warnings.push(`Manuscript template unavailable (${err instanceof Error ? err.message : 'unknown error'}) — used built-in styles.`)
  }

  const [formatting, profile, frontMatter] = await Promise.all([
    readExportFormatting(),
    readProfileSettings(),
    readFrontMatterDocx(bookId),
  ])
  const authorName = (profile.pseudonymEnabled && profile.pseudonym.trim())
    ? profile.pseudonym.trim()
    : profile.authorName.trim() || 'Unknown Author'

  const docx = await buildManuscriptDocx({
    bookTitle: data.bookTitle,
    authorName,
    chapters: result.chapters,
    formatting,
    frontMatterDocx: frontMatter,
    templateStyles,
  })

  const safeTitle = data.bookTitle.replace(/[^a-z0-9 _-]/gi, '').trim() || 'Manuscript'

  if (format === 'docx') {
    return new NextResponse(new Uint8Array(docx), {
      headers: {
        'Content-Type': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
        'Content-Disposition': `attachment; filename="${safeTitle}.docx"`,
        'X-Export-Warnings': encodeURIComponent(JSON.stringify(result.warnings)),
      },
    })
  }

  // Round-trip through Pages.app for a native .pages file.
  const workDir = path.join(tmpdir(), `loom-export-${bookId}-${Date.now()}`)
  const docxPath = path.join(workDir, `${safeTitle}.docx`)
  const pagesPath = path.join(workDir, `${safeTitle}.pages`)
  try {
    await mkdir(workDir, { recursive: true })
    await writeFile(docxPath, docx)
    await docxToPages(docxPath, pagesPath)
    const pages = await readFile(pagesPath)
    return new NextResponse(new Uint8Array(pages), {
      headers: {
        'Content-Type': 'application/vnd.apple.pages',
        'Content-Disposition': `attachment; filename="${safeTitle}.pages"`,
        'X-Export-Warnings': encodeURIComponent(JSON.stringify(result.warnings)),
      },
    })
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Export failed'
    return NextResponse.json({ error: message }, { status: 500 })
  } finally {
    await rm(workDir, { recursive: true, force: true }).catch(() => {})
  }
}
