import { readFileSync } from 'fs'
import path from 'path'

// A source-level guard, not a behaviour test.
//
// A chapter added, inserted or dragged is a change to the manuscript that no
// keystroke follows: creation navigates you into an EMPTY chapter, and a drag
// changes no prose at all. The blur autosave therefore has nothing to fire on,
// so the manifest on disk kept describing the old chapter numbering — and
// WriteAI kept answering about chapter 12 with chapter 11's scene — until the
// next time the writer happened to type something in that book.
//
// The failure is invisible from Loom: the sidebar renumbers instantly and
// looks completely correct. It is only wrong on the other side of the seam,
// which is exactly why it is worth pinning here rather than trusting a manual
// check. See INTEGRATION.md §4.
function read(rel: string): string {
  return readFileSync(path.join(__dirname, '../../src', rel), 'utf8')
}

const SITES: Array<{ file: string; fn: string; what: string }> = [
  { file: 'app/author/[seriesId]/layout.tsx', fn: 'addChapter', what: 'appending a chapter' },
  { file: 'app/author/[seriesId]/layout.tsx', fn: 'insertChapter', what: 'inserting a chapter mid-book' },
  { file: 'components/sidebar/OutlineTree.tsx', fn: 'handleDragEnd', what: 'reordering chapters by drag' },
]

// The body of `async function <name>(…) { … }`, matched by brace balance so a
// nested block can't end it early.
function functionBody(src: string, name: string): string {
  const start = src.indexOf(`async function ${name}(`)
  expect(start).toBeGreaterThan(-1)
  const open = src.indexOf('{', src.indexOf(')', start))
  let depth = 0
  for (let i = open; i < src.length; i++) {
    if (src[i] === '{') depth++
    else if (src[i] === '}' && --depth === 0) return src.slice(open, i + 1)
  }
  throw new Error(`unbalanced braces in ${name}`)
}

describe('structural chapter changes export canon', () => {
  it.each(SITES)('$what saves canon', ({ file, fn }) => {
    expect(functionBody(read(file), fn)).toContain('saveCanonAfterStructuralChange')
  })

  it.each(SITES)('$what saves AFTER the server has been told', ({ file, fn }) => {
    // Exporting before the mutation lands writes the OLD numbering to disk and
    // announces it as a fresh snapshot — worse than not exporting at all,
    // because the drift check then believes the index is current.
    const body = functionBody(read(file), fn)
    expect(body.indexOf('saveCanonAfterStructuralChange'))
      .toBeGreaterThan(body.indexOf('await fetch('))
  })

  it('respects the autosave preference', () => {
    // With autosave off, nothing may write to the writer's export folder
    // unprompted — a structural save is no more entitled to than a blur save.
    // An unreadable preference must not be read as "yes".
    const hook = read('components/editor/useCanonSave.tsx')
    const body = functionBody(hook, 'saveCanonAfterStructuralChange')
    expect(body).toContain('/api/settings/canon-export')
    expect(body).toMatch(/if\s*\(!autosaveRef\.current\)\s*return/)
    expect(body).toMatch(/catch\(\(\)\s*=>\s*false\)/)
  })
})
