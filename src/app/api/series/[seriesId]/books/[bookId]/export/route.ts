import { NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'

type Params = { params: Promise<{ seriesId: string; bookId: string }> }

export async function GET(_: Request, { params }: Params) {
  const { seriesId, bookId } = await params

  const series = await prisma.series.findUnique({
    where: { id: seriesId },
    select: {
      title: true,
      description: true,
      genres: true,
      keywords: true,
      variables: true,
      characters: { include: { overrides: true } },
    },
  })
  if (!series) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  const book = await prisma.book.findUnique({
    where: { id: bookId },
    include: {
      chapters: {
        orderBy: { order: 'asc' },
        include: {
          blocks: {
            orderBy: { order: 'asc' },
            include: {
              choices: true,
              overrides: { orderBy: { order: 'asc' } },
            },
          },
        },
      },
    },
  })
  if (!book) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  const payload = {
    loomVersion: '2',
    exportedAt: new Date().toISOString(),
    series: {
      title: series.title,
      description: series.description,
      genres: series.genres ?? '[]',
      keywords: series.keywords ?? '[]',
      variables: series.variables.map(v => ({
        name: v.name,
        type: v.type,
        defaultValue: v.defaultValue,
      })),
      characters: series.characters.map(c => ({
        _ref: c.id,
        name: c.name,
        age: c.age,
        // Single-book export: only this book is a valid ref target.
        firstBookRef: c.firstBookId === book.id ? book.id : null,
        deathBookRef: c.deathBookId === book.id ? book.id : null,
        overrides: c.overrides
          .filter(o => o.bookId === book.id)
          .map(o => ({ bookRef: o.bookId, age: o.age })),
      })),
      books: [{
        _ref: book.id,
        title: book.title,
        synopsis: book.synopsis,
        coverPath: book.coverPath,
        order: book.order,
        chapters: book.chapters.map(chapter => ({
          _ref: chapter.id,
          title: chapter.title,
          order: chapter.order,
          pov: chapter.pov,
          date: chapter.date,
          condition: chapter.condition,
          numbered: chapter.numbered,
          blocks: chapter.blocks.map(block => ({
            order: block.order,
            type: block.type,
            content: block.content,
            prompt: block.prompt,
            displayType: block.displayType,
            condition: block.condition,
            pinStart: block.pinStart,
            pinEnd: block.pinEnd,
            choices: block.choices.map(c => ({
              label: c.label,
              setsVariables: c.setsVariables,
              targetChapterRef: c.targetChapterId,
              endingMessage: c.endingMessage,
            })),
            overrides: block.overrides.map(o => ({
              order: o.order,
              condition: o.condition,
              content: o.content,
              endingMessage: o.endingMessage,
            })),
          })),
        })),
      }],
    },
  }

  const filename = `${book.title.replace(/[^a-z0-9]/gi, '_')}_${new Date().toISOString().slice(0, 10)}.loom.json`

  return new NextResponse(JSON.stringify(payload, null, 2), {
    headers: {
      'Content-Type': 'application/json',
      'Content-Disposition': `attachment; filename="${filename}"`,
    },
  })
}
