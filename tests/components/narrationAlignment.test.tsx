import { existsSync } from 'fs'
import path from 'path'

import Database from 'better-sqlite3'

import { expandTimes } from '@shared/narrationTokens'
import { wrapWords } from '@shared/wrapWords'

// The one invariant the word-level highlight rests on (LOOM-131): DOM word N is
// timing word N.
//
// Nothing enforces that at runtime. The wrap walks the published HTML; the
// timing came from tokenizing the narration TEXT months earlier, server-side.
// They agree only because both split on the same rule — and when they stop
// agreeing, the failure is not an error. It is a highlight that lands one word
// late, then five, then a paragraph behind, which reads as "the audio feels
// off" rather than as a bug with a stack trace.
//
// So this checks the real thing rather than a fixture: every narrated chapter
// in the published snapshot, wrapped exactly as the browser wraps it, counted
// against its own timing array.
//
// content.db is a PUBLISHED SNAPSHOT, not dev.db — the reader tier's own data,
// opened readonly. It is gitignored and machine-local, so the suite skips
// cleanly on a checkout that has never published.

// Overridable so a candidate snapshot can be checked before it replaces the
// live one — publish is manual and button-driven on purpose, and verifying a
// change should not require rewriting what the reader tier is serving.
const DB = process.env.READER_CONTENT_DB ?? path.join(__dirname, '../../reader/content.db')

// Also skipped on a snapshot published before blockIds existed: that is a
// snapshot awaiting a republish, not a regression, and the reader says so
// plainly rather than this failing in its place.
const hasBlockIds = () => {
  if (!existsSync(DB)) return false
  const db = new Database(DB, { readonly: true })
  try {
    return (db.pragma('table_info(Narration)') as { name: string }[]).some(c => c.name === 'blockIds')
  } catch {
    return false
  } finally {
    db.close()
  }
}

const describeIfPublished = hasBlockIds() ? describe : describe.skip

describeIfPublished('published narration stays 1:1 with the prose it highlights', () => {
  type Row = { chapterId: string; label: string; book: string; timing: string | null; durationMs: number }

  let rows: Row[] = []
  let blocksFor: (chapterId: string) => { id: string; content: string }[]

  beforeAll(() => {
    const db = new Database(DB, { readonly: true })
    rows = db.prepare(`
      SELECT n.chapterId, c.label, b.title AS book, n.timing, n.durationMs
      FROM Narration n
      JOIN Chapter c ON c.id = n.chapterId
      JOIN Book b ON b.id = c.bookId
      ORDER BY b.title, c."order"
    `).all() as Row[]
    // The blocks publish recorded as spoken, in publish's order — the same list
    // the browser walks. Re-deriving it here ("every non-soundtrack block")
    // would make this test agree with a guess instead of with the snapshot.
    const stmt = db.prepare(`SELECT id, content FROM ContentBlock WHERE id = ?`)
    blocksFor = (chapterId: string) => {
      const ids = JSON.parse(
        (db.prepare(`SELECT blockIds FROM Narration WHERE chapterId = ?`).get(chapterId) as { blockIds: string }).blockIds,
      ) as string[]
      return ids.map(id => stmt.get(id) as { id: string; content: string }).filter(Boolean)
    }
  })

  it('has narrated chapters to check', () => {
    expect(rows.length).toBeGreaterThan(0)
  })

  it('wraps exactly as many words as the timing describes, chapter by chapter', () => {
    // Reported in aggregate rather than as one failing chapter: a split-rule
    // regression breaks EVERY chapter at once, and "3 of 113" versus "113 of
    // 113" is the difference between stale recordings and a real bug.
    const drifted: string[] = []

    for (const row of rows) {
      const timing = row.timing ? JSON.parse(row.timing) : []
      const expected = expandTimes(timing, row.durationMs).length

      // Same containers, same order, same continuous numbering as ChapterView.
      const host = document.createElement('div')
      document.body.appendChild(host)
      let wi = 0
      for (const b of blocksFor(row.chapterId)) {
        const el = document.createElement('div')
        el.innerHTML = b.content
        host.appendChild(el)
        wi = wrapWords(el, wi)
      }
      host.remove()

      if (wi !== expected) drifted.push(`${row.book} ${row.label}: ${wi} words vs ${expected} timings`)
    }

    // EXACT, not "mostly". A recording that predates a prose edit does not
    // drift here — it fails the canon content hash and publishes silent, so
    // every row that exists at all was recorded from the very prose beside it.
    // The measured state of the real snapshot is 0 of 113.
    expect(drifted).toEqual([])
  })
})
