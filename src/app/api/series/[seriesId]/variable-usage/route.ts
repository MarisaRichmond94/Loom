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
type Chapter = { bookId: string; bookTitle: string; bookOrder: number; chapterId: string; chapterTitle: string; chapterOrder: number; count: number }
type Usage = Counts & {
  chapters: Chapter[]       // chapters containing reads — drives drill-in
  writeChapters: Chapter[]  // chapters containing writes — used in delete confirmation
  originBook: string | null
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
  for (const v of series.variables) {
    usage[v.name] = {
      conditions: 0, text: 0, total: 0, chapters: [], writeChapters: [],
      // Origin comes straight from the stamped column. Backfilled for
      // existing rows via prisma/scripts/backfill-variable-origins.ts
      // and stamped on creation by the POST /variables endpoint.
      originBook: v.originBook?.title ?? null,
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
  function markIn(map: Map<string, Chapter>, location: Omit<Chapter, 'count'>) {
    const existing = map.get(location.chapterId)
    if (existing) existing.count++
    else map.set(location.chapterId, { ...location, count: 1 })
  }

  for (const book of series.books) {
    for (const chapter of book.chapters) {
      const loc: Omit<Chapter, 'count'> = {
        bookId: book.id, bookTitle: book.title, bookOrder: book.order,
        chapterId: chapter.id, chapterTitle: chapter.title, chapterOrder: chapter.order,
      }
      const noteReads = (names: string[], cat: keyof Counts) => {
        for (const n of names) {
          bump(n, cat)
          const map = readChapterByVar[n]
          if (map) markIn(map, loc)
        }
      }
      const noteWrites = (names: string[]) => {
        for (const n of names) {
          const map = writeChapterByVar[n]
          if (map) markIn(map, loc)
        }
      }

      noteReads(namesInCondition(chapter.condition), 'conditions')
      for (const block of chapter.blocks) {
        noteReads(namesInCondition(block.condition), 'conditions')
        noteReads(namesInTemplates(block.content), 'text')
        noteReads(namesInTemplates(block.baseContent), 'text')
        for (const choice of block.choices) {
          // setsVariables doesn't count toward usage total, but we
          // track the chapters so the delete-confirmation flow can
          // surface where the variable gets introduced.
          noteWrites(namesInSetsVariables(choice.setsVariables))
          noteReads(namesInTemplates(choice.endingMessage), 'text')
        }
        for (const override of block.overrides) {
          noteReads(namesInCondition(override.condition), 'conditions')
          noteReads(namesInTemplates(override.content), 'text')
          noteReads(namesInTemplates(override.endingMessage), 'text')
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
