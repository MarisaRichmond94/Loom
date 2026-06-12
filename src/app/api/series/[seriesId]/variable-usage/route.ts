import { NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'

// Counts each place a series's variables are *read*, plus the list of
// chapters that contain at least one read. The Context modal uses the
// counts for the overview table and the chapters list for the drill-in
// view (each row navigates to a chapter that uses the var).
//
// Writes (a choice's setsVariables payload) are deliberately not
// counted toward the usage total: a write the reader never reads back
// is effectively dead, and counting writes makes a write-only variable
// look heavily used when it's actually unused. "Reads" = conditions +
// text/template references.
//
// Write locations *are* tracked separately under `writeChapters` so the
// delete-confirmation flow can surface them too — a writer reviewing a
// "0 reads" variable before deleting still wants to see where it gets
// introduced via question blocks.

type Counts = { conditions: number; text: number; total: number }
// `count` is the number of references the variable has *within* this
// chapter — sums across the chapters array equal the variable's total
// (for reads) or the total write occurrences (for writeChapters).
// `firstBlockId` is the first block (by walk order) inside this chapter
// where the variable shows up under this row's kind (read or write);
// drives the Context modal's deep-link scroll into the chapter editor.
// Null when the only references are chapter-level conditions, which
// don't belong to a block.
type Chapter = { bookId: string; bookTitle: string; bookOrder: number; chapterId: string; chapterTitle: string; chapterOrder: number; count: number; firstBlockId: string | null }
// The "origin" is where the writer expects to see this variable's birth
// scene: a question block's setsVariables. We surface the book + chapter
// titles for the Context modal's Origin button label, plus chapterId +
// blockId so clicking deep-links straight to that block (the chapter
// page scrolls it into view via the `?block=` query param). When the
// variable has no writes at all, the first read location stands in
// (still useful as a starting point for the writer).
type Origin = {
  bookTitle: string
  chapterId: string
  chapterTitle: string
  blockId: string | null
}
type Usage = Counts & {
  chapters: Chapter[]       // chapters containing reads — drives drill-in
  writeChapters: Chapter[]  // chapters containing writes — used in delete confirmation
  origin: Origin | null
  // First appearance in the natural book/chapter walk — earliest write
  // wins over earliest read (a variable is "introduced" at its first
  // write, even if it's read elsewhere first). Used by the Context
  // modal's default "occurrence" sort. Null when the variable is
  // entirely unreferenced.
  firstAppearance: { bookOrder: number; chapterOrder: number } | null
}

const TEMPLATE_VAR_RE = /\{\{\s*([a-zA-Z_$][a-zA-Z0-9_$]*)/g

function namesInCondition(raw: string | null | undefined): string[] {
  if (!raw) return []
  try {
    const c = JSON.parse(raw)
    if (c && typeof c === 'object') {
      if ('op' in c && Array.isArray((c as { clauses?: unknown }).clauses)) {
        const clauses = (c as { clauses: Array<{ var?: string }> }).clauses
        return clauses.map(cl => cl.var ?? '').filter(Boolean)
      }
      return Object.keys(c as Record<string, unknown>)
    }
  } catch { /* malformed — count as no references */ }
  return []
}

function namesInTemplates(raw: string | null | undefined): string[] {
  if (!raw) return []
  const out: string[] = []
  TEMPLATE_VAR_RE.lastIndex = 0
  let m: RegExpExecArray | null
  while ((m = TEMPLATE_VAR_RE.exec(raw)) !== null) out.push(m[1])
  return out
}

export async function GET(_: Request, { params }: { params: Promise<{ seriesId: string }> }) {
  const { seriesId } = await params
  const series = await prisma.series.findUnique({
    where: { id: seriesId },
    include: {
      variables: { include: { originBook: { select: { title: true } } } },
      books: {
        orderBy: { order: 'asc' },
        include: {
          chapters: {
            orderBy: { order: 'asc' },
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

  // Per-variable accumulators. Each chapter that contains a reference
  // shows up once in the matching array; `count` is the number of
  // references of that kind inside the chapter, so per-row sums match
  // the totals.
  const usage: Record<string, Usage> = {}
  const readChapterByVar: Record<string, Map<string, Chapter>> = {}
  const writeChapterByVar: Record<string, Map<string, Chapter>> = {}
  // First block (by walk order) where each variable appears, separated
  // by reference kind. Filled once during the walk and never overwritten,
  // so they capture the first occurrence even when the variable later
  // appears in many more places.
  const firstWriteBlock: Record<string, { bookId: string; bookTitle: string; chapterId: string; chapterTitle: string; blockId: string }> = {}
  const firstReadBlock: Record<string, { bookId: string; bookTitle: string; chapterId: string; chapterTitle: string; blockId: string }> = {}
  for (const v of series.variables) {
    usage[v.name] = {
      conditions: 0, text: 0, total: 0, chapters: [], writeChapters: [],
      // Origin is composed below from the first-write/first-read tracking
      // and the stamped `originBookId` column. Variables with no
      // references at all keep this null and render as "—" in the modal.
      origin: null,
      firstAppearance: null,
    }
    readChapterByVar[v.name] = new Map()
    writeChapterByVar[v.name] = new Map()
  }

  function bump(name: string, cat: keyof Counts) {
    const slot = usage[name]
    if (!slot || cat === 'total') return
    slot[cat]++
    slot.total++
  }
  function markIn(map: Map<string, Chapter>, location: Omit<Chapter, 'count' | 'firstBlockId'>, blockId: string | null) {
    const existing = map.get(location.chapterId)
    if (existing) {
      existing.count++
      // Only the first per-block reference seeds firstBlockId; chapter-
      // level refs (blockId === null) never overwrite a block already
      // pinned for this chapter.
      if (!existing.firstBlockId && blockId) existing.firstBlockId = blockId
    } else {
      map.set(location.chapterId, { ...location, count: 1, firstBlockId: blockId })
    }
  }

  for (const book of series.books) {
    for (const chapter of book.chapters) {
      const loc: Omit<Chapter, 'count' | 'firstBlockId'> = {
        bookId: book.id, bookTitle: book.title, bookOrder: book.order,
        chapterId: chapter.id, chapterTitle: chapter.title, chapterOrder: chapter.order,
      }
      const blockOrigin = (blockId: string) => ({
        bookId: book.id, bookTitle: book.title,
        chapterId: chapter.id, chapterTitle: chapter.title,
        blockId,
      })
      const noteReads = (names: string[], cat: keyof Counts, blockId: string) => {
        for (const n of names) {
          bump(n, cat)
          const map = readChapterByVar[n]
          if (map) markIn(map, loc, blockId)
          if (!firstReadBlock[n]) firstReadBlock[n] = blockOrigin(blockId)
        }
      }
      const noteWrites = (names: string[], blockId: string) => {
        for (const n of names) {
          const map = writeChapterByVar[n]
          if (map) markIn(map, loc, blockId)
          if (!firstWriteBlock[n]) firstWriteBlock[n] = blockOrigin(blockId)
        }
      }

      // Chapter-level conditions still bump counts + the chapter's
      // reads list, but don't seed `firstReadBlock` (there's no block
      // to anchor to — the variable's block origin lives in whichever
      // per-block reference comes next in the walk).
      for (const n of namesInCondition(chapter.condition)) {
        bump(n, 'conditions')
        const map = readChapterByVar[n]
        if (map) markIn(map, loc, null)
      }
      for (const block of chapter.blocks) {
        noteReads(namesInCondition(block.condition), 'conditions', block.id)
        noteReads(namesInTemplates(block.content), 'text', block.id)
        noteReads(namesInTemplates(block.baseContent), 'text', block.id)
        for (const choice of block.choices) {
          // setsVariables doesn't count toward usage total, but we
          // track the chapters so the delete-confirmation flow can
          // surface where the variable gets introduced.
          noteWrites(namesInSetsVariables(choice.setsVariables), block.id)
          noteReads(namesInTemplates(choice.endingMessage), 'text', block.id)
        }
        for (const override of block.overrides) {
          noteReads(namesInCondition(override.condition), 'conditions', block.id)
          noteReads(namesInTemplates(override.content), 'text', block.id)
          noteReads(namesInTemplates(override.endingMessage), 'text', block.id)
        }
      }
    }
  }

  // Flush per-chapter maps into the response arrays, preserving the
  // book/chapter order the walk produced.
  for (const name of Object.keys(usage)) {
    usage[name].chapters = Array.from(readChapterByVar[name].values())
    usage[name].writeChapters = Array.from(writeChapterByVar[name].values())
  }

  // Lazy origin backfill + first-appearance. Earliest write wins; falls
  // back to earliest read. Stamps `originBookId` on the DB row when it
  // was previously null so subsequent loads (and the backfill script)
  // see the resolved value.
  const stamps: Array<{ id: string; bookId: string }> = []
  const variableByName: Record<string, { id: string; originBookId: string | null; originBookTitle: string | null }> = {}
  for (const v of series.variables) {
    variableByName[v.name] = { id: v.id, originBookId: v.originBookId, originBookTitle: v.originBook?.title ?? null }
  }
  for (const name of Object.keys(usage)) {
    const slot = usage[name]
    const firstWrite = slot.writeChapters[0]
    const firstRead = slot.chapters[0]
    const earliest = firstWrite ?? firstRead ?? null
    if (earliest) {
      slot.firstAppearance = { bookOrder: earliest.bookOrder, chapterOrder: earliest.chapterOrder }
    }
    // Compose the origin link target. Prefer the question block where
    // the variable is first WRITTEN; fall back to the block where it's
    // first read. Block-less chapter-condition refs don't anchor here.
    const blockOrigin = firstWriteBlock[name] ?? firstReadBlock[name] ?? null
    if (blockOrigin) {
      slot.origin = {
        bookTitle: blockOrigin.bookTitle,
        chapterId: blockOrigin.chapterId,
        chapterTitle: blockOrigin.chapterTitle,
        blockId: blockOrigin.blockId,
      }
      const row = variableByName[name]
      if (row && !row.originBookId) stamps.push({ id: row.id, bookId: blockOrigin.bookId })
    } else if (earliest) {
      // No block anchor (only chapter-level condition references) — still
      // surface the chapter so the writer has somewhere to land.
      slot.origin = {
        bookTitle: earliest.bookTitle,
        chapterId: earliest.chapterId,
        chapterTitle: earliest.chapterTitle,
        blockId: null,
      }
      const row = variableByName[name]
      if (row && !row.originBookId) stamps.push({ id: row.id, bookId: earliest.bookId })
    }
  }
  // Best-effort persistence — done sequentially because there are at most
  // a handful per fetch in practice, and skipping it on error keeps the
  // GET fully responsive even if a write fails.
  for (const s of stamps) {
    try {
      await prisma.storyVariable.update({ where: { id: s.id }, data: { originBookId: s.bookId } })
    } catch { /* leave it null; next load will retry */ }
  }

  return NextResponse.json(usage)
}

function namesInSetsVariables(raw: string | null | undefined): string[] {
  if (!raw) return []
  try {
    const v = JSON.parse(raw)
    if (v && typeof v === 'object') return Object.keys(v as Record<string, unknown>)
  } catch { /* malformed */ }
  return []
}
