import { NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { Prisma } from '@/generated/prisma/client'

type Params = { params: Promise<{ bookId: string }> }

function extractText(json: string | null | undefined): string {
  if (!json) return ''
  try {
    const walk = (node: Record<string, unknown>): string => {
      if (node.type === 'text') return (node.text as string) ?? ''
      const children = (node.content as Record<string, unknown>[] | undefined) ?? []
      return children.map(walk).join(' ')
    }
    return walk(JSON.parse(json))
  } catch { return '' }
}

function countWords(text: string): number {
  return text.trim().split(/\s+/).filter(Boolean).length
}

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
  const { title, order, synopsis, coverPath } = await req.json()
  try {
    const book = await prisma.book.update({
      where: { id: bookId },
      data: {
        ...(title !== undefined && { title }),
        ...(order !== undefined && { order }),
        ...(synopsis !== undefined && { synopsis }),
        ...(coverPath !== undefined && { coverPath }),
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
