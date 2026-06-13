import { NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'

type Params = { params: Promise<{ bookId: string }> }

// Generalised "<prefix> <number>" detector: handles bare numbers ("14"),
// the canonical "Chapter 14", and any author-coined prefix like
// "Bonus Chapter 1" / "Interlude 3" / "Epilogue 1".
function parseNumberedTitle(title: string): { prefix: string; num: number } | null {
  const bare = /^(\d+)$/.exec(title)
  if (bare) return { prefix: '', num: Number(bare[1]) }
  const m = /^(.+\s)(\d+)$/.exec(title)
  if (m) return { prefix: m[1], num: Number(m[2]) }
  return null
}

// Bump a chapter title only when its prefix exactly matches `matchPrefix`.
// Other titles pass through untouched. This is what keeps a sibling
// "Bonus Chapter 1" stable when the writer inserts a new "Chapter X" —
// only the "Chapter " series shifts.
function bumpTitleIfPrefixMatches(title: string, delta: number, matchPrefix: string): string {
  const parsed = parseNumberedTitle(title)
  if (!parsed || parsed.prefix !== matchPrefix) return title
  return `${parsed.prefix}${parsed.num + delta}`
}

export async function POST(req: Request, { params }: Params) {
  const { bookId } = await params
  const { title, insertAtOrder } = await req.json()
  if (!title?.trim()) return NextResponse.json({ error: 'title required' }, { status: 400 })

  // New chapters inherit pov/date from the chapter that comes just
  // before them in order — writers usually continue the same POV across
  // chapters, and dates either repeat or advance from the previous one.
  // The Author can edit both fields after the navigate; this is just a
  // smarter default than "blank".
  async function previousChapterMeta(beforeOrder: number): Promise<{ pov: string | null; date: string | null }> {
    const prev = await prisma.chapter.findFirst({
      where: { bookId, order: { lt: beforeOrder } },
      orderBy: { order: 'desc' },
    })
    return { pov: prev?.pov ?? null, date: prev?.date ?? null }
  }

  if (insertAtOrder == null) {
    const count = await prisma.chapter.count({ where: { bookId } })
    const inheritedMeta = await previousChapterMeta(count + 1)
    const chapter = await prisma.chapter.create({
      data: { bookId, title: title.trim(), order: count + 1, ...inheritedMeta },
    })
    return NextResponse.json(chapter, { status: 201 })
  }

  const existing = await prisma.chapter.findMany({ where: { bookId }, orderBy: { order: 'asc' } })
  const toShift = existing.filter(c => c.order >= insertAtOrder)
  // Order always shifts (it's positional). Title only shifts on
  // chapters that share the inserted title's prefix — if the inserted
  // title has no parseable "<prefix> <number>" shape, no titles shift.
  const trimmedTitle = title.trim()
  const insertedParsed = parseNumberedTitle(trimmedTitle)
  const matchPrefix = insertedParsed?.prefix ?? null

  const chapter = await prisma.$transaction(async tx => {
    for (const c of toShift) {
      const newTitle = matchPrefix !== null
        ? bumpTitleIfPrefixMatches(c.title, 1, matchPrefix)
        : c.title
      await tx.chapter.update({
        where: { id: c.id },
        data: { order: c.order + 1, title: newTitle },
      })
    }
    const inheritedMeta = await previousChapterMeta(insertAtOrder)
    return tx.chapter.create({
      data: { bookId, title: trimmedTitle, order: insertAtOrder, ...inheritedMeta },
    })
  })

  return NextResponse.json(chapter, { status: 201 })
}
