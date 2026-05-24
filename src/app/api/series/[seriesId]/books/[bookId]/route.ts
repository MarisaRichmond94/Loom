import { NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { Prisma } from '@/generated/prisma/client'
import { extractText, countWords } from '@/lib/seriesStats'

type Params = { params: Promise<{ bookId: string }> }

export async function GET(_: Request, { params }: Params) {
  const { bookId } = await params
  const book = await prisma.book.findUnique({
    where: { id: bookId },
    include: {
      chapters: {
        include: {
          blocks: {
            include: { choices: true, overrides: true },
          },
        },
      },
    },
  })
  if (!book) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  const chapterCount = book.chapters.length
  const uniquePovs = new Set(book.chapters.map(c => c.pov).filter(Boolean)).size
  const choiceCount = book.chapters.reduce(
    (sum, c) => sum + c.blocks.filter(b => b.type === 'choice_point')
      .reduce((s, b) => s + b.choices.length, 0),
    0
  )
  const wordCount = book.chapters.reduce((sum, c) =>
    sum + c.blocks.reduce((s, b) => {
      const texts = [
        b.content,
        b.baseContent,
        ...(b.overrides.map(o => o.content)),
      ]
      return s + texts.reduce((ws, t) => ws + countWords(extractText(t)), 0)
    }, 0)
  , 0)

  return NextResponse.json({
    ...book,
    stats: { chapterCount, uniquePovs, choiceCount, wordCount },
  })
}

export async function PATCH(req: Request, { params }: Params) {
  const { bookId } = await params
  const { title, order, synopsis, coverPath, published } = await req.json()
  try {
    const book = await prisma.book.update({
      where: { id: bookId },
      data: {
        ...(title !== undefined && { title }),
        ...(order !== undefined && { order }),
        ...(synopsis !== undefined && { synopsis }),
        ...(coverPath !== undefined && { coverPath }),
        ...(published !== undefined && { published }),
      },
    })
    return NextResponse.json(book)
  } catch (e) {
    if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2025') {
      return NextResponse.json({ error: 'Not found' }, { status: 404 })
    }
    throw e
  }
}

export async function DELETE(_: Request, { params }: Params) {
  const { bookId } = await params
  try {
    await prisma.book.delete({ where: { id: bookId } })
    return new NextResponse(null, { status: 204 })
  } catch (e) {
    if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2025') {
      return NextResponse.json({ error: 'Not found' }, { status: 404 })
    }
    throw e
  }
}
