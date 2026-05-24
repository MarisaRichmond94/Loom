import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'

export async function POST(req: NextRequest) {
  let payload: ReturnType<typeof JSON.parse>
  try {
    payload = await req.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })
  }

  if (payload.loomVersion !== '1' && payload.loomVersion !== '2') {
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

  // 2b. Characters (v2+). Preserve original IDs so character marks in block content
  // still resolve and avatar files (named <charId>.jpg) line up after asset restore.
  // firstBookId + overrides are deferred to a second pass once books exist.
  if (s.characters?.length) {
    await prisma.character.createMany({
      data: s.characters.map((c: { _ref: string; name: string; age: number | null }) => ({
        id: c._ref,
        seriesId: series.id,
        name: c.name,
        age: c.age,
      })),
    })
  }

  // 3. Books + chapters — collect ref→newId maps for choices and character refs
  const chapterRefMap: Record<string, string> = {}
  const bookRefMap: Record<string, string> = {}

  for (const book of s.books ?? []) {
    const newBook = await prisma.book.create({
      data: {
        seriesId: series.id,
        title: book.title,
        synopsis: book.synopsis ?? '',
        coverPath: book.coverPath ?? null,
        order: book.order,
      },
    })
    if (book._ref) bookRefMap[book._ref] = newBook.id

    for (const chapter of book.chapters ?? []) {
      const newChapter = await prisma.chapter.create({
        data: {
          bookId: newBook.id,
          title: chapter.title,
          order: chapter.order,
          pov: chapter.pov ?? null,
          date: chapter.date ?? null,
          condition: chapter.condition ?? null,
          numbered: chapter.numbered ?? true,
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
            condition: block.condition ?? null,
            pinStart: block.pinStart ?? null,
            pinEnd: block.pinEnd ?? null,
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
  const choiceData: { choicePointId: string; label: string; setsVariables: string; targetChapterId: string | null; endingMessage: string | null }[] = []

  // Walk payload again to collect choices with resolved target IDs
  const allNewBlocks = await prisma.contentBlock.findMany({
    where: { chapter: { book: { seriesId: series.id } } },
    orderBy: [{ chapter: { book: { order: 'asc' } } }, { chapter: { order: 'asc' } }, { order: 'asc' }],
  })

  // Flatten payload blocks in the same order
  const payloadBlocks: { choices: { label: string; setsVariables: string; targetChapterRef: string | null; endingMessage?: string | null }[] }[] = []
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
        endingMessage: c.endingMessage ?? null,
      })
    }
  }

  if (choiceData.length) {
    await prisma.choice.createMany({ data: choiceData })
  }

  // 5. Character per-book metadata (v2+): firstBookId + deathBookId +
  // CharacterBookOverride rows. Deferred until now because all of these
  // depend on bookRefMap being complete.
  type ImportedChar = {
    _ref: string
    firstBookRef?: string | null
    deathBookRef?: string | null
    overrides?: { bookRef: string; age: number | null }[]
  }
  const overrideRows: { characterId: string; bookId: string; age: number | null }[] = []
  for (const c of (s.characters ?? []) as ImportedChar[]) {
    const firstBookId = c.firstBookRef ? (bookRefMap[c.firstBookRef] ?? null) : null
    const deathBookId = c.deathBookRef ? (bookRefMap[c.deathBookRef] ?? null) : null
    if (firstBookId || deathBookId) {
      await prisma.character.update({
        where: { id: c._ref },
        data: {
          ...(firstBookId ? { firstBookId } : {}),
          ...(deathBookId ? { deathBookId } : {}),
        },
      })
    }
    for (const o of c.overrides ?? []) {
      const bookId = bookRefMap[o.bookRef]
      // Skip overrides for books not in the import (single-book export edge case).
      if (!bookId) continue
      overrideRows.push({ characterId: c._ref, bookId, age: o.age ?? null })
    }
  }
  if (overrideRows.length) {
    await prisma.characterBookOverride.createMany({ data: overrideRows })
  }

  return NextResponse.json({ seriesId: series.id })
}
