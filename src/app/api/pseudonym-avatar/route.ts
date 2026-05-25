import { NextResponse } from 'next/server'
import { writeFile, unlink } from 'fs/promises'
import path from 'path'

// Pseudonym avatar lives as a sidecar at /public/pseudonym-avatar.jpg.
// File existence is the source of truth (same pattern as the canonical
// /public/avatar.jpg); when missing, the bio UI falls back to a blurred
// version of the main avatar.

const DEST = path.join(process.cwd(), 'public', 'pseudonym-avatar.jpg')

export async function POST(req: Request) {
  const formData = await req.formData()
  const file = formData.get('avatar') as File | null
  if (!file) return NextResponse.json({ error: 'No file' }, { status: 400 })
  const buffer = Buffer.from(await file.arrayBuffer())
  await writeFile(DEST, buffer)
  return NextResponse.json({ ok: true })
}

export async function DELETE() {
  await unlink(DEST).catch(() => null)
  return NextResponse.json({ ok: true })
}
