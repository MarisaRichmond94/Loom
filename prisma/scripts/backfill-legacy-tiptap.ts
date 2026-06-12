// One-shot migration for legacy plain-text rows that pre-date the TipTap
// editor for branch text / override endingMessage. Wraps each raw string
// as a TipTap doc with one paragraph per non-empty line; rows that
// already start with `{` (proper JSON) are skipped. Re-runnable.
//
// Run with: npx tsx prisma/scripts/backfill-legacy-tiptap.ts

import { PrismaClient } from '../../src/generated/prisma/client'
import { PrismaBetterSqlite3 } from '@prisma/adapter-better-sqlite3'
import path from 'path'

const dbUrl = process.env.DATABASE_URL ?? 'file:./dev.db'
const dbPath = dbUrl.startsWith('file:')
  ? path.resolve(process.cwd(), dbUrl.slice('file:'.length))
  : dbUrl
const adapter = new PrismaBetterSqlite3({ url: dbPath })
const prisma = new PrismaClient({ adapter })

function toTipTap(raw: string): string {
  const paragraphs = raw.split(/\n+/).map(line => {
    const trimmed = line.trim()
    return trimmed
      ? { type: 'paragraph', content: [{ type: 'text', text: trimmed }] }
      : { type: 'paragraph' }
  })
  return JSON.stringify({ type: 'doc', content: paragraphs.length > 0 ? paragraphs : [{ type: 'paragraph' }] })
}

function isLegacy(s: string | null): s is string {
  return !!s && s.length > 0 && s[0] !== '{'
}

async function main() {
  const choices = await prisma.choice.findMany()
  let choiceCount = 0
  for (const c of choices) {
    if (!isLegacy(c.endingMessage)) continue
    await prisma.choice.update({ where: { id: c.id }, data: { endingMessage: toTipTap(c.endingMessage) } })
    choiceCount++
  }

  const overrides = await prisma.conditionalOverride.findMany()
  let overrideCount = 0
  for (const o of overrides) {
    if (!isLegacy(o.endingMessage)) continue
    await prisma.conditionalOverride.update({ where: { id: o.id }, data: { endingMessage: toTipTap(o.endingMessage) } })
    overrideCount++
  }

  console.log(`Migrated ${choiceCount} Choice rows and ${overrideCount} ConditionalOverride rows.`)
}

main()
  .catch(e => { console.error(e); process.exit(1) })
  .finally(() => prisma.$disconnect())
