import { NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'

type Params = { params: Promise<{ chapterId: string }> }

// A chapter with no note row reads as an empty note rather than a 404 — the
// row only comes into existence the first time the writer types something.
export async function GET(_: Request, { params }: Params) {
  const { chapterId } = await params
  const note = await prisma.chapterNote.findUnique({ where: { chapterId } })
  return NextResponse.json({ body: note?.body ?? '' })
}

async function saveNote(chapterId: string, req: Request) {
  let payload: unknown
  try {
    payload = await req.json()
  } catch {
    return NextResponse.json({ error: 'invalid JSON' }, { status: 400 })
  }
  const body = (payload as { body?: unknown } | null)?.body
  if (typeof body !== 'string') {
    return NextResponse.json({ error: 'body must be a string' }, { status: 400 })
  }

  try {
    const note = await prisma.chapterNote.upsert({
      where: { chapterId },
      create: { chapterId, body },
      update: { body },
    })
    return NextResponse.json({ body: note.body })
  } catch (err) {
    // P2003 — the chapter was deleted between the editor loading it and this
    // save landing. Nothing to write the note to.
    if ((err as { code?: string }).code === 'P2003') {
      return NextResponse.json({ error: 'chapter not found' }, { status: 404 })
    }
    throw err
  }
}

export async function PUT(req: Request, { params }: Params) {
  const { chapterId } = await params
  return saveNote(chapterId, req)
}

// Same upsert as PUT, reached only by the unload-time sendBeacon in
// useChapterNotes — beacons can only issue POST, and a note typed seconds
// before closing the tab is exactly the one worth not losing.
export async function POST(req: Request, { params }: Params) {
  const { chapterId } = await params
  return saveNote(chapterId, req)
}
