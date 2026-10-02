// Is one book's canon export on disk current with the database? (KAN-13)
//
// Extracted from api/export-status so a caller that cares about ONE book does
// not have to walk and hash all of them (LOOM-157). The audiobook and EPUB
// builders read the .pages manuscript, not dev.db, so "is that file actually
// this book?" is a question the regenerate buttons have to be able to ask —
// and asking it series-wide to answer it for one card would hash every book on
// every menu open.
//
// The nightly backup still consumes the series-wide endpoint, which now calls
// straight into this. One implementation, so the two can never disagree about
// what "current" means.
//
// mtime is not evidence in either direction — a .pages file can be touched by
// something other than an export, and dev.db is touched by an edit to ANY
// book. This compares a content hash per chapter against the manifest sidecar
// every export writes, which is a direct answer rather than a guess.
//
// Read-only by construction: it walks canon and hashes, but writes nothing —
// no export, no directory creation, no Pages round-trip. Safe while the writer
// is working.

import { stat } from 'fs/promises'
import path from 'path'
import { defaultStoryState, walkBook } from '@/lib/manuscript/walk'
import { loadManuscriptBook } from '@/lib/manuscript/loadBook'
import {
  chapterContentHash,
  findCanonDestDir,
  readManifest,
  safeManuscriptTitle,
} from '@/lib/manuscript/canonManifest'

export type BookStatus = {
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

export async function statusForBook(
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

