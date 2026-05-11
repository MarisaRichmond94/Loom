import { NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'

type Params = { params: Promise<{ bookId: string }> }

export async function PATCH(req: Request, { params }: Params) {
  const { bookId } = await params
  const data = await req.json()
  const book = await prisma.book.update({ where: { id: bookId }, data })
  return NextResponse.json(book)
}

export async function DELETE(_: Request, { params }: Params) {
  const { bookId } = await params
  await prisma.book.delete({ where: { id: bookId } })
  return new NextResponse(null, { status: 204 })
}
