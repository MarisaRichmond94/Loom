import { NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getLastTouchedChapter } from '@/lib/authorState'

// Companion-app jump target. WriteAI only knows the series by name (its
// "site name" setting), so it links here and we translate the title into
// the author route for the matching series — landing on the chapter the
// writer last opened when we know it (the editor stamps it on mount), so
// the jump resumes work rather than starting at the outline. No match
// falls through to the Write page, which lists every series — a soft
// landing rather than a 404 if the two apps' names ever drift apart.

type Params = { params: Promise<{ title: string }> }

export async function GET(req: Request, { params }: Params) {
  const { title } = await params
  const wanted = decodeURIComponent(title).trim().toLowerCase()

  // SQLite Prisma has no case-insensitive filter; the series list is tiny,
  // so match in memory.
  const series = await prisma.series.findMany({ select: { id: true, title: true } })
  const match = series.find(s => s.title.trim().toLowerCase() === wanted)
  if (!match) return NextResponse.redirect(new URL('/', req.url))

  let target = `/author/${match.id}`
  const last = await getLastTouchedChapter(match.id)
  if (last) {
    // Chapters can be deleted after being stamped — only deep-link while
    // the chapter still exists in this series.
    const chapter = await prisma.chapter.findUnique({
      where: { id: last.chapterId },
      select: { id: true, book: { select: { seriesId: true } } },
    })
    if (chapter?.book.seriesId === match.id) {
      target = `/author/${match.id}/chapter/${chapter.id}`
    }
  }
  return NextResponse.redirect(new URL(target, req.url))
}
