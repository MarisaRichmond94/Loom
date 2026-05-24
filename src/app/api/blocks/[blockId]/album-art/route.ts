import { NextResponse } from 'next/server'
import { writeFile, unlink, mkdir } from 'fs/promises'
import path from 'path'

type Params = { params: Promise<{ blockId: string }> }

// Album art for a soundtrack block. Saved as a sidecar to the audio file at
// /public/music/<blockId>-art.jpg, so file existence is the source of truth
// (same pattern as character avatars). No DB column needed.
export async function POST(req: Request, { params }: Params) {
  const { blockId } = await params
  const formData = await req.formData()
  const file = formData.get('art') as File | null
  if (!file) return NextResponse.json({ error: 'No file' }, { status: 400 })

  const dir = path.join(process.cwd(), 'public', 'music')
  await mkdir(dir, { recursive: true })
  const buffer = Buffer.from(await file.arrayBuffer())
  await writeFile(path.join(dir, `${blockId}-art.jpg`), buffer)
  return NextResponse.json({ ok: true })
}

export async function DELETE(_: Request, { params }: Params) {
  const { blockId } = await params
  const dest = path.join(process.cwd(), 'public', 'music', `${blockId}-art.jpg`)
  await unlink(dest).catch(() => null)
  return NextResponse.json({ ok: true })
}
