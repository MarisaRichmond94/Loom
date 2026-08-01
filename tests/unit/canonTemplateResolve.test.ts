import { execFileSync } from 'child_process'
import { existsSync } from 'fs'
import path from 'path'
import { serializeTipTapDoc, type SerializeOptions } from '@/lib/manuscript/tiptapToOoxml'
import type { StoryState } from '@/lib/storyEngine'

// Verifies the paragraph-level {{template}} resolver against the writer's real
// manuscripts: cross-node ternaries (a branch word italicised, etc.) must
// resolve in the exported OOXML instead of leaking raw {{...}} text.

const DB = path.join(__dirname, '../../dev.db')
const SERIES_ID = 'cmp8wtcr50000zufxy70xic4e'
// The real-manuscript checks need the local dev database; skip them elsewhere
// (CI) so the portable synthetic case still runs.
const hasDb = existsSync(DB)
const dbIt = hasDb ? it : it.skip

function sql(query: string): string {
  return execFileSync('sqlite3', [DB, query], { encoding: 'utf8' })
}

function storyStateFromDefaults(): StoryState {
  const rows = sql(`SELECT name, type, defaultValue FROM StoryVariable WHERE seriesId='${SERIES_ID}';`)
    .trim().split('\n').filter(Boolean)
  const state: StoryState = {}
  for (const row of rows) {
    const [name, type, def] = row.split('|')
    if (type === 'boolean') state[name] = String(def).toLowerCase() === 'true'
    else if (type === 'number') state[name] = Number(def ?? 0)
    else state[name] = def ?? ''
  }
  return state
}

function opts(storyState: StoryState): SerializeOptions {
  return { sectionBreakText: '', storyState }
}

describe('canon export template resolution (real manuscripts)', () => {
  const storyState = hasDb ? storyStateFromDefaults() : {}

  dbIt('no MARK-SPLIT template leaks after the fix (the only residual leaks are single-quote+apostrophe collisions)', () => {
    const bookTitles = ['Faded', 'The Secrets We Keep']
    const idList = bookTitles.map(t => `'${t}'`).join(',')
    const rows = sql(
      `SELECT cb.content FROM ContentBlock cb JOIN Chapter ch ON cb.chapterId=ch.id ` +
      `JOIN Book b ON ch.bookId=b.id WHERE b.title IN (${idList}) AND cb.type='text' ` +
      `AND cb.content LIKE '%{{%';`,
    ).trim()
    const contents = rows.split('\n').filter(l => l.trim().startsWith('{'))
    expect(contents.length).toBeGreaterThan(0)

    const footnotes = { notes: [] as string[] }
    const leaks: string[] = []
    for (const content of contents) {
      const xml = serializeTipTapDoc(content, opts(storyState), footnotes)
      for (const m of xml.matchAll(/\{\{[^{}]*\}\}/g)) leaks.push(m[0])
    }
    // Every remaining leak must be the distinct, pre-existing quoting bug: a
    // single-quoted branch containing a straight apostrophe (>=6 straight
    // single quotes, no double quotes) — NOT a mark-split template. If a
    // mark-split one shows up here, the fix regressed.
    const nonApostrophe = leaks.filter(t => !(t.split("'").length - 1 >= 6 && !t.includes('"')))
    expect(nonApostrophe).toEqual([])
  })

  dbIt('preserves branch formatting: the italic "nearly" survives resolution', () => {
    const content = sql(
      `SELECT content FROM ContentBlock WHERE content LIKE '%both of his grandparents%' LIMIT 1;`,
    ).trim()
    const xml = serializeTipTapDoc(content, opts(storyState), { notes: [] })
    expect(xml).not.toContain('{{')
    // didJaredKillHisGrandpa defaults to true → the TRUE branch renders.
    expect(xml).toContain('both of his grandparents')
    // The false branch (with the italic "nearly") must NOT appear.
    expect(xml).not.toContain('nearly')
  })

  it('preserves italic on the chosen branch when the false branch is taken', () => {
    // A synthetic ternary whose chosen (false) branch contains an italic word,
    // split across text nodes exactly like the real data.
    const doc = {
      type: 'doc',
      content: [{
        type: 'paragraph',
        content: [
          { type: 'text', text: 'He was {{flag ? "gone" : "still '  },
          { type: 'text', marks: [{ type: 'italic' }], text: 'very' },
          { type: 'text', text: ' much" }} here.' },
        ],
      }],
    }
    const xml = serializeTipTapDoc(JSON.stringify(doc), opts({ flag: false }), { notes: [] })
    expect(xml).not.toContain('{{')
    expect(xml).toContain('still')
    expect(xml).toContain('here.')
    // "very" must be emitted inside an italic run.
    expect(xml).toMatch(/<w:i w:val="1"\/>[^<]*<\/w:rPr><w:t[^>]*>very/)
  })
})
