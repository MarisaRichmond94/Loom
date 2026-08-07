import { readFileSync } from 'fs'
import path from 'path'

// The author's comments dock (LOOM-135).
//
// The behaviour worth pinning here is what must NEVER happen: a delete path, a
// write to the manuscript, or a dock that explodes on a checkout where the
// reader tier has never run.

const read = (p: string) => readFileSync(path.join(__dirname, '../../src', p), 'utf8')
const strip = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')

const lib = read('lib/readerComments.ts')
const listRoute = read('app/api/reader/comments/route.ts')
const itemRoute = read('app/api/reader/comments/[id]/route.ts')
const panel = read('components/editor/CommentsPanel.tsx')

describe('nothing here can destroy what a reader wrote', () => {
  // Hiding is moderation and must stay reversible. This dock sits one click
  // from the manuscript, and a family member's words are not the author's to
  // delete by accident.
  it.each([
    ['the library', lib],
    ['the list route', listRoute],
    ['the mutate route', itemRoute],
    ['the panel', panel],
  ])('%s has no delete path', (_name, src) => {
    const code = strip(src)
    expect(code).not.toMatch(/DELETE FROM Comment/i)
    expect(code).not.toContain('deleteOwnComment')
    expect(code).not.toMatch(/export async function DELETE/)
  })

  it('hide is a soft column, not a removal', () => {
    expect(strip(lib)).toContain('setCommentHidden')
  })

  it('the author still sees hidden comments', () => {
    // listComments(db, id, true) — the `true` is includeHidden. Without it an
    // accidental hide would be invisible AND irreversible from the dock.
    expect(strip(lib)).toMatch(/listComments\(db, chapterId, true\)/)
  })
})

describe('the manuscript is not involved', () => {
  it.each([
    ['the library', lib],
    ['the list route', listRoute],
    ['the mutate route', itemRoute],
  ])('%s never touches dev.db or prisma', (_name, src) => {
    const code = strip(src)
    expect(code).not.toContain('dev.db')
    expect(code).not.toContain('prisma')
  })

  it('reads content.db read-only when checking what is still published', () => {
    // Orphan detection asks the SNAPSHOT what a reader can reach. It must not
    // be able to write to it — that file is publish's output.
    expect(lib).toContain('readonly: true')
  })
})

describe('a checkout without a reader tier still opens the dock', () => {
  it('every entry point checks for the database first', () => {
    // better-sqlite3 CREATES a missing file by default, so without these the
    // dock would quietly conjure an empty reader.db on a fresh clone and then
    // report "no comments", which is a different sentence from "no reader
    // tier yet".
    const code = strip(lib)
    const guards = code.match(/existsSync\(READER_DB_PATH\)/g) ?? []
    expect(guards.length).toBeGreaterThanOrEqual(4)
  })

  it('the panel distinguishes "not set up" from "nothing said yet"', () => {
    expect(panel).toContain('No reader database yet')
    expect(panel).toContain('Nothing on this chapter yet')
  })
})

describe('resolve and hide are different things', () => {
  it('the panel labels them by their consequence, not their column', () => {
    // "Resolve" that readers can see, or "Hide" that they cannot, would both
    // be the wrong mental model. The titles say who is affected.
    expect(panel).toContain('only you see this')
    expect(panel).toContain('Hide from readers')
  })

  it('the route writes them independently', () => {
    const code = strip(itemRoute)
    expect(code).toContain("typeof body.resolved === 'boolean'")
    expect(code).toContain("typeof body.hidden === 'boolean'")
  })
})

describe('orphans are surfaced, not dropped', () => {
  it('the library returns them separately', () => {
    expect(strip(lib)).toContain('orphaned')
  })

  it('the panel gives them their own section', () => {
    expect(panel).toContain('On chapters no longer published')
  })
})

describe('the two-writer decision is written down where it will be found', () => {
  it('readerComments.ts explains why Loom writes reader.db directly', () => {
    // The ticket recommended routing this through the reader app's API to keep
    // one writer per file. That premise stopped being true at LOOM-132, and the
    // reasoning has to live next to the code rather than in a ticket.
    expect(lib).toContain('TWO WRITERS')
    expect(lib).toContain('LOOM-132')
  })
})
