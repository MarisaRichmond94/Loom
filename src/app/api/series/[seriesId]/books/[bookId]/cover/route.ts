import { NextResponse } from 'next/server'
import { writeFile } from 'fs/promises'
import path from 'path'
import { prisma } from '@/lib/prisma'

type Params = { params: Promise<{ bookId: string }> }

export async function POST(req: Request, { params }: Params) {
  const { bookId } = await params
  const formData = await req.formData()
  const file = formData.get('cover') as File | null
  if (!file) return NextResponse.json({ error: 'No file provided' }, { status: 400 })

  const ext = file.name.split('.').pop() ?? 'jpg'
  const filename = `${bookId}.${ext}`
  const buffer = Buffer.from(await file.arrayBuffer())
  await writeFile(path.join(process.cwd(), 'public', 'covers', filename), buffer)

  const coverPath = `/covers/${filename}`
  await prisma.book.update({ where: { id: bookId }, data: { coverPath } })

  return NextResponse.json({ coverPath })
}
