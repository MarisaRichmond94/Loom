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

  const coverPath = `/covers/${filename}`
  await prisma.book.update({ where: { id: bookId }, data: { coverPath } })

  return NextResponse.json({ coverPath })
}
