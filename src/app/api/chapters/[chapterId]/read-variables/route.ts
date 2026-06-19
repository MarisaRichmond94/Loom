import { NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { namesInCondition, namesInTemplates } from '@/lib/variableRefs'

type Params = { params: Promise<{ chapterId: string }> }

// GET /api/chapters/[chapterId]/read-variables
//
// Returns the distinct set of variable names whose values this chapter
// actually *reads* during render — chapter-level conditions, block
// conditions, override conditions, prose templates (in block content,
// baseContent, override content, override endingMessage, and choice
// endingMessage). Used by the Configure modal to filter the question
// list to only those whose answers affect this chapter.
//
// setsVariables payloads are deliberately excluded: writing a variable
// from a choice in this chapter doesn't change how THIS chapter
// renders. Only downstream chapters that read the variable do.
export async function GET(_: Request, { params }: Params) {
  const { chapterId } = await params
  const chapter = await prisma.chapter.findUnique({
    where: { id: chapterId },
    include: {
      blocks: {
        include: { choices: true, overrides: true },
      },
    },
  })
  if (!chapter) return NextResponse.json([], { status: 404 })

  const names = new Set<string>()
  const add = (xs: string[]) => { for (const n of xs) names.add(n) }

  add(namesInCondition(chapter.condition))
  for (const block of chapter.blocks) {
    add(namesInCondition(block.condition))
    add(namesInTemplates(block.content))
    add(namesInTemplates(block.baseContent))
    for (const choice of block.choices) {
      add(namesInTemplates(choice.endingMessage))
    }
    for (const override of block.overrides) {
      add(namesInCondition(override.condition))
      add(namesInTemplates(override.content))
      add(namesInTemplates(override.endingMessage))
    }
  }

  return NextResponse.json(Array.from(names))
}
