// Loom's local copy of WriteAI's writer-character pool — LOOM-86, under
// LOOM-5.
//
// ⚠️ WHY THIS EXISTS. `GET /api/plan/characters` writes to disk: it seeds the
// pool from canon on first call, prunes entries canon now classifies as
// non-characters, and rewrites `books` from numbers to names — saving the file
// whenever any of that changes. A route that looks like a cheap read is not
// one.
//
// Reader and preview pages render a cast list on every visit. Rendering must
// not mutate another application's data file, so those pages read the snapshot
// and only explicit, user-initiated moments refresh it. Availability is not
// the argument — both apps run on this machine — the write-on-read is.
//
// RULES for anything added here:
//   - Never call refresh() on a render path, a timer, an interval, or a retry
//     loop. Fetch on tab open and after a write, nothing else.
//   - Never store Loom-owned data in this table. It is a cache and must stay
//     rebuildable from WriteAI at any moment; per-book state belongs in
//     WriterCharacterMeta.

import { prisma } from '@/lib/prisma'
import { callWriteAi } from '@/lib/writeaiProxy'
import type { WriterCharacter } from '@/lib/characterSearch'

/** The snapshot as the rest of Loom consumes it — WriteAI's shape, restored. */
export type SnapshotCharacter = WriterCharacter & { syncedAt: Date }

/** JSON columns are stored as strings; SQLite has no list type. */
const parseList = <T,>(raw: string, fallback: T[]): T[] => {
  try {
    const parsed = JSON.parse(raw)
    return Array.isArray(parsed) ? (parsed as T[]) : fallback
  } catch {
    return fallback
  }
}

type SnapshotRow = {
  writerCharacterId: string
  name: string
  category: string | null
  role: string | null
  aliases: string | null
  traits: string
  arcNotes: string | null
  goals: string | null
  relationships: string
  books: string
  photoUrl: string | null
  syncedAt: Date
}

const fromRow = (row: SnapshotRow): SnapshotCharacter => ({
  id: row.writerCharacterId,
  name: row.name,
  category: row.category,
  role: row.role,
  aliases: row.aliases,
  traits: parseList<string>(row.traits, []),
  arc_notes: row.arcNotes,
  goals: row.goals,
  relationships: parseList<{ target: string; nature: string }>(row.relationships, []),
  books: parseList<string>(row.books, []),
  photo_url: row.photoUrl,
  syncedAt: row.syncedAt,
})

/** Every cached character, name-ordered. Never calls WriteAI. */
export async function readSnapshot(): Promise<SnapshotCharacter[]> {
  const rows = await prisma.writerCharacterSnapshot.findMany({ orderBy: { name: 'asc' } })
  return rows.map(fromRow)
}

/** One cached character, or null. Never calls WriteAI. */
export async function readSnapshotCharacter(id: string): Promise<SnapshotCharacter | null> {
  const row = await prisma.writerCharacterSnapshot.findUnique({ where: { writerCharacterId: id } })
  return row ? fromRow(row) : null
}

export type RefreshResult =
  | { ok: true; upserted: number; deleted: number }
  | { ok: false; unreachable: boolean; error: string }

/**
 * Pull WriteAI's pool and make the snapshot match it.
 *
 * Deletes rows WriteAI no longer has — the snapshot mirrors the pool rather
 * than accumulating it, so a character deleted there stops appearing here.
 * That is safe precisely because nothing Loom-owned lives in this table.
 *
 * On failure the existing snapshot is left ALONE. A WriteAI hiccup must not
 * empty Loom's cast list; a stale cast is a far better failure than no cast.
 */
export async function refreshWriterCharacterSnapshot(): Promise<RefreshResult> {
  const result = await callWriteAi('/api/plan/characters')
  if ('response' in result) {
    const status = result.response.status
    let error = `WriteAI responded ${status}`
    try {
      const body = await result.response.clone().json()
      error = body?.error ?? error
    } catch {
      /* non-JSON error body — the status is all we have */
    }
    return { ok: false, unreachable: status === 503, error }
  }

  // WriteAI answers `{ characters: [...], seeded: bool }` — the pool is
  // wrapped, and `seeded` reports whether that call just created the pool from
  // canon, which is the write-on-read this whole file exists to avoid doing on
  // a render. A bare array is accepted too, so a future unwrapping upstream
  // doesn't break Loom.
  const payload = result.data
  const pool =
    Array.isArray(payload) ? payload
    : payload !== null && typeof payload === 'object' && Array.isArray((payload as { characters?: unknown }).characters)
      ? (payload as { characters: unknown[] }).characters
      : null
  if (!pool) {
    return { ok: false, unreachable: false, error: 'WriteAI returned an unrecognised character pool' }
  }

  // Skip anything without a usable id or name rather than writing a row that
  // can never be matched to a tag, a meta row or a portrait.
  const characters = pool.filter(
    (c): c is WriterCharacter =>
      c !== null && typeof c === 'object' &&
      typeof (c as WriterCharacter).id === 'string' && (c as WriterCharacter).id.length > 0 &&
      typeof (c as WriterCharacter).name === 'string' && (c as WriterCharacter).name.length > 0,
  )

  const now = new Date()
  const data = characters.map(c => ({
    writerCharacterId: c.id,
    name: c.name,
    category: c.category ?? null,
    role: c.role ?? null,
    aliases: c.aliases ?? null,
    traits: JSON.stringify(c.traits ?? []),
    arcNotes: c.arc_notes ?? null,
    goals: c.goals ?? null,
    relationships: JSON.stringify(c.relationships ?? []),
    books: JSON.stringify(c.books ?? []),
    photoUrl: c.photo_url ?? null,
    syncedAt: now,
  }))

  // One transaction: the snapshot is never half-updated, and a failure
  // mid-write leaves the previous one intact.
  const ids = data.map(d => d.writerCharacterId)
  const results = await prisma.$transaction([
    ...data.map(d =>
      prisma.writerCharacterSnapshot.upsert({
        where: { writerCharacterId: d.writerCharacterId },
        create: d,
        update: d,
      }),
    ),
    prisma.writerCharacterSnapshot.deleteMany({ where: { writerCharacterId: { notIn: ids } } }),
  ])
  const deleted = results[results.length - 1] as { count: number }

  return { ok: true, upserted: data.length, deleted: deleted.count }
}
