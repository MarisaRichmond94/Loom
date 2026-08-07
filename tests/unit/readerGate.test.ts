import { readFileSync, readdirSync, statSync } from 'fs'
import path from 'path'

// The gate (LOOM-132), pinned at the source level.
//
// Enforcement lives in each entry point, because that is where the database is
// reachable — the proxy can only see whether a cookie EXISTS, never whether it
// resolves to a live reader. That design is right, and its failure mode is that
// someone adds a page and forgets the one line. Nothing about that mistake is
// visible: the page renders, the prose is correct, and it is simply readable by
// anyone who can reach the host.
//
// So this walks the route tree rather than listing files. A page added next
// month is covered without anyone remembering to come back here.

const APP = path.join(__dirname, '../../reader/src/app')
const read = (p: string) => readFileSync(p, 'utf8')
const strip = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')

/** Every page.tsx / route.ts under the reader's app directory. */
function entryPoints(dir: string, found: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const full = path.join(dir, name)
    if (statSync(full).isDirectory()) entryPoints(full, found)
    else if (name === 'page.tsx' || name === 'route.ts') found.push(full)
  }
  return found
}

const rel = (p: string) => path.relative(APP, p)

// The two routes that must NOT be gated, and why:
//   r/[token]  — the enrolment step itself. Gating it makes enrolment
//                impossible, because the visitor has no cookie yet.
//   invite     — where the gate SENDS people. Gating it is a redirect loop.
const UNGATED = new Set(['r/[token]/route.ts', 'invite/page.tsx'])

describe('every reader entry point is gated', () => {
  const all = entryPoints(APP)

  it('finds the route tree', () => {
    expect(all.length).toBeGreaterThanOrEqual(4)
  })

  it.each(all.map(p => [rel(p), p]))('%s', (name, file) => {
    const src = strip(read(file))
    if (UNGATED.has(name)) {
      expect(src).not.toContain('requireReader(')
      return
    }
    // requireReader redirects; resolveReader lets a route answer in its own
    // format (the media route returns 404 rather than HTML to an <img>).
    expect(src).toMatch(/requireReader\(\)|resolveReader\(\)/)
  })
})

describe('the invite exchange', () => {
  const src = read(path.join(APP, 'r/[token]/route.ts'))

  it('sets an HttpOnly, SameSite=Lax cookie', () => {
    expect(src).toContain('httpOnly: true')
    expect(src).toContain("sameSite: 'lax'")
  })

  it('never logs the token', () => {
    // The URL still reaches the framework's request log — a known, accepted
    // property (tokens live in the path). What is in our control is that no
    // application code writes one anywhere.
    expect(strip(src)).not.toMatch(/console\.(log|info|warn|error)/)
  })

  it('redirects rather than rendering, so the token leaves the address bar', () => {
    expect(src).toContain('NextResponse.redirect')
    expect(src).not.toContain('return new Response')
  })
})

describe('the proxy is a fast path, not the enforcement', () => {
  const src = read(path.join(__dirname, '../../reader/src/proxy.ts'))

  it('excludes the enrolment route and the invite page from the matcher', () => {
    // Gating either one breaks the feature: the first makes enrolment
    // impossible, the second is a redirect loop.
    const matcher = src.match(/matcher:\s*\[([\s\S]*?)\]/)?.[1] ?? ''
    expect(matcher).toContain('r/')
    expect(matcher).toContain('invite')
  })

  it('does not open the reader database', () => {
    // The Next docs are explicit that proxy should not rely on shared modules,
    // and a handle opened here would sit on a different lifecycle from the
    // app's. Cookie presence is all it may decide.
    const code = strip(src)
    expect(code).not.toContain('readerDb')
    expect(code).not.toContain('better-sqlite3')
  })
})

describe('reader identity never reaches the manuscript', () => {
  it('no reader table is added to the Prisma schema', () => {
    // `dev.db` is the manuscript. Reader identity lives in reader.db, and the
    // cheapest way for that to stop being true is someone adding a model here.
    const schema = readFileSync(path.join(__dirname, '../../prisma/schema.prisma'), 'utf8')
    expect(schema).not.toMatch(/^model Reader\b/m)
  })

  it('the reader app resolves reader.db, not content.db', () => {
    // Comments stripped: this file NAMES content.db in the comment explaining
    // that reader.db sits beside it, which is the opposite of the mistake being
    // guarded against.
    const src = strip(read(path.join(__dirname, '../../reader/src/lib/readers.ts')))
    expect(src).toContain('reader.db')
    expect(src).not.toContain('content.db')
  })
})
