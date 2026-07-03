import { prisma } from '@/lib/prisma'
import type { StoryState } from '@/lib/storyEngine'
import type { ChapterInWalk, VariableIn } from './walk'

// Loads everything the manuscript walk needs for one book, plus the pieces
// the export surfaces (titles, author). Shared by the plan and export
// endpoints so both walk exactly the same data.

export type ManuscriptBookData = {
  bookTitle: string
  seriesTitle: string
  chapters: ChapterInWalk[]
  variables: VariableIn[]
}

export async function loadManuscriptBook(seriesId: string, bookId: string): Promise<ManuscriptBookData | null> {
  const series = await prisma.series.findUnique({
    where: { id: seriesId },
    select: { title: true, variables: { select: { name: true, type: true, defaultValue: true } } },
  })
  if (!series) return null

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
  if (!book) return null

  return {
    bookTitle: book.title,
    seriesTitle: series.title,
    variables: series.variables,
    chapters: book.chapters.map(c => ({
      id: c.id,
      title: c.title,
      order: c.order,
      pov: c.pov,
      date: c.date,
      condition: c.condition,
      numbered: c.numbered,
      blocks: c.blocks.map(b => ({
        id: b.id,
        order: b.order,
        type: b.type,
        content: b.content,
        prompt: b.prompt,
        choices: b.choices.map(ch => ({
          id: ch.id,
          label: ch.label,
          setsVariables: ch.setsVariables,
          targetChapterId: ch.targetChapterId,
          endingMessage: ch.endingMessage,
          isBadEnding: ch.isBadEnding,
        })),
        overrides: b.overrides.map(o => ({
          id: o.id,
          order: o.order,
          condition: o.condition,
          content: o.content,
          endingMessage: o.endingMessage,
        })),
      })),
    })),
  }
}

// The export modal sends variable values as loosely-typed JSON; coerce them
// against the variable declarations so "5" on a number variable still
// matches conditions written as numbers.
export function coerceTargetState(
  raw: Record<string, unknown> | undefined,
  variables: VariableIn[],
): StoryState {
  const out: StoryState = {}
  if (!raw) return out
  const typeByName = new Map(variables.map(v => [v.name, v.type]))
  for (const [name, value] of Object.entries(raw)) {
    const type = typeByName.get(name)
    if (value === null || value === undefined) continue
    if (type === 'number') {
      const n = Number(value)
      if (Number.isFinite(n)) out[name] = n
    } else if (type === 'boolean') {
      out[name] = value === true || value === 'true'
    } else {
      out[name] = typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean'
        ? value as string | number | boolean
        : String(value)
    }
  }
  return out
}
