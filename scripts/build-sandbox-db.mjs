// Build sandbox.db — the synthetic fixture every reader-tier ticket develops
// and tests against (LOOM-125, under LOOM-124).
//
// WHY THIS EXISTS
// dev.db IS production: no separate prod database, and it holds the only copy
// of the prose. Nothing in the reader tier may be developed against it. This
// script produces a small stand-in carrying every structural feature the
// publish pipeline has to handle, so the rules can be tested without the
// manuscript being anywhere near the test run.
//
// ALL PROSE HERE IS SYNTHETIC AND DELIBERATELY BAD. Never seed this from real
// content — the fixture is committed-adjacent and read by tests, and the
// manuscript must not enter that path.
//
// Usage: node scripts/build-sandbox-db.mjs
//
// Schema comes from prisma/migrations via `migrate deploy`, not from a copy of
// dev.db's schema, so the fixture tracks the migrations rather than whatever
// shape production happens to be in.

import Database from 'better-sqlite3'
import { createHash } from 'node:crypto'
import { execFileSync } from 'node:child_process'
import { rmSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..')
const SANDBOX = path.join(root, 'sandbox.db')

// Mirrors isProductionDbPath() in src/lib/dbSafety.ts. Duplicated rather than
// imported because that module is TypeScript and this is a plain .mjs script —
// a small duplication is a fair price for a script that creates and destroys
// database files being unable to aim at the manuscript.
const base = path.basename(SANDBOX)
if (base === 'dev.db' || base.startsWith('dev.db.')) {
  throw new Error(`Refusing to build the fixture over the manuscript: ${SANDBOX}`)
}

console.log('• removing any previous fixture')
for (const suffix of ['', '-wal', '-shm']) rmSync(SANDBOX + suffix, { force: true })

console.log('• applying migrations')
execFileSync('npx', ['prisma', 'migrate', 'deploy'], {
  cwd: root,
  // An explicitly-set DATABASE_URL wins over the one dotenv loads from .env
  // (dotenv does not override existing vars), so this cannot reach dev.db.
  env: { ...process.env, DATABASE_URL: 'file:./sandbox.db' },
  stdio: ['ignore', 'ignore', 'inherit'],
})

const db = new Database(SANDBOX)
db.pragma('foreign_keys = ON')

/** TipTap doc JSON, the shape ContentBlock.content actually holds. */
const doc = (...paragraphs) =>
  JSON.stringify({
    type: 'doc',
    content: paragraphs.map(text => ({
      type: 'paragraph',
      attrs: { textAlign: null, indent: true },
      content: [{ type: 'text', text }],
    })),
  })

const insert = (table, row) => {
  const cols = Object.keys(row)
  db.prepare(
    `INSERT INTO "${table}" (${cols.map(c => `"${c}"`).join(',')}) VALUES (${cols.map(c => `@${c}`).join(',')})`,
  ).run(row)
}

const SERIES = 'sbx-series'
const B1 = 'sbx-book-1'
const B2 = 'sbx-book-2'
const B3 = 'sbx-book-3-draft'

db.transaction(() => {
  insert('Series', {
    id: SERIES,
    title: 'The Sandbox Cycle',
    description: 'Synthetic fixture series. Every word here is throwaway.',
    genres: JSON.stringify(['Fantasy', 'Mystery']),
    keywords: JSON.stringify(['found-family', 'slow-burn']),
    standalone: 0,
    demo: 0,
    createdAt: '2026-01-01 00:00:00',
  })

  insert('StoryVariable', { id: 'sbx-var-lantern', seriesId: SERIES, name: 'tookTheLantern', type: 'boolean', defaultValue: 'false' })
  insert('StoryVariable', { id: 'sbx-var-ferryman', seriesId: SERIES, name: 'spokeToFerryman', type: 'boolean', defaultValue: 'false' })
  // An ACCUMULATOR, and the reason canon is not fully determined by the data.
  //
  // A pure canon walk passes defaultStoryState(variables) as its target, so a
  // choice assigning a value that differs from a variable's default
  // contradicts the target and is filtered out — usually leaving exactly one
  // candidate, which resolves cleanly with no author input.
  //
  // `+=` / `-=` choices break that. contradictsTarget() cannot compare an
  // accumulation to a target value, so it returns false for BOTH sides and
  // neither is filtered. Two survivors → ambiguous → the export refuses and
  // waits for a human. This is the real shape in the manuscript, where
  // emmaTrustScore is driven by exactly this ±1 pattern.
  insert('StoryVariable', { id: 'sbx-var-trust', seriesId: SERIES, name: 'sandboxTrustScore', type: 'number', defaultValue: '0' })

  // B1 and B2 published; B3 a draft. B3 carries a cover ON PURPOSE: LOOM-128
  // must prove it does not copy a draft's cover to the reader tier.
  insert('Book', { id: B1, seriesId: SERIES, title: 'Ashfall', synopsis: 'Book one.', coverPath: '/covers/sbx-book-1.jpg', order: 1, published: 1, inProgress: 0 })
  insert('Book', { id: B2, seriesId: SERIES, title: 'Tidewater', synopsis: 'Book two.', coverPath: '/covers/sbx-book-2.jpg', order: 2, published: 1, inProgress: 1 })
  insert('Book', { id: B3, seriesId: SERIES, title: 'The Unfinished Book', synopsis: 'SPOILER SYNOPSIS — must never reach the reader tier.', coverPath: '/covers/sbx-book-3.jpg', order: 3, published: 0, inProgress: 0 })

  // ---- Book 1 chapters -----------------------------------------------------
  // numbered:false — the prologue case, which the canon walk labels by title
  // rather than by counter.
  insert('Chapter', { id: 'sbx-b1-c0', bookId: B1, title: 'Prologue', order: 1, numbered: 0, pov: 'Mara', date: 'Spring, Year 1' })
  insert('Chapter', { id: 'sbx-b1-c1', bookId: B1, title: 'The Lantern', order: 2, numbered: 1, pov: 'Mara', date: 'Spring, Year 1' })
  insert('Chapter', { id: 'sbx-b1-c2', bookId: B1, title: 'The Crossing', order: 3, numbered: 1, pov: 'Selis', date: 'Summer, Year 1' })
  insert('Chapter', { id: 'sbx-b1-c3', bookId: B1, title: 'Ashfall', order: 4, numbered: 1, pov: 'Mara', date: 'Autumn, Year 1' })

  insert('ContentBlock', { id: 'sbx-b1-c0-b1', chapterId: 'sbx-b1-c0', order: 1, type: 'text', content: doc('The ash began before anyone thought to write it down.'), wordCount: 10 })

  insert('ContentBlock', { id: 'sbx-b1-c1-b1', chapterId: 'sbx-b1-c1', order: 1, type: 'text', content: doc('Mara found the lantern where the road gave out.'), wordCount: 9 })
  // soundtrack content is a media PATH, not TipTap JSON. LOOM-127 must publish
  // this block as a row; walkBook drops it, which is the bug that ticket fixes.
  insert('ContentBlock', { id: 'sbx-b1-c1-b2', chapterId: 'sbx-b1-c1', order: 2, type: 'soundtrack', content: '/music/sbx-lantern-theme.mp3', wordCount: 0 })
  insert('ContentBlock', { id: 'sbx-b1-c1-cp', chapterId: 'sbx-b1-c1', order: 3, type: 'choice_point', prompt: 'Take the lantern?', wordCount: 0 })

  // AMBIGUOUS BY DESIGN — both sides move the same accumulator, so neither
  // contradicts the target and both survive the filter. walkBook flags
  // `ambiguous` and falls back to array order; publish must REFUSE rather than
  // take that guess, until LOOM-126 stores the author's pick.
  insert('Choice', { id: 'sbx-cp1-a', choicePointId: 'sbx-b1-c1-cp', order: 1, label: 'Take it', setsVariables: JSON.stringify({ sandboxTrustScore: { op: '+=', value: 1 } }), isBadEnding: 0, endsChapter: 0 })
  insert('Choice', { id: 'sbx-cp1-b', choicePointId: 'sbx-b1-c1-cp', order: 2, label: 'Leave it', setsVariables: JSON.stringify({ sandboxTrustScore: { op: '-=', value: 1 } }), isBadEnding: 0, endsChapter: 0 })

  insert('ContentBlock', { id: 'sbx-b1-c2-b1', chapterId: 'sbx-b1-c2', order: 1, type: 'text', content: doc('The ferryman did not look up.'), wordCount: 6 })
  // Condition-gated block (LOOM-138). tookTheLantern defaults to false, so this
  // is NOT on the canon path and must never reach the reader tier. Before
  // LOOM-138 the walk could not see this gate at all and included it.
  //
  // Lives in chapter 2, NOT the narration fixture chapter: narrationSegments
  // does not evaluate block conditions (it only gates unanswered choice
  // points), so a gated block here would be spoken and would change the
  // chapter's variant hash. Publish must reproduce Loom's hashing exactly —
  // bugs included — or it would match no existing recording at all.
  insert('ContentBlock', { id: 'sbx-b1-c2-b1g', chapterId: 'sbx-b1-c2', order: 2, type: 'text', condition: JSON.stringify({ tookTheLantern: true }), content: doc('GATED PROSE — only if she took the lantern. Must never reach a reader.'), wordCount: 12 })
  insert('ContentBlock', { id: 'sbx-b1-c2-cf', chapterId: 'sbx-b1-c2', order: 3, type: 'conditional_fragment', wordCount: 0 })
  // Fires under canon (tookTheLantern=false at defaults). LOOM-127 publishes the
  // MATCHED override as a resolved text block; the unmatched one must not ship.
  insert('ConditionalOverride', { id: 'sbx-cf-nolantern', conditionalFragmentId: 'sbx-b1-c2-cf', order: 1, condition: JSON.stringify({ tookTheLantern: false }), content: doc('Empty-handed, she paid in coin.'), endsChapter: 0 })
  insert('ConditionalOverride', { id: 'sbx-cf-lantern', conditionalFragmentId: 'sbx-b1-c2-cf', order: 2, condition: JSON.stringify({ tookTheLantern: true }), content: doc('BRANCH ONLY — the lantern bought her passage. Must never reach a reader.'), endsChapter: 0 })
  insert('ContentBlock', { id: 'sbx-b1-c2-cp', chapterId: 'sbx-b1-c2', order: 4, type: 'choice_point', prompt: 'Speak to the ferryman?', wordCount: 0 })
  // Exactly ONE non-bad-ending choice → unambiguous, and it endsChapter.
  insert('Choice', { id: 'sbx-cp2-a', choicePointId: 'sbx-b1-c2-cp', order: 1, label: 'Say nothing', setsVariables: JSON.stringify({ spokeToFerryman: false }), isBadEnding: 0, endsChapter: 1, endingMessage: doc('The crossing took the rest of the night.') })
  insert('Choice', { id: 'sbx-cp2-bad', choicePointId: 'sbx-b1-c2-cp', order: 2, label: 'Ask his name', setsVariables: JSON.stringify({ spokeToFerryman: true }), isBadEnding: 1, endsChapter: 0, endingMessage: doc('BAD ENDING PROSE — the river took her. Must never reach a reader.') })

  // Chapter 3 is deliberately ONE plain block: it is the narration fixture, and
  // its variant hash is computed by hand below. Keep the gated block out of it.
  insert('ContentBlock', { id: 'sbx-b1-c3-b1', chapterId: 'sbx-b1-c3', order: 1, type: 'text', content: doc('Ashfall, and then nothing at all for a while.'), wordCount: 9 })

  // ---- Book 2 --------------------------------------------------------------
  insert('Chapter', { id: 'sbx-b2-c1', bookId: B2, title: 'Tidewater', order: 1, numbered: 1, pov: 'Idris' })
  insert('ContentBlock', { id: 'sbx-b2-c1-b1', chapterId: 'sbx-b2-c1', order: 1, type: 'text', content: doc('Idris arrived with the tide, two years late.'), wordCount: 8 })

  // ---- Book 3 (draft) ------------------------------------------------------
  // Deliberately has real chapters and prose. LOOM-127/131 must prove none of
  // it is reachable — the book publishes as a title+order stub only.
  insert('Chapter', { id: 'sbx-b3-c1', bookId: B3, title: 'Unfinished', order: 1, numbered: 1 })
  insert('ContentBlock', { id: 'sbx-b3-c1-b1', chapterId: 'sbx-b3-c1', order: 1, type: 'text', content: doc('DRAFT PROSE — must never reach the reader tier.'), wordCount: 8 })

  // ---- Narration -----------------------------------------------------------
  // Chapter 1 narrated along TWO paths. Publish must pick by the hash of the
  // canon-flattened text, never "first row" (LOOM-128). Hashes are placeholders
  // until LOOM-127 fixes the hashing function; the point is that two rows share
  // a chapterId and differ only by contentHash.
  const now = '2026-01-01 00:00:00'
  insert('ChapterNarration', { id: 'sbx-narr-c1-canon', chapterId: 'sbx-b1-c1', voice: 'sandbox', audioPath: '/narration/sbx-b1-c1-canon.mp3', timing: '[]', contentHash: 'sbx-hash-canon-path', durationMs: 1000, createdAt: now, updatedAt: now })
  insert('ChapterNarration', { id: 'sbx-narr-c1-branch', chapterId: 'sbx-b1-c1', voice: 'sandbox', audioPath: '/narration/sbx-b1-c1-branch.mp3', timing: '[]', contentHash: 'sbx-hash-branch-path', durationMs: 1200, createdAt: now, updatedAt: now })
  // Chapter 3 gets a recording of its ACTUAL canon text, hashed the way
  // src/lib/narration does it (sha256 over voice + NUL + text, folded again
  // over the joined segment hashes). Publish must find this one. Computed here
  // rather than hardcoded so it survives an edit to the chapter's prose.
  const VOICE = 'Tom (Enhanced)'
  const nHash = text => createHash('sha256').update(VOICE).update('\0').update(text).digest('hex')
  // One plain paragraph, no templates, one text block on the canon path — so
  // the spoken text is just that sentence, and the plan is a single segment.
  const c3Text = 'Ashfall, and then nothing at all for a while.'
  const c3Variant = nHash(nHash(c3Text))
  insert('ChapterNarration', { id: 'sbx-narr-c3-canon', chapterId: 'sbx-b1-c3', voice: VOICE, audioPath: '/narration/sbx-b1-c3.m4a', timing: '[]', contentHash: c3Variant, durationMs: 900, createdAt: now, updatedAt: now })

  // ---- Characters ----------------------------------------------------------
  // Three shapes the per-book projection has to get right (LOOM-127):
  //   mara  — present from book 1, age differs per book
  //   selis — present from book 1, DIES in book 2. Book 1's projection must not
  //           leak that; deathBookId is an input to the projection, never output.
  //   idris — first appears in book 2. Must be ABSENT from book 1 entirely,
  //           not present-with-visible:false.
  for (const [id, name, photoUrl] of [
    ['sbx-char-mara', 'Mara', '/characters/sbx-char-mara.jpg'],
    ['sbx-char-selis', 'Selis', null],
    ['sbx-char-idris', 'Idris', null],
  ]) {
    insert('WriterCharacterSnapshot', { writerCharacterId: id, name, category: 'main', role: 'protagonist', aliases: '[]', traits: '[]', arcNotes: '', goals: '', relationships: '[]', books: JSON.stringify([B1]), photoUrl, syncedAt: now })
  }
  insert('WriterCharacterMeta', { id: 'sbx-meta-mara', seriesId: SERIES, writerCharacterId: 'sbx-char-mara', age: 24, starred: 1, firstBookId: B1 })
  insert('WriterCharacterMeta', { id: 'sbx-meta-selis', seriesId: SERIES, writerCharacterId: 'sbx-char-selis', age: 31, starred: 0, firstBookId: B1, deathBookId: B2, lastBookId: B2 })
  insert('WriterCharacterMeta', { id: 'sbx-meta-idris', seriesId: SERIES, writerCharacterId: 'sbx-char-idris', age: 19, starred: 0, firstBookId: B2 })
  // Age override — book 2's projection should show 25, book 1's should show 24.
  insert('WriterCharacterBookMeta', { id: 'sbx-bookmeta-mara-b2', metaId: 'sbx-meta-mara', bookId: B2, age: 25 })
})()

const count = t => db.prepare(`SELECT COUNT(*) c FROM "${t}"`).get().c
console.log('• seeded:',
  ['Series', 'Book', 'Chapter', 'ContentBlock', 'Choice', 'ConditionalOverride', 'StoryVariable', 'WriterCharacterMeta', 'ChapterNarration']
    .map(t => `${t}=${count(t)}`).join(' '))
db.close()
console.log(`✓ ${SANDBOX}`)
