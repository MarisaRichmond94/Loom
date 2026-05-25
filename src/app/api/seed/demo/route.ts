import { NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { GENRES } from '@/lib/genres'

// Word pools used to stitch together fake titles / descriptions /
// keywords. Picked from genre-appropriate vocabulary so the resulting
// Explore catalog feels plausibly populated rather than obviously
// generated. Cover art is intentionally omitted — series load with the
// placeholder tile, which is fine because the user only needs to see
// "how Explore feels with N entries" and doesn't plan to drill in.

const TITLE_NOUNS = [
  'Embers', 'Tides', 'Hollow', 'Glass', 'Echo', 'Vow', 'Lantern', 'Crown',
  'Atlas', 'Cipher', 'Veil', 'Reckoning', 'Whisper', 'Garden', 'Thread',
  'Storm', 'Sigil', 'Letter', 'Heir', 'Ledger', 'Asylum', 'Mirror',
  'Compass', 'Bone', 'Tower', 'Beacon', 'Field', 'Library', 'Shadow',
]

const TITLE_PREFIXES = [
  'The', 'A', 'Of', 'Beneath the', 'After the', 'Before the', 'Beyond the',
  'The Last', 'The First', 'The Lost', 'The Hidden', 'The Other',
]

const KEYWORDS_POOL = [
  'enemies-to-lovers', 'slow-burn', 'morally-grey', 'found-family',
  'rivals', 'secret-identity', 'time-loop', 'lost-civilization',
  'small-town', 'court-intrigue', 'forbidden-magic', 'multiple-povs',
  'unreliable-narrator', 'second-chance', 'arranged-marriage',
  'heist', 'inheritance', 'redemption', 'rebellion', 'memory-loss',
]

const DESC_OPENERS = [
  'When the borderlands awoke',
  'For three centuries the council had kept the truth buried',
  'No one expected the letter to be sealed in wax',
  'The first storm of the season brought',
  'In a city built atop the bones of older cities',
  'She returned to the village the same week the river ran black',
  'They said the lighthouse had been empty for years',
  'The marriage was supposed to be a formality',
]

const DESC_MIDDLES = [
  'a quiet apprentice found herself at the center of an old debt',
  'two estranged sisters were forced to share an inheritance neither understood',
  'a soldier learned that the war he had won had been a smaller war than he thought',
  'a translator was handed a letter she was forbidden to read',
  'a thief who never broke the same lock twice picked one she did not recognize',
  'a cartographer was hired to chart a forest that had no edges',
  'a former heir refused the crown a second time, and lived to regret it',
]

const DESC_CLOSERS = [
  'and the city would never look the same again.',
  'and somewhere, very far away, someone began to remember her name.',
  "and the door, which had been locked for sixty years, simply opened.",
  'and the storm passed without ever quite arriving.',
  'and an old promise came due, exactly as it had been written.',
  'and a single lantern was lit in a window the streets had long forgotten.',
]

function pick<T>(list: readonly T[]): T {
  return list[Math.floor(Math.random() * list.length)]
}

function pickMany<T>(list: readonly T[], count: number): T[] {
  const pool = [...list]
  const out: T[] = []
  for (let i = 0; i < count && pool.length > 0; i++) {
    const idx = Math.floor(Math.random() * pool.length)
    out.push(pool[idx])
    pool.splice(idx, 1)
  }
  return out
}

function randomTitle(): string {
  return `${pick(TITLE_PREFIXES)} ${pick(TITLE_NOUNS)} of ${pick(TITLE_NOUNS)}`
}

function randomDescription(): string {
  return `${pick(DESC_OPENERS)}, ${pick(DESC_MIDDLES)}, ${pick(DESC_CLOSERS)}`
}

export async function POST(req: Request) {
  const body = (await req.json().catch(() => ({}))) as { count?: unknown }
  const raw = typeof body.count === 'number' ? body.count : Number(body.count)
  if (!Number.isFinite(raw) || raw <= 0) {
    return NextResponse.json({ error: 'count must be a positive integer' }, { status: 400 })
  }
  // Clamp at 500 so an accidental 100_000 doesn't lock the DB.
  const count = Math.min(Math.floor(raw), 500)

  const created: { id: string }[] = []
  for (let i = 0; i < count; i++) {
    // 1–4 genres, 0–3 keywords for variety in the cards.
    const genres = pickMany(GENRES, 1 + Math.floor(Math.random() * 4))
    const keywords = pickMany(KEYWORDS_POOL, Math.floor(Math.random() * 4))
    // Each series gets 1–3 books; at least one is published so it
    // surfaces on Explore. Extras (if any) stay drafts so the
    // "5 BOOK(S) (1 PUBLISHED)" subline can render naturally.
    const totalBooks = 1 + Math.floor(Math.random() * 3)
    const publishedCount = 1 + Math.floor(Math.random() * totalBooks)

    const series = await prisma.series.create({
      data: {
        title: randomTitle(),
        description: randomDescription(),
        genres: JSON.stringify(genres),
        keywords: JSON.stringify(keywords),
        demo: true,
        books: {
          create: Array.from({ length: totalBooks }, (_, idx) => ({
            title: `Book ${idx + 1}`,
            order: idx + 1,
            published: idx < publishedCount,
          })),
        },
      },
    })
    created.push({ id: series.id })
  }
  return NextResponse.json({ created: created.length })
}

export async function DELETE() {
  // Cascade is set on Series.books / chapters / blocks, so deleting the
  // Series row is enough — Prisma takes care of the rest.
  const result = await prisma.series.deleteMany({ where: { demo: true } })
  return NextResponse.json({ deleted: result.count })
}
