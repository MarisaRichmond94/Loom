import { existsSync } from 'node:fs'
import path from 'node:path'

import { prisma } from '@/lib/prisma'
import { walkBook, defaultStoryState, type ChapterInWalk, type VariableIn } from '@/lib/manuscript/walk'
import {
  DEFAULT_VOICE,
  narrationSegments,
  segHashesFor,
  variantHashFor,
  type NarrationBlock,
} from '@/lib/narration/text'

/**
 * Which canon chapters have no recording that publish would ship (LOOM-136).
 *
 * THE CANON PLAN, NOT THE DEFAULT ONE. `regenerateStaleChapter` warms the
 * pre-choice variant — right for read mode, wrong here. Publish matches a
 * recording against the canon path's state and answered choices, so a chapter
 * reached through a choice has a different variant hash. Generating the default
 * one for those would look like it worked and leave the chapter publishing
 * silent exactly as before.
 *
 * So this walks the book the way publish does — `walkBook(chapters, variables,
 * defaultStoryState(variables), {})` — and asks for each canon chapter whether a
 * recording exists for THAT variant.
 */

export type MissingNarration = {
  chapterId: string
  bookId: string
  bookTitle: string
  label: string
  /** The canon state at this chapter, to generate the variant publish wants. */
  state: Record<string, string | number | boolean>
  answered: Record<string, string>
}

const publicPath = (p: string) => path.join(process.cwd(), 'public', p.replace(/^\//, ''))

/** Published books only: a draft contributes no chapters to the snapshot. */
export async function findMissingCanonNarration(
  seriesId: string,
  voice = DEFAULT_VOICE,
): Promise<MissingNarration[]> {
  const series = await prisma.series.findUnique({
    where: { id: seriesId },
    select: { variables: { select: { name: true, type: true, defaultValue: true } } },
  })
  if (!series) return []
  const variables = series.variables as VariableIn[]

  const books = await prisma.book.findMany({
    where: { seriesId, published: true },
    orderBy: { order: 'asc' },
    select: {
      id: true, title: true,
      chapters: {
        orderBy: { order: 'asc' },
        select: {
          id: true, title: true, order: true, pov: true, date: true,
          condition: true, numbered: true,
          blocks: {
            orderBy: { order: 'asc' },
            select: {
              id: true, order: true, type: true, content: true, prompt: true,
              displayType: true, pinStart: true, pinEnd: true, condition: true,
              overrides: {
                orderBy: { order: 'asc' },
                select: {
                  id: true, order: true, condition: true, content: true,
                  endingMessage: true, endsChapter: true,
                },
              },
              choices: {
                orderBy: { order: 'asc' },
                // Exactly the fields walkBook reads from a choice — there is
                // no `content` on Choice; the per-branch prose is endingMessage.
                select: {
                  id: true, label: true, setsVariables: true, targetChapterId: true,
                  endingMessage: true, isBadEnding: true, endsChapter: true, order: true,
                },
              },
            },
          },
        },
      },
    },
  })

  const missing: MissingNarration[] = []

  for (const book of books) {
    const walk = walkBook(
      book.chapters as unknown as ChapterInWalk[],
      variables,
      defaultStoryState(variables),
      {},
    )

    for (const ch of walk.chapters) {
      const source = book.chapters.find((c: { id: string }) => c.id === ch.id)
      if (!source) continue

      const plan = narrationSegments(
        source.blocks as unknown as NarrationBlock[],
        ch.stateAtStart as Record<string, string | number | boolean>,
        ch.answeredChoices,
      )
      // A chapter with no prose has nothing to narrate — not a gap.
      if (plan.segments.length === 0) continue

      const hash = variantHashFor(segHashesFor(plan, voice), voice)
      const row = await prisma.chapterNarration.findUnique({
        where: { chapterId_contentHash: { chapterId: ch.id, contentHash: hash } },
        select: { audioPath: true },
      })
      // A row whose file has gone is as missing as no row at all.
      if (row && existsSync(publicPath(row.audioPath))) continue

      missing.push({
        chapterId: ch.id,
        bookId: book.id,
        bookTitle: book.title,
        label: ch.label,
        state: ch.stateAtStart as Record<string, string | number | boolean>,
        answered: ch.answeredChoices,
      })
    }
  }

  return missing
}
