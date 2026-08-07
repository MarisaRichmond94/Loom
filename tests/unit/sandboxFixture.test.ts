import { execFileSync } from 'child_process'
import { existsSync } from 'fs'
import path from 'path'
import { walkBook, defaultStoryState } from '@/lib/manuscript/walk'

// LOOM-125. Proves the fixture actually carries the structural features the
// later reader-tier tickets test against. A fixture that quietly stopped
// containing an ambiguous choice point would make LOOM-126's central assertion
// vacuously pass, which is worse than having no fixture at all.
//
// Reads via the sqlite3 binary with -readonly, matching the existing pattern in
// canonTemplateResolve.test.ts and keeping this suite free of a native binding.

const SANDBOX = path.join(__dirname, '../../sandbox.db')
const hasFixture = existsSync(SANDBOX)
// Not committed (it is a *.db, and gitignored). Skip rather than fail so a
// fresh checkout's suite is green; the build step is one command away.
const fixtureIt = hasFixture ? it : it.skip

function sql(query: string): string[] {
  return execFileSync('sqlite3', ['-readonly', SANDBOX, query], { encoding: 'utf8' })
    .trim().split('\n').filter(Boolean)
}

describe('sandbox fixture shape', () => {
  fixtureIt('has a published pair and a draft book that still holds real prose', () => {
    expect(sql(`SELECT title FROM Book WHERE published=1 ORDER BY "order";`)).toEqual(['Ashfall', 'Tidewater'])
    expect(sql(`SELECT title FROM Book WHERE published=0;`)).toEqual(['The Unfinished Book'])
    // The draft must have chapters and prose — otherwise "publish excludes
    // drafts" would pass against a book that had nothing to exclude.
    const draftBlocks = sql(`SELECT COUNT(*) FROM ContentBlock cb JOIN Chapter c ON c.id=cb.chapterId JOIN Book b ON b.id=c.bookId WHERE b.published=0;`)
    expect(Number(draftBlocks[0])).toBeGreaterThan(0)
  })

  fixtureIt('carries a soundtrack block on a canon chapter (the block type walkBook drops)', () => {
    expect(sql(`SELECT content FROM ContentBlock WHERE type='soundtrack';`)).toEqual(['/music/sbx-lantern-theme.mp3'])
  })

  fixtureIt('carries a prologue, a bad ending, and an endsChapter branch', () => {
    expect(sql(`SELECT title FROM Chapter WHERE numbered=0;`)).toEqual(['Prologue'])
    expect(sql(`SELECT COUNT(*) FROM Choice WHERE isBadEnding=1;`)).toEqual(['1'])
    expect(sql(`SELECT COUNT(*) FROM Choice WHERE endsChapter=1;`)).toEqual(['1'])
  })

  fixtureIt('covers all three narration cases publish has to tell apart', () => {
    // 1. Two recordings, NEITHER of the canon text — publish must go silent
    //    rather than pick one. This is the 47-chapters-with-variants case.
    const twoPaths = sql(`SELECT COUNT(DISTINCT contentHash) FROM ChapterNarration WHERE chapterId='sbx-b1-c1';`)
    expect(Number(twoPaths[0])).toBe(2)

    // 2. One recording OF the canon text, hashed the way src/lib/narration
    //    does — the only case that should publish audio.
    expect(sql(`SELECT COUNT(*) FROM ChapterNarration WHERE chapterId='sbx-b1-c3';`)).toEqual(['1'])

    // 3. No recording at all — silent, and not reported as a mismatch.
    expect(sql(`SELECT COUNT(*) FROM ChapterNarration WHERE chapterId='sbx-b1-c0';`)).toEqual(['0'])
  })

  fixtureIt('carries the three character shapes the per-book projection must separate', () => {
    // Late first appearance, and a mid-series death. Both are spoilers that
    // LOOM-127's projection must resolve away rather than ship raw.
    expect(sql(`SELECT writerCharacterId FROM WriterCharacterMeta WHERE firstBookId='sbx-book-2';`)).toEqual(['sbx-char-idris'])
    expect(sql(`SELECT writerCharacterId FROM WriterCharacterMeta WHERE deathBookId IS NOT NULL;`)).toEqual(['sbx-char-selis'])
    expect(sql(`SELECT age FROM WriterCharacterBookMeta WHERE metaId='sbx-meta-mara';`)).toEqual(['25'])
  })
})

describe('sandbox fixture drives a genuinely ambiguous canon walk', () => {
  // The reason the fixture exists in this shape. LOOM-126 stores a resolution
  // for exactly this situation and LOOM-127 refuses to publish without one.
  fixtureIt('leaves the lantern choice point ambiguous under a pure canon walk', () => {
    const variables = sql(`SELECT name || '|' || type || '|' || defaultValue FROM StoryVariable;`)
      .map(r => { const [name, type, defaultValue] = r.split('|'); return { name, type, defaultValue } })

    const chapters = sql(`SELECT id || '|' || title || '|' || "order" || '|' || numbered FROM Chapter WHERE bookId='sbx-book-1' ORDER BY "order";`)
      .map(r => {
        const [id, title, order, numbered] = r.split('|')
        const blocks = sql(`SELECT id || '~' || "order" || '~' || type FROM ContentBlock WHERE chapterId='${id}' ORDER BY "order";`)
          .map(b => {
            const [blockId, blockOrder, type] = b.split('~')
            const choices = sql(`SELECT id || '~' || "order" || '~' || label || '~' || setsVariables || '~' || isBadEnding || '~' || endsChapter FROM Choice WHERE choicePointId='${blockId}' ORDER BY "order";`)
              .map(c => {
                const [cid, corder, label, setsVariables, isBadEnding, endsChapter] = c.split('~')
                return { id: cid, order: Number(corder), label, setsVariables, targetChapterId: null, isBadEnding: isBadEnding === '1', endsChapter: endsChapter === '1', endingMessage: null, condition: null }
              })
            return { id: blockId, order: Number(blockOrder), type, content: null, prompt: null, condition: null, choices, overrides: [] }
          })
        return { id, title, order: Number(order), pov: null, date: null, condition: null, numbered: numbered === '1', blocks }
      })

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const walk = walkBook(chapters as any, variables, defaultStoryState(variables), {})
    const lantern = walk.choicePoints.find(p => p.choicePointId === 'sbx-b1-c1-cp')

    expect(lantern).toBeDefined()
    // Both sides move the same accumulator (+= / -=). contradictsTarget()
    // cannot compare an accumulation to a target value, so it filters neither
    // and two candidates survive. This is the real shape in the manuscript,
    // where emmaTrustScore is driven by exactly this ±1 pattern.
    expect(lantern?.ambiguous).toBe(true)
    // ...and it falls back to array order — precisely the silent guess publish
    // must never be allowed to make on its own.
    expect(lantern?.resolvedChoiceId).toBe('sbx-cp1-a')

    // The contrast, and the reason ambiguity is NARROWER than "any choice point
    // with two good options": a pure canon walk targets defaultStoryState, so a
    // choice assigning a non-default value contradicts and is filtered out.
    // At the ferryman point that leaves exactly one candidate (the bad ending
    // is excluded separately), and canon resolves with no author input.
    const ferryman = walk.choicePoints.find(p => p.choicePointId === 'sbx-b1-c2-cp')
    expect(ferryman).toBeDefined()
    expect(ferryman?.ambiguous).toBe(false)
    expect(ferryman?.resolvedChoiceId).toBe('sbx-cp2-a')
  })
})
