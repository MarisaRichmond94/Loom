import { NextResponse } from 'next/server'
import { readFile, writeFile, mkdir, rm } from 'fs/promises'
import { tmpdir } from 'os'
import path from 'path'
import { prisma } from '@/lib/prisma'
import { pagesToDocx } from '@/lib/manuscript/pagesConvert'
import {
  FRONT_MATTER_DIR,
  frontMatterDocxPath,
  frontMatterMetaPath,
  readFrontMatterMeta,
  type FrontMatterMeta,
} from '@/lib/frontMatter'

// Per-book front matter (title page, copyright, disclaimer, …) used by the
// manuscript export. Loom doesn't model front matter as content — the
// author keeps writing it in Pages and uploads it here; the export splices
// it ahead of Chapter 1. Stored normalized to .docx (a .pages upload is
// converted through Pages.app on the way in), with a JSON sidecar
// remembering the original filename for the UI.

type Params = { params: Promise<{ bookId: string }> }

export async function GET(_: Request, { params }: Params) {
  const { bookId } = await params
  return NextResponse.json({ frontMatter: await readFrontMatterMeta(bookId) })
}

export async function POST(req: Request, { params }: Params) {
  const { bookId } = await params
  const book = await prisma.book.findUnique({ where: { id: bookId }, select: { id: true } })
  if (!book) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  const formData = await req.formData()
  const file = formData.get('file') as File | null
  if (!file) return NextResponse.json({ error: 'No file provided' }, { status: 400 })

  const lower = file.name.toLowerCase()
  if (!lower.endsWith('.docx') && !lower.endsWith('.pages')) {
    return NextResponse.json({ error: 'Upload a .pages or .docx file' }, { status: 400 })
  }

  await mkdir(FRONT_MATTER_DIR, { recursive: true })
  const buffer = Buffer.from(await file.arrayBuffer())
  const target = frontMatterDocxPath(bookId)

  if (lower.endsWith('.pages')) {
    // Normalize through Pages.app. Temp files carry the book id so a
    // concurrent upload for another book can't collide.
    const tmpPages = path.join(tmpdir(), `loom-fm-${bookId}.pages`)
    const tmpDocx = path.join(tmpdir(), `loom-fm-${bookId}.docx`)
    try {
      await writeFile(tmpPages, buffer)
      await pagesToDocx(tmpPages, tmpDocx)
      await writeFile(target, await readFile(tmpDocx))
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Conversion failed'
      return NextResponse.json({ error: message }, { status: 500 })
    } finally {
      await rm(tmpPages, { force: true }).catch(() => {})
      await rm(tmpDocx, { force: true }).catch(() => {})
    }
  } else {
    await writeFile(target, buffer)
  }

  const meta: FrontMatterMeta = { originalName: file.name, uploadedAt: new Date().toISOString() }
  await writeFile(frontMatterMetaPath(bookId), JSON.stringify(meta, null, 2), 'utf-8')
  return NextResponse.json({ frontMatter: meta })
}

export async function DELETE(_: Request, { params }: Params) {
  const { bookId } = await params
  await rm(frontMatterDocxPath(bookId), { force: true }).catch(() => {})
  await rm(frontMatterMetaPath(bookId), { force: true }).catch(() => {})
  return NextResponse.json({ ok: true })
}
