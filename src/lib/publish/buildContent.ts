import Database from 'better-sqlite3'
import { renameSync, rmSync } from 'node:fs'
import { openReadOnly } from '@/lib/readonlyDb'
import { CONTENT_SCHEMA } from '@/lib/publish/contentSchema'
import {
  walkBook,
  defaultStoryState,
  type ChapterInWalk,
  type VariableIn,
} from '@/lib/manuscript/walk'
import { narrationHash, narrationSegments, type NarrationBlock } from '@/lib/narration/text'
import { publishAssets, type AssetReport } from '@/lib/publish/assets'

/**
 * Builds `content.db` — the snapshot the reader tier serves (LOOM-127).
 *
 * THE TWO RULES THAT MAKE THIS CORRECT
 *
 * 1. It walks exactly as the canon export does:
 *      walkBook(chapters, variables, defaultStoryState(variables), {})
 *    Same target, same absent overrides. Published books are therefore
 *    byte-identical to the manuscript already in ~/Writing and already ingested
 *    by WriteAI. Any divergence between this and the canon export is a bug
 *    HERE, which is a far easier property to test than "publish is correct".
 *
 * 2. Ids are copied verbatim; this never generates one. /api/import looks like
 *    the tool for this job and is not — it regenerates book, chapter and block
 *    ids through bookRefMap/chapterRefMap, because it is a CLONE mechanism (so
 *    a backup can be re-imported alongside the original). Used as a sync
 *    mechanism it would silently reset every reader's position and orphan every
 *    comment on each republish.
 *
 * It also does NOT refuse when canon is ambiguous. The canon export warns and
 * takes the first branch rather than refusing, so canon is already
 * deterministic; refusing here would block publishing for no change in output.
 * The warnings are carried through to the result instead.
 */

export type PublishedBook = {
  id: string
  title: string
  order: number
  published: boolean
  chapters: number
  blocks: number
  /** Chapters on the canon path with no prose — reported, never silent. */
  emptyChapters: string[]
  /** Chapters that got canon narration. */
  narrated: number
  /**
   * Canon-path chapters that have recordings, but none matching the canon
   * text. They publish SILENT rather than borrowing another branch's audio —
   * surfaced so "why is chapter 12 quiet" is answerable without an
   * investigation.
   */
  narrationMismatched: string[]
  warnings: string[]
}

export type PublishResult = {
  publishedAt: string
  seriesId: string
  books: PublishedBook[]
  warnings: string[]
  /** Media paths the published content references, for the asset copy. */
  referencedAssets: string[]
  assets?: AssetReport
}

type BuildOptions = {
  /** Path to dev.db. Opened READ-ONLY; a write through this handle throws. */
  sourcePath: string
  /** Destination. Built at `${outPath}.tmp` then renamed over. */
  outPath: string
  seriesId: string
  /** Resolved byline (pseudonym-aware) — the caller owns that policy. */
  authorName: string
  /** Injected so repeated builds of unchanged input are byte-comparable. */
  publishedAt: string
  /** Loom's public/ dir. Omit to skip the asset copy (schema-only builds). */
  publicRoot?: string
  /** The reader app's asset root. Pruning is bounded to this directory. */
  readerAssetRoot?: string
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Row = any

export function buildContentDb(opts: BuildOptions): PublishResult {
  const source = openReadOnly(opts.sourcePath)
  // dev.db is journal_mode=delete: a live writer blocks readers outright, and
  // the writer here is the author mid-sentence. Wait rather than fail.
  source.pragma('busy_timeout = 15000')

  let series: Row
  let books: Row[]
  const chaptersByBook = new Map<string, ChapterInWalk[]>()
  let variables: VariableIn[]
  let characters: Row[]
  let bookMetaAges: Row[]
  let narrations: Row[]

  try {
    // One read transaction, held only as long as it takes to pull rows into
    // memory. The walk and the write happen afterwards, outside the lock, so
    // publishing never blocks a save for longer than necessary.
    source.exec('BEGIN DEFERRED')

    series = source.prepare(
      `SELECT id, title, description, genres, keywords, authorOverrideName FROM Series WHERE id = ?`,
    ).get(opts.seriesId)
    if (!series) throw new Error(`Series ${opts.seriesId} not found in ${opts.sourcePath}`)

    books = source.prepare(
      `SELECT id, seriesId, title, synopsis, coverPath, "order", published FROM Book WHERE seriesId = ? ORDER BY "order"`,
    ).all(opts.seriesId)

    variables = source.prepare(
      `SELECT name, type, defaultValue FROM StoryVariable WHERE seriesId = ?`,
    ).all(opts.seriesId) as VariableIn[]

    const chapterStmt = source.prepare(
      `SELECT id, title, "order", pov, date, condition, numbered FROM Chapter WHERE bookId = ? ORDER BY "order"`,
    )
    const blockStmt = source.prepare(
      `SELECT id, "order", type, content, prompt, displayType, condition FROM ContentBlock WHERE chapterId = ? ORDER BY "order"`,
    )
    const choiceStmt = source.prepare(
      `SELECT id, "order", label, setsVariables, targetChapterId, endingMessage, isBadEnding, endsChapter
         FROM Choice WHERE choicePointId = ? ORDER BY "order"`,
    )
    const overrideStmt = source.prepare(
      `SELECT id, "order", condition, content, endingMessage, endsChapter
         FROM ConditionalOverride WHERE conditionalFragmentId = ? ORDER BY "order"`,
    )

    for (const book of books) {
      // Drafts are never walked. Their chapters must not be read, let alone
      // written — the stub carries title and order and nothing else.
      if (!book.published) continue
      chaptersByBook.set(book.id, chapterStmt.all(book.id).map((c: Row) => ({
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
      })) as ChapterInWalk[])
    }

    characters = source.prepare(
      `SELECT m.writerCharacterId AS id, m.age, m.firstBookId, m.deathBookId,
              s.name, s.photoUrl
         FROM WriterCharacterMeta m
         LEFT JOIN WriterCharacterSnapshot s ON s.writerCharacterId = m.writerCharacterId
        WHERE m.seriesId = ?`,
    ).all(opts.seriesId)

    bookMetaAges = source.prepare(
      `SELECT bm.bookId, m.writerCharacterId AS id, bm.age
         FROM WriterCharacterBookMeta bm
         JOIN WriterCharacterMeta m ON m.id = bm.metaId
        WHERE m.seriesId = ?`,
    ).all(opts.seriesId)

    // Every recording for every chapter of this series. Selection happens
    // below, against the recomputed canon hash — NOT here, and never "the
    // first row".
    narrations = source.prepare(
      `SELECT n.chapterId, n.voice, n.audioPath, n.timing, n.contentHash, n.durationMs
         FROM ChapterNarration n
         JOIN Chapter c ON c.id = n.chapterId
         JOIN Book b ON b.id = c.bookId
        WHERE b.seriesId = ?`,
    ).all(opts.seriesId)

    source.exec('COMMIT')
  } finally {
    source.close()
  }

  const narrationsByChapter = new Map<string, Row[]>()
  for (const n of narrations) {
    const list = narrationsByChapter.get(n.chapterId) ?? []
    list.push(n)
    narrationsByChapter.set(n.chapterId, list)
  }

  /**
   * The canon recording for a chapter, or null.
   *
   * Reproduces Loom's own keying: segment the chapter exactly as the narrator
   * did — same block list, same entry state, same answered choices, only here
   * the answers are the CANON ones — then fold the per-segment hashes the way
   * `variantHashFor` does. A row matches only if it is the recording of this
   * prose. Anything else publishes silent.
   *
   * Voice is part of the hash, so each voice present for the chapter is tried
   * rather than assuming the default.
   */
  const canonNarration = (
    chapterId: string,
    blocks: NarrationBlock[],
    state: Record<string, string | number | boolean>,
    answered: Record<string, string>,
  ): Row | null => {
    const rows = narrationsByChapter.get(chapterId)
    if (!rows?.length) return null
    const plan = narrationSegments(blocks, state, answered)
    if (!plan.segments.length) return null
    for (const voice of new Set(rows.map(r => r.voice as string))) {
      const segHashes = plan.segments.map(s => narrationHash(s.text, voice))
      const variantHash = narrationHash(segHashes.join('|'), voice)
      const match = rows.find(r => r.contentHash === variantHash)
      if (match) return match
    }
    return null
  }

  const referencedAssets = new Set<string>()
  const orderByBookId = new Map<string, number>(books.map((b: Row) => [b.id, b.order]))
  const ageOverride = new Map<string, number | null>(
    bookMetaAges.map((r: Row) => [`${r.id}::${r.bookId}`, r.age]),
  )

  const tmpPath = `${opts.outPath}.tmp`
  for (const suffix of ['', '-wal', '-shm']) rmSync(tmpPath + suffix, { force: true })

  const out = new Database(tmpPath)
  const result: PublishResult = {
    publishedAt: opts.publishedAt,
    seriesId: opts.seriesId,
    books: [],
    warnings: [],
    referencedAssets: [],
  }

  try {
    out.exec(CONTENT_SCHEMA)

    const insertBlock = out.prepare(
      `INSERT INTO ContentBlock (id, chapterId, "order", type, content, displayType, sourceBlockId)
       VALUES (@id, @chapterId, @order, @type, @content, @displayType, @sourceBlockId)`,
    )
    const insertChapter = out.prepare(
      `INSERT INTO Chapter (id, bookId, title, label, numbered, "order", pov, date)
       VALUES (@id, @bookId, @title, @label, @numbered, @order, @pov, @date)`,
    )
    const insertCharacter = out.prepare(
      `INSERT OR REPLACE INTO Character (id, bookId, name, age, photoPath, deceased)
       VALUES (@id, @bookId, @name, @age, @photoPath, @deceased)`,
    )

    out.transaction(() => {
      out.prepare(
        `INSERT INTO Series (id, title, description, genres, keywords, authorName)
         VALUES (@id, @title, @description, @genres, @keywords, @authorName)`,
      ).run({
        id: series.id,
        title: series.title,
        description: series.description ?? '',
        genres: series.genres ?? '[]',
        keywords: series.keywords ?? '[]',
        authorName: (series.authorOverrideName ?? '').trim() || opts.authorName,
      })

      for (const book of books) {
        const published = !!book.published
        if (!published) {
          // STUB. Title and order only — no synopsis (it spoils), no cover, no
          // chapters. The reader shows "Coming Soon" and there is nothing else
          // present for a bug to expose.
          out.prepare(
            `INSERT INTO Book (id, seriesId, title, synopsis, coverPath, "order", published)
             VALUES (@id, @seriesId, @title, '', NULL, @order, 0)`,
          ).run({ id: book.id, seriesId: book.seriesId, title: book.title, order: book.order })
          result.books.push({
            id: book.id, title: book.title, order: book.order, published: false,
            chapters: 0, blocks: 0, emptyChapters: [], narrated: 0,
            narrationMismatched: [], warnings: [],
          })
          continue
        }

        out.prepare(
          `INSERT INTO Book (id, seriesId, title, synopsis, coverPath, "order", published)
           VALUES (@id, @seriesId, @title, @synopsis, @coverPath, @order, 1)`,
        ).run({
          id: book.id,
          seriesId: book.seriesId,
          title: book.title,
          synopsis: book.synopsis ?? '',
          coverPath: book.coverPath,
          order: book.order,
        })

        const chapters = chaptersByBook.get(book.id) ?? []
        const walk = walkBook(chapters, variables, defaultStoryState(variables), {})

        if (book.coverPath) referencedAssets.add(book.coverPath)

        let blockCount = 0
        let narrated = 0
        const emptyChapters: string[] = []
        const narrationMismatched: string[] = []
        walk.chapters.forEach((ch, idx) => {
          insertChapter.run({
            id: ch.id,
            bookId: book.id,
            title: chapters.find(c => c.id === ch.id)?.title ?? ch.label,
            label: ch.label,
            numbered: ch.numbered ? 1 : 0,
            order: idx + 1,
            pov: ch.pov,
            date: ch.date,
          })
          if (ch.blocks.length === 0) emptyChapters.push(ch.label)
          ch.blocks.forEach((b, bIdx) => {
            insertBlock.run({
              id: b.id,
              chapterId: ch.id,
              order: bIdx + 1,
              type: b.type,
              content: b.content,
              displayType: b.displayType,
              sourceBlockId: b.sourceBlockId,
            })
            blockCount += 1
            if (b.type === 'soundtrack') referencedAssets.add(b.content)
          })

          const sourceChapter = chapters.find(c => c.id === ch.id)
          const match = sourceChapter
            ? canonNarration(
                ch.id,
                sourceChapter.blocks as unknown as NarrationBlock[],
                ch.stateAtStart as Record<string, string | number | boolean>,
                ch.answeredChoices,
              )
            : null
          if (match) {
            out.prepare(
              `INSERT INTO Narration (chapterId, audioPath, timing, durationMs)
               VALUES (@chapterId, @audioPath, @timing, @durationMs)`,
            ).run({
              chapterId: ch.id,
              audioPath: match.audioPath,
              // The timing map travels with the audio it belongs to. A map from
              // another path desyncs the word highlight visibly.
              timing: match.timing,
              durationMs: match.durationMs,
            })
            referencedAssets.add(match.audioPath)
            narrated += 1
          } else if (narrationsByChapter.has(ch.id)) {
            // Recordings exist, none is of the canon text. Silent, and said so.
            narrationMismatched.push(ch.label)
          }
        })

        // Per-book character projection. Everything a reader may know by the
        // end of THIS book, and nothing beyond it.
        for (const c of characters) {
          const firstOrder = c.firstBookId ? orderByBookId.get(c.firstBookId) : undefined
          // No recorded first appearance means "present from the start" — the
          // author simply has not narrowed it. Absent is the wrong default for
          // a character the prose may already be marking up.
          if (firstOrder !== undefined && firstOrder > book.order) continue
          const deathOrder = c.deathBookId ? orderByBookId.get(c.deathBookId) : undefined
          const override = ageOverride.get(`${c.id}::${book.id}`)
          insertCharacter.run({
            id: c.id,
            bookId: book.id,
            name: c.name ?? c.id,
            age: override ?? c.age ?? null,
            photoPath: (() => { if (c.photoUrl) referencedAssets.add(c.photoUrl); return c.photoUrl ?? null })(),
            // The spoiler. Resolved to a boolean HERE; the book a character
            // dies in never crosses over.
            deceased: deathOrder !== undefined && deathOrder <= book.order ? 1 : 0,
          })
        }

        result.books.push({
          id: book.id,
          title: book.title,
          order: book.order,
          published: true,
          chapters: walk.chapters.length,
          blocks: blockCount,
          emptyChapters,
          narrated,
          narrationMismatched,
          warnings: walk.warnings,
        })
      }

      for (const [key, value] of [
        ['publishedAt', opts.publishedAt],
        ['seriesId', opts.seriesId],
      ]) {
        out.prepare(`INSERT INTO PublishMeta (key, value) VALUES (?, ?)`).run(key, value)
      }
    })()
  } finally {
    out.close()
  }

  // Atomic swap. An interrupted build leaves the previous content.db serving;
  // a half-written file is never visible to the reader app.
  renameSync(tmpPath, opts.outPath)

  result.referencedAssets = [...referencedAssets].sort()
  if (opts.publicRoot && opts.readerAssetRoot) {
    result.assets = publishAssets({
      publicRoot: opts.publicRoot,
      readerRoot: opts.readerAssetRoot,
      referenced: result.referencedAssets,
    })
  }
  return result
}
