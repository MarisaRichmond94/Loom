import type Database from 'better-sqlite3'
import type { ChapterInWalk } from './walk'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Row = any

/**
 * Raw-SQL twin of `loadManuscriptBook`'s chapter loading, for callers that hold
 * a read-only `better-sqlite3` handle on dev.db instead of going through Prisma
 * (the reader-tier publish, the nightly EPUB build).
 *
 * Shared rather than copied: both callers must hand walkBook exactly the same
 * shape, and a field one of them forgot — `condition` is the one that has
 * already bitten (see loadBook.ts) — would make that caller's canon quietly
 * different from everyone else's.
 *
 * Prepares its statements once; call the returned function per book. The
 * caller owns the handle and the transaction around it.
 */
export function chapterReader(source: Database.Database): (bookId: string) => ChapterInWalk[] {
  const chapterStmt = source.prepare(
    `SELECT id, title, "order", pov, date, condition, numbered FROM Chapter WHERE bookId = ? ORDER BY "order"`,
  )
  const blockStmt = source.prepare(
    `SELECT id, "order", type, content, prompt, displayType, condition, pinStart, pinEnd FROM ContentBlock WHERE chapterId = ? ORDER BY "order"`,
  )
  const choiceStmt = source.prepare(
    `SELECT id, "order", label, setsVariables, targetChapterId, endingMessage, isBadEnding, endsChapter
       FROM Choice WHERE choicePointId = ? ORDER BY "order"`,
  )
  const overrideStmt = source.prepare(
    `SELECT id, "order", condition, content, endingMessage, endsChapter
       FROM ConditionalOverride WHERE conditionalFragmentId = ? ORDER BY "order"`,
  )

  return (bookId: string) => chapterStmt.all(bookId).map((c: Row) => ({
    id: c.id,
    title: c.title,
    order: c.order,
    pov: c.pov,
    date: c.date,
    condition: c.condition,
    numbered: !!c.numbered,
    blocks: blockStmt.all(c.id).map((b: Row) => ({
      id: b.id,
      order: b.order,
      type: b.type,
      content: b.content,
      prompt: b.prompt,
      displayType: b.displayType,
      condition: b.condition,
      pinStart: b.pinStart,
      pinEnd: b.pinEnd,
      choices: choiceStmt.all(b.id).map((ch: Row) => ({
        id: ch.id,
        label: ch.label,
        setsVariables: ch.setsVariables,
        targetChapterId: ch.targetChapterId,
        endingMessage: ch.endingMessage,
        isBadEnding: !!ch.isBadEnding,
        endsChapter: !!ch.endsChapter,
      })),
      overrides: overrideStmt.all(b.id).map((o: Row) => ({
        id: o.id,
        order: o.order,
        condition: o.condition,
        content: o.content,
        endingMessage: o.endingMessage,
        endsChapter: !!o.endsChapter,
      })),
    })),
  })) as ChapterInWalk[]
}
