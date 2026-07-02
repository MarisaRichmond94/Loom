import { NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { replaceInString, replaceInTipTapJson } from '@/lib/replaceInTipTap'

type Params = { params: Promise<{ seriesId: string }> }

// POST /api/series/[seriesId]/replace
// Body: { find: string; replace: string; bookIds?: string[]; dryRun?: boolean }
//
// Case-insensitive substring replace across the same surfaces the
// series search covers — block content (prose), block prompts, block
// baseContent (conditional canon), choice labels, choice endingMessage,
// override content, override endingMessage. Chapter titles are
// deliberately skipped: renaming a chapter cascades into the
// prefix-aware renumber flow, which isn't what a bulk text replace
// should trigger.
//
// dryRun=true returns the per-surface counts without writing — used by
// the UI's confirmation step so the writer sees "12 prose, 3 prompts,
// 1 choice label = 16 total" before committing.
export async function POST(req: Request, { params }: Params) {
  const { seriesId } = await params
  const body = await req.json() as { find?: string; replace?: string; bookIds?: string[]; dryRun?: boolean }
  const find = (body.find ?? '').trim()
  const replace = body.replace ?? ''
  const dryRun = !!body.dryRun
  if (!find) return NextResponse.json({ error: 'find is required' }, { status: 400 })

  const bookFilter = body.bookIds && body.bookIds.length > 0 ? new Set(body.bookIds) : null

  const series = await prisma.series.findUnique({
    where: { id: seriesId },
    include: {
      books: {
        include: {
          chapters: {
            include: {
              blocks: {
                include: { choices: true, overrides: true },
              },
            },
          },
        },
      },
    },
  })
  if (!series) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  type Update =
    | { kind: 'block'; id: string; data: { content?: string; prompt?: string; baseContent?: string } }
    | { kind: 'choice'; id: string; data: { label?: string; endingMessage?: string } }
    | { kind: 'override'; id: string; data: { content?: string; endingMessage?: string } }
  const updates: Update[] = []
  const counts = { prose: 0, prompt: 0, choice: 0, override: 0 }

  for (const book of series.books) {
    if (bookFilter && !bookFilter.has(book.id)) continue
    for (const chapter of book.chapters) {
      for (const block of chapter.blocks) {
        const blockData: { content?: string; prompt?: string; baseContent?: string } = {}
        const proseR = replaceInTipTapJson(block.content, find, replace)
        if (proseR.count > 0) { blockData.content = proseR.json ?? ''; counts.prose += proseR.count }
        const baseR = replaceInTipTapJson(block.baseContent, find, replace)
        if (baseR.count > 0) { blockData.baseContent = baseR.json ?? ''; counts.prose += baseR.count }
        const promptR = replaceInString(block.prompt, find, replace)
        if (promptR.count > 0) { blockData.prompt = promptR.value ?? ''; counts.prompt += promptR.count }
        if (Object.keys(blockData).length > 0) updates.push({ kind: 'block', id: block.id, data: blockData })

        for (const choice of block.choices) {
          const choiceData: { label?: string; endingMessage?: string } = {}
          const labelR = replaceInString(choice.label, find, replace)
          if (labelR.count > 0) { choiceData.label = labelR.value ?? ''; counts.choice += labelR.count }
          const endR = replaceInTipTapJson(choice.endingMessage, find, replace)
          if (endR.count > 0) { choiceData.endingMessage = endR.json ?? ''; counts.choice += endR.count }
          if (Object.keys(choiceData).length > 0) updates.push({ kind: 'choice', id: choice.id, data: choiceData })
        }
        for (const override of block.overrides) {
          const ovData: { content?: string; endingMessage?: string } = {}
          const contentR = replaceInTipTapJson(override.content, find, replace)
          if (contentR.count > 0) { ovData.content = contentR.json ?? ''; counts.override += contentR.count }
          const endR = replaceInTipTapJson(override.endingMessage, find, replace)
          if (endR.count > 0) { ovData.endingMessage = endR.json ?? ''; counts.override += endR.count }
          if (Object.keys(ovData).length > 0) updates.push({ kind: 'override', id: override.id, data: ovData })
        }
      }
    }
  }

  const total = counts.prose + counts.prompt + counts.choice + counts.override
  if (dryRun) return NextResponse.json({ total, counts })

  if (updates.length === 0) return NextResponse.json({ total: 0, counts })

  // One transaction so a mid-write failure leaves the series untouched.
  await prisma.$transaction(
    updates.map(u => {
      if (u.kind === 'block') return prisma.contentBlock.update({ where: { id: u.id }, data: u.data })
      if (u.kind === 'choice') return prisma.choice.update({ where: { id: u.id }, data: u.data })
      return prisma.conditionalOverride.update({ where: { id: u.id }, data: u.data })
    })
  )

  return NextResponse.json({ total, counts })
}
