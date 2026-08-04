import { NextResponse } from 'next/server'
import { writeFile, mkdir, unlink } from 'fs/promises'
import path from 'path'
import { isSafeCharacterId } from '@/lib/writerCharacters'

type Params = { params: Promise<{ bookId: string; writerCharacterId: string }> }

// A writer character's portrait IN ONE BOOK — LOOM-87, under LOOM-5.
//
//   POST   — set it        public/characters/<wc-id>-<bookId>.jpg
//   DELETE — revert to the default (WriteAI's photo)
//
// The successor to the Character-era per-book avatar route. Same directory and
// same filename convention; only the left half of the name changes from a Loom
// cuid to a `wc-` id.
//
// ⚠️ Both ids land in a filesystem path, so both are validated here. The
// character id goes through isSafeCharacterId — the same guard the photo
// upload proxy uses, and for a sharper reason there: WriteAI interpolates a
// character id into a GLOB that it then unlinks, so an unvalidated `*` once
// wiped every portrait (LOOM-43). Nothing in this file globs; the path is
// built from two validated ids and nothing else.

const SAFE_BOOK_ID = /^[A-Za-z0-9_-]+$/

function portraitPath(writerCharacterId: string, bookId: string): string | null {
  if (!isSafeCharacterId(writerCharacterId) || !SAFE_BOOK_ID.test(bookId)) return null
  return path.join(process.cwd(), 'public', 'characters', `${writerCharacterId}-${bookId}.jpg`)
}

export async function POST(req: Request, { params }: Params) {
  const { bookId, writerCharacterId } = await params
  const dest = portraitPath(writerCharacterId, bookId)
  if (!dest) return NextResponse.json({ error: 'invalid id' }, { status: 400 })

  const formData = await req.formData()
  const file = formData.get('avatar') as File | null
  if (!file) return NextResponse.json({ error: 'No file' }, { status: 400 })

  await mkdir(path.dirname(dest), { recursive: true })
  await writeFile(dest, Buffer.from(await file.arrayBuffer()))
  return NextResponse.json({ ok: true })
}

// "Use the default portrait in this book." Deletes exactly one file, by exact
// name — never a pattern — and treats an already-absent file as success, so
// the control is idempotent and a double-click cannot fail.
export async function DELETE(_: Request, { params }: Params) {
  const { bookId, writerCharacterId } = await params
  const dest = portraitPath(writerCharacterId, bookId)
  if (!dest) return NextResponse.json({ error: 'invalid id' }, { status: 400 })

  try {
    await unlink(dest)
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== 'ENOENT') throw err
  }
  return NextResponse.json({ ok: true })
}
