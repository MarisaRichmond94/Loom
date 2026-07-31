import { NextResponse } from 'next/server'
import { stat } from 'fs/promises'
import path from 'path'
import { prisma } from '@/lib/prisma'
import { defaultStoryState, walkBook } from '@/lib/manuscript/walk'
import { loadManuscriptBook } from '@/lib/manuscript/loadBook'
import {
  chapterContentHash,
  findCanonDestDir,
  readManifest,
  safeManuscriptTitle,
} from '@/lib/manuscript/canonManifest'

// Is each book's canon export on disk current with the database? (KAN-13)
//
// The nightly backup used to answer this by comparing each .pages file's mtime
// against dev.db's. That could not work: dev.db is touched by an edit to ANY
// book, so its mtime is "now" every night, and every book the writer wasn't
// actively working on tripped the threshold. The warning fired most nights,
// for books that were perfectly fine, and so meant nothing.
//
// mtime is not evidence in the other direction either — a .pages file can be
// touched by something other than an export, and has been.
//
// This answers the question exactly instead of guessing. Every canon export
// writes a manifest sidecar holding a content hash per chapter; recomputing
// those hashes from the database and comparing is a direct answer to "does the
// manuscript on disk reflect the book as it is now?".
//
// Read-only by construction: it walks canon and hashes, but writes nothing —
// no export, no directory creation, no Pages round-trip. Safe to call from a
// backup script, and safe to call while the writer is working.

export const dynamic = 'force-dynamic'

type BookStatus = {
  bookId: string
  seriesId: string
  title: string
  order: number
  current: boolean
  // Why it is or isn't current. The backup script decides what deserves a
  // WARNING from this, so it has to be specific enough to act on.
  reason:
    | 'current'
    | 'content-drift'
    | 'no-manifest'
    | 'no-manuscript'
    | 'no-folder'
    | 'error'
  detail?: string
  exportedAt?: string
  manuscriptPath?: string
  manuscriptMtime?: string
  drift?: { changed: number; added: number; removed: number }
}

async function statusForBook(
  book: { id: string; seriesId: string; title: string; order: number },
): Promise<BookStatus> {
  const base = { bookId: book.id, seriesId: book.seriesId, title: book.title, order: book.order }

  const dest = await findCanonDestDir(book.title, { create: false })
  if ('error' in dest) {
    return { ...base, current: false, reason: 'no-folder', detail: dest.error }
  }

  const data = await loadManuscriptBook(book.seriesId, book.id)
  if (!data) return { ...base, current: false, reason: 'error', detail: 'Book could not be loaded.' }

  // The same walk the export performs: every variable at its default, no
  // overrides. Pure canon.
  const walked = walkBook(data.chapters, data.variables, defaultStoryState(data.variables), {})

  const manifest = await readManifest(dest.dir, book.title)

  const manuscriptPath = path.join(dest.dir, `${safeManuscriptTitle(book.title)}.pages`)
  let manuscriptMtime: string | undefined
  try {
    manuscriptMtime = (await stat(manuscriptPath)).mtime.toISOString()
  } catch {
    // A missing manuscript is unambiguous and worth shouting about, whatever
    // the manifest says.
    return { ...base, current: false, reason: 'no-manuscript', detail: manuscriptPath }
  }

  if (!manifest) {
    return {
      ...base,
      current: false,
      reason: 'no-manifest',
      detail: 'No readable manifest sidecar — export currency cannot be verified.',
      manuscriptPath,
      manuscriptMtime,
    }
  }

  // Compare by chapter id, so an inserted or deleted chapter reads as added or
  // removed rather than smearing into "everything after this point changed".
  const live = new Map(walked.chapters.map(c => [c.id, chapterContentHash(c)]))
  const onDisk = new Map(manifest.chapters.map(c => [c.id, c.contentHash]))

  let changed = 0
  let added = 0
  for (const [id, h] of live) {
    if (!onDisk.has(id)) added++
    else if (onDisk.get(id) !== h) changed++
  }
  let removed = 0
  for (const id of onDisk.keys()) if (!live.has(id)) removed++

  const drift = { changed, added, removed }
  const clean = changed === 0 && added === 0 && removed === 0

  return {
    ...base,
    current: clean,
    reason: clean ? 'current' : 'content-drift',
    exportedAt: manifest.exportedAt,
    manuscriptPath,
    manuscriptMtime,
    drift,
  }
}

export async function GET() {
  // Demo series are generated fixtures for the Explore page; they are never
  // exported and must not appear as perpetually-stale books in the log.
  const books = await prisma.book.findMany({
    where: { series: { demo: false } },
    select: { id: true, seriesId: true, title: true, order: true },
    orderBy: { order: 'asc' },
  })

  const results: BookStatus[] = []
  for (const b of books) {
    try {
      results.push(await statusForBook(b))
    } catch (err) {
      // One unreadable book must not deny the caller a verdict on the others.
      results.push({
        bookId: b.id,
        seriesId: b.seriesId,
        title: b.title,
        order: b.order,
        current: false,
        reason: 'error',
        detail: err instanceof Error ? err.message : String(err),
      })
    }
  }

  return NextResponse.json({
    checkedAt: new Date().toISOString(),
    books: results,
    stale: results.filter(r => !r.current).length,
  })
}
