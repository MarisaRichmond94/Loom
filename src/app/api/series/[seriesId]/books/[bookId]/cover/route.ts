import { NextResponse } from 'next/server'
import { writeFile, mkdir } from 'fs/promises'
import path from 'path'
import { prisma } from '@/lib/prisma'

type Params = { params: Promise<{ bookId: string }> }

export async function POST(req: Request, { params }: Params) {
  const { bookId } = await params
  const formData = await req.formData()
  const file = formData.get('cover') as File | null
  if (!file) return NextResponse.json({ error: 'No file provided' }, { status: 400 })

  const dir = path.join(process.cwd(), 'public', 'covers')
  await mkdir(dir, { recursive: true })

  const ext = file.name.split('.').pop() ?? 'jpg'
  const filename = `${bookId}.${ext}`
  const buffer = Buffer.from(await file.arrayBuffer())
  await writeFile(path.join(dir, filename), buffer)

  // Every upload writes to the SAME filename (`{bookId}.{ext}`), so without a
  // cache-buster every consumer of `coverPath` — the series page, a fresh
  // load of this same book page, preview, export/import round-trips — keeps
  // requesting a URL the browser already has cached and never revalidates
  // (LOOM-143 follow-up: re-uploading a cover showed no visible change
  // because of this, not because of the JPEG quality settings). Versioning
  // the STORED path itself, not just the client's local state, means every
  // reader of `coverPath` gets a URL that's actually unique per upload.
  const coverPath = `/covers/${filename}?v=${Date.now()}`
  await prisma.book.update({ where: { id: bookId }, data: { coverPath } })

  return NextResponse.json({ coverPath })
}
