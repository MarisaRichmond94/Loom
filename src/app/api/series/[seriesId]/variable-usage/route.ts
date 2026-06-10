import { NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'

// Counts each place a series's variables are *read*, plus the list of
// chapters that contain at least one read. The Context modal uses the
// counts for the overview table and the chapters list for the drill-in
// view (each row navigates to a chapter that uses the var).
//
// Writes (a choice's setsVariables payload) are deliberately not
// counted: a write the reader never reads back is effectively dead, and
// counting writes makes a write-only variable look heavily used when
// it's actually unused. "Reads" = conditions + text/template references.

type Counts = { conditions: number; text: number; total: number }
// `count` is the number of references the variable has *within* this
// chapter — sums across the chapters array equal the variable's total.
type Chapter = { bookId: string; bookTitle: string; bookOrder: number; chapterId: string; chapterTitle: string; chapterOrder: number; count: number }
// `originBook` is the title of the first book (by series order) that
// references the variable. Variables aren't stamped with an origin in
// the schema (they're series-level), so we derive it from the earliest
// reference. Null when the variable is unreferenced.
type Usage = Counts & { chapters: Chapter[]; originBook: string | null }

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

  // Per-variable accumulators. Each chapter that contains references
  // shows up once in the drill-in table; its `count` is the number of
  // references inside that chapter so the sums match the total badge.
  const usage: Record<string, Usage> = {}
  const chapterByVar: Record<string, Map<string, Chapter>> = {}
  for (const v of series.variables) {
    usage[v.name] = {
      conditions: 0, text: 0, total: 0, chapters: [],
      // Origin comes straight from the stamped column. Backfilled for
      // existing rows via prisma/scripts/backfill-variable-origins.ts
      // and stamped on creation by the POST /variables endpoint.
      originBook: v.originBook?.title ?? null,
    }
    chapterByVar[v.name] = new Map()
  }

  function bump(name: string, cat: keyof Counts) {
    const slot = usage[name]
    if (!slot || cat === 'total') return
    slot[cat]++
    slot.total++
  }
  function mark(name: string, location: Omit<Chapter, 'count'>) {
    const map = chapterByVar[name]
    if (!map) return
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
      const noteRefs = (names: string[], cat: keyof Counts) => {
        for (const n of names) { bump(n, cat); mark(n, loc) }
      }

      noteRefs(namesInCondition(chapter.condition), 'conditions')
      for (const block of chapter.blocks) {
        noteRefs(namesInCondition(block.condition), 'conditions')
        noteRefs(namesInTemplates(block.content), 'text')
        noteRefs(namesInTemplates(block.baseContent), 'text')
        for (const choice of block.choices) {
          // Choice.setsVariables (writes) intentionally omitted — only
          // reads count toward usage. See the file header.
          noteRefs(namesInTemplates(choice.endingMessage), 'text')
        }
        for (const override of block.overrides) {
          noteRefs(namesInCondition(override.condition), 'conditions')
          noteRefs(namesInTemplates(override.content), 'text')
          noteRefs(namesInTemplates(override.endingMessage), 'text')
        }
      }
    }
  }

  // Flush per-chapter maps into the response arrays, preserving the
  // book/chapter order the walk produced.
  for (const name of Object.keys(usage)) {
    usage[name].chapters = Array.from(chapterByVar[name].values())
  }

  return NextResponse.json(usage)
}
