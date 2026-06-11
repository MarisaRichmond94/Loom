// Backfill for StoryVariable.originBookId. Origin is defined as the
// earliest book whose question block (choice point) *writes* to the
// variable via setsVariables — i.e. where it first comes into
// existence in the reader's state.
//
// Fallbacks (in order):
//   1. Earliest book that writes the variable (preferred — "where it
//      was first created")
//   2. Earliest book that reads it (read-only variables still get a
//      sensible origin)
//   3. The series's in-progress book (newly-created variables that
//      haven't been wired up yet land on the writer's current book)
//
// Only stamps rows whose originBookId is currently null, so existing
// stamps (including ones set from the route layer at creation) aren't
// overwritten. To force a full re-stamp, delete the script's null
// filter or clear the column first.
//
// Run with: npx tsx prisma/scripts/backfill-variable-origins.ts
import { PrismaClient } from '../../src/generated/prisma/client'
import { PrismaBetterSqlite3 } from '@prisma/adapter-better-sqlite3'
import path from 'path'

const dbUrl = process.env.DATABASE_URL ?? 'file:./dev.db'
const dbPath = dbUrl.startsWith('file:')
  ? path.resolve(process.cwd(), dbUrl.slice('file:'.length))
  : dbUrl
const adapter = new PrismaBetterSqlite3({ url: dbPath })
const prisma = new PrismaClient({ adapter })

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
  } catch { /* malformed */ }
  return []
}

function namesInSetsVariables(raw: string | null | undefined): string[] {
  if (!raw) return []
  try {
    const v = JSON.parse(raw)
    if (v && typeof v === 'object') return Object.keys(v as Record<string, unknown>)
  } catch { /* malformed */ }
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

async function main() {
  const seriesList = await prisma.series.findMany({
    include: {
      // Only the variables that haven't been stamped yet.
      variables: { where: { originBookId: null } },
      books: {
        orderBy: { order: 'asc' },
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

  let updates = 0
  for (const series of seriesList) {
    if (series.variables.length === 0) continue
    // First pass: per-variable, capture the earliest book that writes
    // to it (preferred) and, separately, the earliest book that reads
    // it (fallback when nothing ever writes).
    const writeOrigin: Record<string, string> = {}
    const readOrigin: Record<string, string> = {}

    for (const book of series.books) {
      const writes = new Set<string>()
      const reads = new Set<string>()
      const noteRead = (names: string[]) => { for (const n of names) reads.add(n) }
      const noteWrite = (names: string[]) => { for (const n of names) writes.add(n) }
      for (const chapter of book.chapters) {
        noteRead(namesInCondition(chapter.condition))
        for (const block of chapter.blocks) {
          noteRead(namesInCondition(block.condition))
          noteRead(namesInTemplates(block.content))
          noteRead(namesInTemplates(block.baseContent))
          for (const choice of block.choices) {
            noteWrite(namesInSetsVariables(choice.setsVariables))
            noteRead(namesInTemplates(choice.endingMessage))
          }
          for (const override of block.overrides) {
            noteRead(namesInCondition(override.condition))
            noteRead(namesInTemplates(override.content))
            noteRead(namesInTemplates(override.endingMessage))
          }
        }
      }
      for (const name of writes) if (writeOrigin[name] == null) writeOrigin[name] = book.id
      for (const name of reads) if (readOrigin[name] == null) readOrigin[name] = book.id
    }

    // Final fallback for variables that nothing references yet:
    // stamp them with the writer's currently in-progress book. That
    // matches the layout's route-level stamp for newly-created
    // variables with no references.
    const inProgressBookId = series.books.find(b => b.inProgress)?.id ?? null

    let stamped = 0
    for (const v of series.variables) {
      const bookId = writeOrigin[v.name] ?? readOrigin[v.name] ?? inProgressBookId ?? null
      if (!bookId) continue
      await prisma.storyVariable.update({ where: { id: v.id }, data: { originBookId: bookId } })
      stamped++
      updates++
    }
    console.log(`Series "${series.title}": stamped ${stamped}/${series.variables.length} previously-null variables`)
  }

  console.log(`Done. ${updates} variable rows updated.`)
}

main()
  .catch(e => { console.error(e); process.exit(1) })
  .finally(() => prisma.$disconnect())
