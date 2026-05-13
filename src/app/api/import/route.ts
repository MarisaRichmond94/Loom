import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'

export async function POST(req: NextRequest) {
  let payload: ReturnType<typeof JSON.parse>
  try {
    payload = await req.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })
  }

  if (payload.loomVersion !== '1') {
    return NextResponse.json({ error: 'Unsupported export version' }, { status: 400 })
  }

  const { series: s } = payload

  // 1. Create series
  const series = await prisma.series.create({
    data: { title: s.title, description: s.description ?? '' },
  })

  // 2. Variables
  if (s.variables?.length) {
    await prisma.storyVariable.createMany({
      data: s.variables.map((v: { name: string; type: string; defaultValue: string }) => ({
        seriesId: series.id,
        name: v.name,
        type: v.type,
        defaultValue: v.defaultValue,
      })),
    })
  }

  // 3. Books + chapters — collect ref→newId map for choices
  const chapterRefMap: Record<string, string> = {}

  for (const book of s.books ?? []) {
    const newBook = await prisma.book.create({
      data: { seriesId: series.id, title: book.title, synopsis: book.synopsis ?? '', order: book.order },
    })

    for (const chapter of book.chapters ?? []) {
      const newChapter = await prisma.chapter.create({
        data: {
          bookId: newBook.id,
          title: chapter.title,
          order: chapter.order,
          pov: chapter.pov ?? null,
          date: chapter.date ?? null,
        },
      })

      if (chapter._ref) chapterRefMap[chapter._ref] = newChapter.id

      for (const block of chapter.blocks ?? []) {
        const newBlock = await prisma.contentBlock.create({
          data: {
            chapterId: newChapter.id,
            order: block.order,
            type: block.type,
            content: block.content ?? null,
            prompt: block.prompt ?? null,
            displayType: block.displayType ?? null,
          },
        })

        // Overrides
        if (block.overrides?.length) {
          await prisma.conditionalOverride.createMany({
            data: block.overrides.map((o: { order: number; condition: string; content: string }) => ({
              conditionalFragmentId: newBlock.id,
              order: o.order,
              condition: o.condition,
              content: o.content,
            })),
          })
        }

        // Choices — targetChapterRef resolved after all chapters are created
        // Store them temporarily tagged with the block id
        if (block.choices?.length) {
          // We'll resolve targetChapterRef in a second pass — store raw for now
          ;(newBlock as unknown as { _pendingChoices: unknown[] })._pendingChoices = block.choices.map(
            (c: { label: string; setsVariables: string; targetChapterRef: string | null }) => ({
              blockId: newBlock.id,
              label: c.label,
              setsVariables: c.setsVariables,
              targetChapterRef: c.targetChapterRef,
            })
          )
        }
      }
    }
  }

  // 4. Second pass: create all choices now that chapterRefMap is complete
  // Re-fetch blocks to get their choices data (we stored pending choices on the object above — simpler to re-query structure)
  // Instead, rebuild from payload directly using the block creation order
  const choiceData: { choicePointId: string; label: string; setsVariables: string; targetChapterId: string | null }[] = []

  // Walk payload again to collect choices with resolved target IDs
  const allNewBlocks = await prisma.contentBlock.findMany({
    where: { chapter: { book: { seriesId: series.id } } },
    orderBy: [{ chapter: { book: { order: 'asc' } } }, { chapter: { order: 'asc' } }, { order: 'asc' }],
  })

  // Flatten payload blocks in the same order
  const payloadBlocks: { choices: { label: string; setsVariables: string; targetChapterRef: string | null }[] }[] = []
  for (const book of s.books ?? []) {
    for (const chapter of book.chapters ?? []) {
      for (const block of chapter.blocks ?? []) {
        payloadBlocks.push(block)
      }
    }
  }

  for (let i = 0; i < allNewBlocks.length; i++) {
    const pb = payloadBlocks[i]
    if (!pb?.choices?.length) continue
    for (const c of pb.choices) {
      choiceData.push({
        choicePointId: allNewBlocks[i].id,
        label: c.label,
        setsVariables: c.setsVariables,
        targetChapterId: c.targetChapterRef ? (chapterRefMap[c.targetChapterRef] ?? null) : null,
      })
    }
  }

  if (choiceData.length) {
    await prisma.choice.createMany({ data: choiceData })
  }

  return NextResponse.json({ seriesId: series.id })
}
