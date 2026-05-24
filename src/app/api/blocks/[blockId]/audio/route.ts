import { NextResponse } from 'next/server'
import { writeFile, unlink, mkdir } from 'fs/promises'
import path from 'path'
import { prisma } from '@/lib/prisma'

type Params = { params: Promise<{ blockId: string }> }

export async function POST(req: Request, { params }: Params) {
  const { blockId } = await params
  const formData = await req.formData()
  const file = formData.get('audio') as File | null
  if (!file) return NextResponse.json({ error: 'No file' }, { status: 400 })

  const dir = path.join(process.cwd(), 'public', 'music')
  await mkdir(dir, { recursive: true })

  const ext = file.name.split('.').pop()?.toLowerCase() ?? 'mp3'
  const audioPath = `/music/${blockId}.${ext}`
  const buffer = Buffer.from(await file.arrayBuffer())
  await writeFile(path.join(process.cwd(), 'public', audioPath), buffer)

  await prisma.contentBlock.update({ where: { id: blockId }, data: { content: audioPath } })
  return NextResponse.json({ audioPath })
}

export async function DELETE(_: Request, { params }: Params) {
  const { blockId } = await params
  const block = await prisma.contentBlock.findUnique({ where: { id: blockId } })
  if (block?.content) {
    await unlink(path.join(process.cwd(), 'public', block.content)).catch(() => null)
  }
  // Sidecar album art lives at /music/<blockId>-art.jpg — without the audio
  // it's orphaned, so clear it too.
  await unlink(path.join(process.cwd(), 'public', 'music', `${blockId}-art.jpg`)).catch(() => null)
  await prisma.contentBlock.update({ where: { id: blockId }, data: { content: null } })
  return NextResponse.json({ ok: true })
}
