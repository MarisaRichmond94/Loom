import { NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { replaceInString, replaceInTipTapJson } from '@/lib/replaceInTipTap'
import { refreshBlockWordCounts } from '@/lib/wordCounts'

type Params = { params: Promise<{ seriesId: string }> }

// POST /api/series/[seriesId]/replace/single
// Body: { find, replace, recordKind, recordId, field }
//
// Replaces every occurrence of `find` within ONE specific column on ONE
// specific row — the row + field the writer hovered in the search
// dropdown. Lets the writer pick off matches one at a time without
// firing the bulk Replace All flow. Returns the count actually
// rewritten so the UI can show a brief acknowledgement.
//
// Chapter titles are intentionally NOT handled here (recordKind='chapter')
// because renaming a chapter touches the prefix-aware renumber cascade,
// which is a separate flow.
export async function POST(req: Request, { params }: Params) {
  await params
  const body = await req.json() as {
    find?: string
    replace?: string
    recordKind?: 'block' | 'choice' | 'override' | 'chapter'
    recordId?: string
    field?: string
    caseSensitive?: boolean
    wholeWord?: boolean
  }
  const find = (body.find ?? '').trim()
  const replace = body.replace ?? ''
  const opts = { caseSensitive: !!body.caseSensitive, wholeWord: !!body.wholeWord }
  const { recordKind, recordId, field } = body
  if (!find || !recordKind || !recordId || !field) {
    return NextResponse.json({ error: 'find, recordKind, recordId, and field are required' }, { status: 400 })
  }
  if (recordKind === 'chapter') {
    return NextResponse.json({ error: 'Chapter title replace is not supported via this endpoint' }, { status: 400 })
  }

  // Pull the current value, apply the replace, write it back. Field-by-
  // field switch keeps types tight and rules out any sketchy dynamic
  // column writes.
  let count = 0
  // The chapter this row belongs to, reported back so the client can reload
  // an editor that has it open — otherwise that editor still holds the
  // pre-replace prose and PATCHes it back on the next keystroke.
  let chapterId: string | null = null

  if (recordKind === 'block') {
    const row = await prisma.contentBlock.findUnique({ where: { id: recordId } })
    if (!row) return NextResponse.json({ error: 'Not found' }, { status: 404 })
    chapterId = row.chapterId
    if (field === 'content') {
      const r = replaceInTipTapJson(row.content, find, replace, opts)
      if (r.count > 0) {
        await prisma.contentBlock.update({ where: { id: recordId }, data: { content: r.json ?? '' } })
        await refreshBlockWordCounts([recordId])
      }
      count = r.count
    } else if (field === 'baseContent') {
      const r = replaceInTipTapJson(row.baseContent, find, replace, opts)
      if (r.count > 0) {
        await prisma.contentBlock.update({ where: { id: recordId }, data: { baseContent: r.json ?? '' } })
        await refreshBlockWordCounts([recordId])
      }
      count = r.count
    } else if (field === 'prompt') {
      const r = replaceInString(row.prompt, find, replace, opts)
      if (r.count > 0) await prisma.contentBlock.update({ where: { id: recordId }, data: { prompt: r.value ?? '' } })
      count = r.count
    } else {
      return NextResponse.json({ error: `Unsupported field for block: ${field}` }, { status: 400 })
    }
  } else if (recordKind === 'choice') {
    const row = await prisma.choice.findUnique({
      where: { id: recordId },
      include: { choicePoint: { select: { chapterId: true } } },
    })
    if (!row) return NextResponse.json({ error: 'Not found' }, { status: 404 })
    chapterId = row.choicePoint.chapterId
    if (field === 'label') {
      const r = replaceInString(row.label, find, replace, opts)
      if (r.count > 0) await prisma.choice.update({ where: { id: recordId }, data: { label: r.value ?? '' } })
      count = r.count
    } else if (field === 'endingMessage') {
      const r = replaceInTipTapJson(row.endingMessage, find, replace, opts)
      if (r.count > 0) await prisma.choice.update({ where: { id: recordId }, data: { endingMessage: r.json ?? '' } })
      count = r.count
    } else {
      return NextResponse.json({ error: `Unsupported field for choice: ${field}` }, { status: 400 })
    }
  } else {
    const row = await prisma.conditionalOverride.findUnique({
      where: { id: recordId },
      include: { conditionalFragment: { select: { chapterId: true } } },
    })
    if (!row) return NextResponse.json({ error: 'Not found' }, { status: 404 })
    chapterId = row.conditionalFragment.chapterId
    if (field === 'content') {
      const r = replaceInTipTapJson(row.content, find, replace, opts)
      if (r.count > 0) {
        await prisma.conditionalOverride.update({ where: { id: recordId }, data: { content: r.json ?? '' } })
        await refreshBlockWordCounts([row.conditionalFragmentId])
      }
      count = r.count
    } else if (field === 'endingMessage') {
      const r = replaceInTipTapJson(row.endingMessage, find, replace, opts)
      if (r.count > 0) await prisma.conditionalOverride.update({ where: { id: recordId }, data: { endingMessage: r.json ?? '' } })
      count = r.count
    } else {
      return NextResponse.json({ error: `Unsupported field for override: ${field}` }, { status: 400 })
    }
  }

  // Only report the chapter when something actually changed — a no-op
  // replace shouldn't make an open editor reload.
  return NextResponse.json({ count, chapterIds: count > 0 && chapterId ? [chapterId] : [] })
}
