import { NextResponse } from 'next/server'
import { writeFile, mkdir } from 'fs/promises'
import path from 'path'

type Params = { params: Promise<{ characterId: string }> }

export async function POST(req: Request, { params }: Params) {
  const { characterId } = await params
  const formData = await req.formData()
  const file = formData.get('avatar') as File | null
  if (!file) return NextResponse.json({ error: 'No file' }, { status: 400 })
  const dir = path.join(process.cwd(), 'public', 'characters')
  await mkdir(dir, { recursive: true })
  const buffer = Buffer.from(await file.arrayBuffer())
  await writeFile(path.join(dir, `${characterId}.jpg`), buffer)
  return NextResponse.json({ ok: true })
}
