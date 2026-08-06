import Database from 'better-sqlite3'
import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, renameSync, rmSync } from 'node:fs'
import path from 'node:path'
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
 * Builds `content.db` — the snapshot the reader tier serves (LOOM-127/129).
 *
 * THE RULES THAT MAKE THIS CORRECT
 *
 * 1. It walks exactly as the canon export does:
 *      walkBook(chapters, variables, defaultStoryState(variables), {})
 *    Same target, same absent overrides. Published books are therefore
 *    byte-identical to the manuscript already in ~/Writing and already ingested
 *    by WriteAI. Any divergence between this and the canon export is a bug
 *    HERE, which is far easier to test than "publish is correct".
 *
 * 2. Ids are copied verbatim; this never generates one. /api/import looks like
 *    the tool for this job and is not — it regenerates book, chapter and block
 *    ids through bookRefMap/chapterRefMap, because it is a CLONE mechanism.
 *    Used as a sync mechanism it would silently reset every reader's position
 *    and orphan every comment on each republish.
 *
 * 3. THE WHOLE FILE IS REBUILT EVERY TIME, even when publishing one book.
 *    Per-book publishing (LOOM-129) does not mean incremental upserts — that
 *    is where "deleted chapter still visible to readers" lives. Instead, books
 *    you are NOT publishing have their rows carried forward verbatim from the
 *    existing snapshot. Every book is still replaced atomically as a unit; the
 *    file is still swapped atomically. Only the SOURCE of each book differs.
 *
 * It does NOT refuse when canon is ambiguous. The canon export warns and takes
 * the first branch rather than refusing, so canon is already deterministic;
 * refusing here would block publishing for no change in output.
 */

/** Where a book's rows in the new snapshot came from. */
export type BookSource =
  /** Freshly walked from the manuscript. */
  | 'built'
  /** Kept exactly as readers already had it. */
  | 'carried'
  /** Title and order only — a draft, or eligible but never published. */
  | 'stub'

export type PublishedBook = {
  id: string
  title: string
  order: number
  /** Loom's `Book.published` flag: is this eligible to be read at all? */
  eligible: boolean
  source: BookSource
  chapters: number
  blocks: number
  /** Chapters on the canon path with no prose — reported, never silent. */
  emptyChapters: string[]
  /** Chapters that got canon narration. */
  narrated: number
  /**
   * Canon-path chapters that have recordings, but none matching the canon
   * text. They publish SILENT rather than borrowing another branch's audio.
   */
  narrationMismatched: string[]
  warnings: string[]
  /**
   * Fingerprint of exactly what a reader gets for this book, so "changed since
   * you published" is an exact answer rather than a guess from word counts.
   */
  contentHash: string
  /** When THIS book was last built from the manuscript. */
  publishedAt: string
}

export type PublishResult = {
  publishedAt: string
  seriesId: string
  /** The books this run actually rebuilt. */
  built: string[]
  books: PublishedBook[]
  warnings: string[]
  referencedAssets: string[]
  assets?: AssetReport
}

type BuildOptions = {
  sourcePath: string
  outPath: string
  seriesId: string
  authorName: string
  publishedAt: string
  /**
   * Which books to rebuild from the manuscript. Omit for all of them.
   * Anything not listed is carried forward from the existing snapshot.
   */
  bookIds?: string[]
  publicRoot?: string
  readerAssetRoot?: string
  /** Compute everything, write nothing — how the status endpoint stays exact. */
  dryRun?: boolean
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Row = any

/** Guards carry-forward: rows are only portable between identical schemas. */
const SCHEMA_FINGERPRINT = createHash('sha256').update(CONTENT_SCHEMA).digest('hex').slice(0, 16)

export function buildContentDb(opts: BuildOptions): PublishResult {
  // ---- The previous snapshot, read FIRST -----------------------------------
  // Whether carry-forward is possible decides which books need reading from the
  // manuscript at all, so it has to be known before the source read starts.
  const warnings: string[] = []
  const prevPath = opts.outPath
  const prevMeta = new Map<string, string>()
  let canCarry = false
  if (existsSync(prevPath)) {
    const prev = openReadOnly(prevPath)
    try {
      for (const r of prev.prepare(`SELECT key, value FROM PublishMeta`).all() as Row[]) {
        prevMeta.set(r.key, r.value)
      }
      // Rows are only portable between identical schemas.
      canCarry = prevMeta.get('schema') === SCHEMA_FINGERPRINT
    } catch {
      canCarry = false
    } finally {
      prev.close()
    }
  }

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

  // An UNREADABLE existing snapshot forces a full rebuild. Without
  // carry-forward, a book the caller did not select has nowhere to come from
  // and would silently drop to a stub — UN-PUBLISHING something readers can
  // currently see. A slower publish is the right trade against taking a book
  // away without saying so.
  //
  // Note the `prevMeta.size > 0`: with NO previous snapshot there is nothing to
  // un-publish, so a selection is honoured as given and the unselected books
  // are stubs ("Coming Soon") rather than a hole in the series.
  const staleSnapshot = !canCarry && prevMeta.size > 0
  if (staleSnapshot && opts.bookIds !== undefined) {
    warnings.push('Snapshot format changed — every book was rebuilt, not just the ones selected.')
  }
  const rebuildAll = opts.bookIds === undefined || staleSnapshot
  const wantRebuild = new Set(opts.bookIds ?? [])

  try {
    // One read transaction, held only long enough to pull rows into memory. The
    // walk and the write happen afterwards, so publishing never blocks a save
    // for longer than the read itself.
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
      // Drafts are never walked, and neither is a book being carried forward.
      // Not reading a draft's chapters is the strongest form of "they do not
      // leave Loom".
      if (!book.published) continue
      if (!rebuildAll && !wantRebuild.has(book.id)) continue
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
      `SELECT m.writerCharacterId AS id, m.age, m.firstBookId, m.deathBookId, s.name, s.photoUrl
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

    // Every recording for the series. Selection happens below, against the
    // recomputed canon hash — never "the first row".
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
   * did — same blocks, same entry state, same answered choices, only here the
   * answers are the CANON ones — then fold the segment hashes the way
   * `variantHashFor` does. Voice is part of the hash, so each voice present is
   * tried rather than assuming the default.
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
      const match = rows.find(r => r.contentHash === narrationHash(segHashes.join('|'), voice))
      if (match) return match
    }
    return null
  }

  const orderByBookId = new Map<string, number>(books.map((b: Row) => [b.id, b.order]))
  const ageOverride = new Map<string, number | null>(
    bookMetaAges.map((r: Row) => [`${r.id}::${r.bookId}`, r.age]),
  )

  const tmpPath = `${opts.outPath}.tmp`
  mkdirSync(path.dirname(tmpPath), { recursive: true })
  for (const suffix of ['', '-wal', '-shm']) rmSync(tmpPath + suffix, { force: true })

  const out = new Database(tmpPath)
  const result: PublishResult = {
    publishedAt: opts.publishedAt,
    seriesId: opts.seriesId,
    built: [],
    books: [],
    warnings,
    referencedAssets: [],
  }

  try {
    out.exec(CONTENT_SCHEMA)
    if (canCarry) {
      // Escaped for the string-literal ATTACH; SQLite has no bind for it.
      out.exec(`ATTACH DATABASE '${prevPath.replace(/'/g, "''")}' AS prev`)
    }

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
    const insertMeta = out.prepare(`INSERT OR REPLACE INTO PublishMeta (key, value) VALUES (?, ?)`)

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
        const eligible = !!book.published
        const rebuilding = eligible && (rebuildAll || wantRebuild.has(book.id))
        const carried = !rebuilding && canCarry && prevMeta.has(`book:${book.id}:hash`)

        // ---- carried forward: exactly what readers already had --------------
        if (carried) {
          out.exec(`INSERT INTO Book SELECT * FROM prev.Book WHERE id = '${book.id.replace(/'/g, "''")}'`)
          const b = book.id.replace(/'/g, "''")
          out.exec(`INSERT INTO Chapter SELECT * FROM prev.Chapter WHERE bookId = '${b}'`)
          out.exec(
            `INSERT INTO ContentBlock SELECT * FROM prev.ContentBlock
               WHERE chapterId IN (SELECT id FROM prev.Chapter WHERE bookId = '${b}')`,
          )
          out.exec(`INSERT INTO Character SELECT * FROM prev.Character WHERE bookId = '${b}'`)
          out.exec(
            `INSERT INTO Narration SELECT * FROM prev.Narration
               WHERE chapterId IN (SELECT id FROM prev.Chapter WHERE bookId = '${b}')`,
          )
          const hash = prevMeta.get(`book:${book.id}:hash`) as string
          const at = prevMeta.get(`book:${book.id}:publishedAt`) ?? ''
          insertMeta.run(`book:${book.id}:hash`, hash)
          insertMeta.run(`book:${book.id}:publishedAt`, at)
          const counts = out.prepare(
            `SELECT (SELECT COUNT(*) FROM Chapter WHERE bookId = ?) c,
                    (SELECT COUNT(*) FROM ContentBlock WHERE chapterId IN (SELECT id FROM Chapter WHERE bookId = ?)) b,
                    (SELECT COUNT(*) FROM Narration WHERE chapterId IN (SELECT id FROM Chapter WHERE bookId = ?)) n`,
          ).get(book.id, book.id, book.id) as Row
          result.books.push({
            id: book.id, title: book.title, order: book.order, eligible: true,
            source: 'carried', chapters: counts.c, blocks: counts.b, emptyChapters: [],
            narrated: counts.n, narrationMismatched: [], warnings: [],
            contentHash: hash, publishedAt: at,
          })
          continue
        }

        // ---- stub: a draft, or eligible but not yet sent ---------------------
        if (!rebuilding) {
          // Title and order only. No synopsis (it spoils), no cover, no
          // chapters — the reader shows "Coming Soon" and there is nothing
          // else present for a bug to expose.
          out.prepare(
            `INSERT INTO Book (id, seriesId, title, synopsis, coverPath, "order", published)
             VALUES (@id, @seriesId, @title, '', NULL, @order, 0)`,
          ).run({ id: book.id, seriesId: book.seriesId, title: book.title, order: book.order })
          result.books.push({
            id: book.id, title: book.title, order: book.order, eligible,
            source: 'stub', chapters: 0, blocks: 0, emptyChapters: [], narrated: 0,
            narrationMismatched: [], warnings: [], contentHash: '', publishedAt: '',
          })
          continue
        }

        // ---- built fresh from the manuscript ---------------------------------
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

        let blockCount = 0
        let narrated = 0
        const emptyChapters: string[] = []
        const narrationMismatched: string[] = []
        const fingerprint = createHash('sha256')

        walk.chapters.forEach((ch, idx) => {
          fingerprint.update(ch.id).update('\0').update(ch.label).update('\0')
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
            fingerprint.update(b.id).update('\0').update(b.content).update('\0')
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
              // The timing map travels with the audio it belongs to; a map from
              // another path desyncs the word highlight visibly.
              timing: match.timing,
              durationMs: match.durationMs,
            })
            narrated += 1
          } else if (narrationsByChapter.has(ch.id)) {
            narrationMismatched.push(ch.label)
          }
        })

        // Per-book character projection: everything a reader may know by the
        // end of THIS book, and nothing beyond it.
        for (const c of characters) {
          const firstOrder = c.firstBookId ? orderByBookId.get(c.firstBookId) : undefined
          // No recorded first appearance means "present from the start" — the
          // author simply has not narrowed it.
          if (firstOrder !== undefined && firstOrder > book.order) continue
          const deathOrder = c.deathBookId ? orderByBookId.get(c.deathBookId) : undefined
          insertCharacter.run({
            id: c.id,
            bookId: book.id,
            name: c.name ?? c.id,
            age: ageOverride.get(`${c.id}::${book.id}`) ?? c.age ?? null,
            photoPath: c.photoUrl ?? null,
            // The spoiler, resolved to a boolean HERE. The book a character
            // dies in never crosses over.
            deceased: deathOrder !== undefined && deathOrder <= book.order ? 1 : 0,
          })
        }

        const contentHash = fingerprint.digest('hex')
        insertMeta.run(`book:${book.id}:hash`, contentHash)
        insertMeta.run(`book:${book.id}:publishedAt`, opts.publishedAt)
        result.built.push(book.id)
        result.books.push({
          id: book.id, title: book.title, order: book.order, eligible: true,
          source: 'built', chapters: walk.chapters.length, blocks: blockCount,
          emptyChapters, narrated, narrationMismatched, warnings: walk.warnings,
          contentHash, publishedAt: opts.publishedAt,
        })
      }

      insertMeta.run('publishedAt', opts.publishedAt)
      insertMeta.run('seriesId', opts.seriesId)
      insertMeta.run('schema', SCHEMA_FINGERPRINT)
    })()

    // Assets are read off the FINAL snapshot, not accumulated during the walk.
    // Carried-forward books reference media too, and pruning against only the
    // rebuilt book's references would delete the others' covers and audio out
    // from under them.
    const refs = new Set<string>()
    for (const r of out.prepare(`SELECT coverPath v FROM Book WHERE coverPath IS NOT NULL`).all() as Row[]) refs.add(r.v)
    for (const r of out.prepare(`SELECT content v FROM ContentBlock WHERE type = 'soundtrack'`).all() as Row[]) refs.add(r.v)
    for (const r of out.prepare(`SELECT audioPath v FROM Narration`).all() as Row[]) refs.add(r.v)
    for (const r of out.prepare(`SELECT DISTINCT photoPath v FROM Character WHERE photoPath IS NOT NULL`).all() as Row[]) refs.add(r.v)
    result.referencedAssets = [...refs].sort()
  } finally {
    if (canCarry) { try { out.exec('DETACH DATABASE prev') } catch { /* already closing */ } }
    out.close()
  }

  if (opts.dryRun) {
    // Everything computed by the code that publishes, then discarded. Nothing
    // swapped in, no asset touched.
    for (const suffix of ['', '-wal', '-shm']) rmSync(tmpPath + suffix, { force: true })
    return result
  }

  // Atomic swap. An interrupted build leaves the previous content.db serving;
  // a half-written file is never visible to the reader app.
  renameSync(tmpPath, opts.outPath)

  if (opts.publicRoot && opts.readerAssetRoot) {
    result.assets = publishAssets({
      publicRoot: opts.publicRoot,
      readerRoot: opts.readerAssetRoot,
      referenced: result.referencedAssets,
    })
  }
  return result
}
