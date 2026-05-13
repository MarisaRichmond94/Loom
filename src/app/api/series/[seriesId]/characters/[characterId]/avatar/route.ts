import { NextResponse } from 'next/server'
import { writeFile } from 'fs/promises'
import path from 'path'

type Params = { params: Promise<{ characterId: string }> }

export async function POST(req: Request, { params }: Params) {
  const { characterId } = await params
  const formData = await req.formData()
  const file = formData.get('avatar') as File | null
  if (!file) return NextResponse.json({ error: 'No file' }, { status: 400 })
  const buffer = Buffer.from(await file.arrayBuffer())
  await writeFile(path.join(process.cwd(), 'public', 'characters', `${characterId}.jpg`), buffer)
  return NextResponse.json({ ok: true })
}
