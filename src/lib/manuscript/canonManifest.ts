import { createHash } from 'crypto'
import path from 'path'
import { readFile } from 'fs/promises'
import { mkdir, readdir } from 'fs/promises'
import { readCanonExportSettings } from '@/lib/canonExportSettings'

// Shared shape and identity of the canon export's manifest sidecar.
//
// This file exists so the canon export (which WRITES manifests) and the export
// status check (which READS them to decide whether an export is current) agree
// by construction. If the per-chapter hash were computed in two places, the two
// would eventually drift and the status check would report every book as stale
// forever — which is exactly the class of bug KAN-13 is fixing. One formula,
// one caller each side.

export type WalkedChapter = {
  id: string
  label: string
  pov: string | null
  date: string | null
  contents: unknown[]
  numbered: boolean
}

/**
 * Identity of a single chapter's canon content.
 *
 * Deliberately covers only what the reader would see as the chapter: its
 * heading, its POV/date metadata, and its blocks. NOT formatting settings,
 * template styles, or the author name — those change the .pages bytes but not
 * the manuscript, and treating a font change as "your backup is stale" would
 * put us straight back to warnings that carry no signal.
 */
export function chapterContentHash(ch: Pick<WalkedChapter, 'label' | 'pov' | 'date' | 'contents'>): string {
  return createHash('sha256')
    .update(JSON.stringify({ label: ch.label, pov: ch.pov, date: ch.date, contents: ch.contents }))
    .digest('hex')
}

// The manuscript filename is derived from the title, so both sides have to
// sanitize it identically to find each other's files.
export function safeManuscriptTitle(bookTitle: string): string {
  return bookTitle.replace(/[/\\:]/g, '-').trim() || 'Manuscript'
}

// Apostrophes and unicode composition are the realistic ways a folder name and
// a DB title drift apart while still "being" the same title.
export function normalizeTitle(s: string): string {
  return s.normalize('NFC').replace(/[‘’]/g, "'").trim().toLowerCase()
}

/**
 * Locate a book's canon export folder.
 *
 * `create` is the difference between the export path and the status path: the
 * export makes the directory it is about to write into, while a status check
 * must never create anything — a read-only question that leaves empty folders
 * behind is a read-only question that lies.
 */
export async function findCanonDestDir(
  bookTitle: string,
  { create }: { create: boolean },
): Promise<{ dir: string } | { error: string }> {
  const { root, subfolder } = await readCanonExportSettings()
  let entries
  try {
    entries = await readdir(root, { withFileTypes: true })
  } catch {
    return { error: `Canon save folder not found at ${root}. Set it under Settings → Export.` }
  }
  const want = normalizeTitle(bookTitle)
  const matches = entries
    .filter(e => e.isDirectory())
    .filter(e => normalizeTitle(e.name.replace(/^\d+\.\s*/, '')) === want)
  if (matches.length === 0) return { error: `No folder matching "${bookTitle}" in ${root}.` }
  if (matches.length > 1) {
    return { error: `Multiple folders match "${bookTitle}": ${matches.map(m => m.name).join(', ')}.` }
  }
  const dir = path.join(root, matches[0].name, subfolder)
  if (create) await mkdir(dir, { recursive: true })
  return { dir }
}

export type Manifest = {
  manifestVersion: number
  seriesId?: string
  bookId?: string
  bookTitle: string
  exportedAt: string
  contentHash: string
  chapterCount: number
  chapters: { id: string; number: number | null; label: string; contentHash: string }[]
}

export async function readManifest(dir: string, bookTitle: string): Promise<Manifest | null> {
  try {
    const raw = await readFile(path.join(dir, `${safeManuscriptTitle(bookTitle)}.manifest.json`), 'utf-8')
    const parsed = JSON.parse(raw) as Manifest
    // A manifest we cannot read chapter hashes out of is not usable evidence.
    // Treated as absent rather than as a match, so a corrupted sidecar reports
    // a problem instead of silently passing.
    if (!Array.isArray(parsed.chapters)) return null
    return parsed
  } catch {
    return null
  }
}
