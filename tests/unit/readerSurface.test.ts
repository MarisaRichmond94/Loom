import { readdirSync, readFileSync, statSync } from 'fs'
import path from 'path'

// The reader tier's ENTIRE reachable surface (LOOM-136).
//
// The author's rule for this epic: readers get the absolute minimum needed to
// read the books and take part in the comments, and nothing else on the
// machine. Once the app is on a tailnet, every route it exposes is a route two
// other households can reach — so the surface is enumerated here rather than
// inferred, and adding to it has to be a deliberate act that edits this file.
//
// This is the enforcement point for "least access". A new route added without
// thought fails this test, and the failure asks the only question that matters:
// does a reader need this to read a book or leave a comment?

const APP = path.join(__dirname, '../../reader/src/app')

/** Every route the App Router will actually serve, as a URL-ish path. */
function routes(dir: string, prefix = '', found: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const full = path.join(dir, name)
    if (statSync(full).isDirectory()) {
      routes(full, `${prefix}/${name}`, found)
    } else if (name === 'page.tsx') {
      found.push(prefix || '/')
    } else if (name === 'route.ts') {
      found.push(prefix || '/')
    }
  }
  return found
}

/** The complete list. Anything not here must not exist. */
const ALLOWED = [
  '/',                                        // the catalog
  '/book/[bookId]',                           // a book's landing page
  '/book/[bookId]/chapter/[chapterId]',       // the reading surface
  '/invite',                                  // where the unrecognised land
  '/r/[token]',                               // exchange an invite for a cookie
  '/api/media/[...path]',                     // covers, portraits, audio
  '/api/progress',                            // where I am in a book
  '/api/comments',                            // read and write comments
].sort()

describe('the reader app exposes only what reading requires', () => {
  const actual = routes(APP).sort()

  it('has exactly the approved surface', () => {
    // If this fails because you ADDED a route: justify it in reader terms
    // before adding it below. If it fails because one is missing, something
    // readers depend on has been deleted.
    expect(actual).toEqual(ALLOWED)
  })

  it('serves no author surface at all', () => {
    // The paths the ticket names explicitly. None of these should exist here,
    // and the check is by prefix so a nested variant cannot slip through.
    const forbidden = ['/api/series', '/api/chapters', '/api/import', '/api/backup', '/api/writeai', '/api/settings']
    for (const route of actual) {
      for (const bad of forbidden) {
        expect(route.startsWith(bad)).toBe(false)
      }
    }
  })
})

describe('every mutating endpoint requires a resolved reader', () => {
  // Three routes accept a write. Each must resolve the cookie to a live reader
  // BEFORE doing anything — an unauthenticated write is the failure that turns
  // "they can comment" into "they can do things on my machine".
  const writers = [
    'api/progress/route.ts',
    'api/comments/route.ts',
  ]

  it.each(writers)('%s resolves the reader first', file => {
    const src = readFileSync(path.join(APP, file), 'utf8')
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .replace(/^\s*\/\/.*$/gm, '')

    // Every exported handler in the file.
    const handlers = [...src.matchAll(/export async function (GET|POST|PATCH|DELETE|PUT)\b/g)]
    expect(handlers.length).toBeGreaterThan(0)

    for (const h of handlers) {
      const body = src.slice(h.index ?? 0)
      const guard = body.indexOf('resolveReader()')
      const nextHandler = body.slice(1).search(/export async function /)
      expect(guard).toBeGreaterThan(-1)
      // The guard belongs to THIS handler, not a later one.
      if (nextHandler > -1) expect(guard).toBeLessThan(nextHandler)
    }
  })

  it('the media route is gated too', () => {
    // Prose behind an invite while the audiobook is open is not a boundary.
    const src = readFileSync(path.join(APP, 'api/media/[...path]/route.ts'), 'utf8')
    expect(src).toContain('resolveReader()')
  })
})

describe('the reader app cannot write anywhere it should not', () => {
  function sources(dir: string, found: string[] = []): string[] {
    for (const name of readdirSync(dir)) {
      if (name === 'shared') continue
      const full = path.join(dir, name)
      if (statSync(full).isDirectory()) sources(full, found)
      else if (/\.tsx?$/.test(name)) found.push(full)
    }
    return found
  }

  const files = sources(path.join(__dirname, '../../reader/src'))

  it('never opens content.db for writing', () => {
    // The snapshot is publish's output. A reader process with a write handle on
    // it could corrupt what every other reader sees.
    const db = readFileSync(path.join(__dirname, '../../reader/src/lib/db.ts'), 'utf8')
    expect(db).toContain('readonly: true')
  })

  it('spawns no processes and reads no arbitrary paths', () => {
    // "Nothing else on my machine" in the most literal sense: no shelling out,
    // and no filesystem access outside the media route's own resolved root.
    for (const f of files) {
      const code = readFileSync(f, 'utf8')
        .replace(/\/\*[\s\S]*?\*\//g, '')
        .replace(/^\s*\/\/.*$/gm, '')
      expect(code).not.toMatch(/child_process|execSync|spawn\(/)
      // The media route legitimately reads files; it is the only one, and it
      // resolves every path against a fixed root first.
      if (!f.endsWith(path.join('media', '[...path]', 'route.ts'))) {
        expect(code).not.toMatch(/readFileSync|createReadStream/)
      }
    }
  })

  it('the media route confines itself to four published roots', () => {
    const src = readFileSync(path.join(APP, 'api/media/[...path]/route.ts'), 'utf8')
    expect(src).toContain("MEDIA_ROOTS = new Set(['covers', 'characters', 'music', 'narration'])")
    // Resolve-then-compare, so an encoded traversal cannot escape.
    expect(src).toContain('path.resolve(PUBLIC_ROOT')
    expect(src).toContain('startsWith(PUBLIC_ROOT + path.sep)')
  })
})

describe('client calls stay inside the app’s mount point', () => {
  // The reader is served under a path prefix on the tailnet (LOOM-136), beside
  // another application at a different prefix. Next applies basePath to
  // next/link and to its own assets, but NOT to fetch or sendBeacon — a bare
  // '/api/progress' would leave this app entirely and land on whichever app
  // answers '/'. Nothing about that fails loudly: the request just goes
  // somewhere else and returns somebody else's 404.
  function clientFiles(dir: string, found: string[] = []): string[] {
    for (const name of readdirSync(dir)) {
      if (name === 'shared') continue
      const full = path.join(dir, name)
      if (statSync(full).isDirectory()) clientFiles(full, found)
      else if (/\.tsx?$/.test(name)) found.push(full)
    }
    return found
  }

  const files = clientFiles(path.join(__dirname, '../../reader/src'))

  it.each(files.map(f => [path.relative(path.join(__dirname, '../../reader/src'), f), f]))(
    '%s uses api() rather than a bare /api path',
    (_rel, file) => {
      const code = readFileSync(file, 'utf8')
        .replace(/\/\*[\s\S]*?\*\//g, '')
        .replace(/^\s*\/\/.*$/gm, '')
      // Matches fetch('/api/…'), fetch(`/api/…`) and sendBeacon('/api/…').
      expect(code).not.toMatch(/(?:fetch|sendBeacon)\(\s*['"`]\/api\//)
    },
  )
})

describe('the reader cookie reaches the app it was issued for', () => {
  // A trailing slash on the cookie path cost a real reader their session.
  //
  // The cookie was scoped `/loom/`, enrolment redirected to `/loom/`, and Next
  // normalised that to `/loom` with a 308 — a path the cookie does not cover.
  // The reader enrolled successfully and was handed straight back to the invite
  // page, with nothing to indicate why.
  //
  // curl did not catch it: its path matching is looser than a browser's. So the
  // rule itself is encoded here, from RFC 6265 §5.1.4.
  const pathMatch = (requestPath: string, cookiePath: string): boolean => {
    if (requestPath === cookiePath) return true
    if (!requestPath.startsWith(cookiePath)) return false
    if (cookiePath.endsWith('/')) return true
    return requestPath[cookiePath.length] === '/'
  }

  it('a trailing slash breaks the app root — the bug', () => {
    expect(pathMatch('/loom', '/loom/')).toBe(false)
  })

  it('without one, it covers the root and everything under it', () => {
    for (const p of ['/loom', '/loom/', '/loom/book/abc', '/loom/api/comments']) {
      expect(pathMatch(p, '/loom')).toBe(true)
    }
  })

  it('and still does not leak to the app next door', () => {
    // The reason it is scoped at all: the tailnet host serves another
    // application, which has no business holding a token for the books.
    for (const p of ['/', '/honey-dew', '/honey-dew/thing']) {
      expect(pathMatch(p, '/loom')).toBe(false)
    }
  })

  it('the route scopes the cookie with ROOT, not api("/")', () => {
    const src = readFileSync(path.join(APP, 'r/[token]/route.ts'), 'utf8')
    expect(src).toMatch(/path:\s*ROOT/)
    expect(src).not.toMatch(/path:\s*api\('\/'\)/)
  })
})

describe('media URLs carry the mount prefix', () => {
  // Cover, portrait, soundtrack and narration paths come out of content.db as
  // app-absolute strings — '/covers/<id>.jpg' — and go straight into `src`.
  // Those are plain browser requests, so basePath never touches them: under a
  // mount they leave the app and land on whatever answers '/'. Every image and
  // audio element on the site broke this way at once, and nothing errored —
  // the requests simply went to the wrong application.
  const components = path.join(__dirname, '../../reader/src/components')

  function tsx(dir: string, found: string[] = []): string[] {
    for (const name of readdirSync(dir)) {
      const full = path.join(dir, name)
      if (statSync(full).isDirectory()) tsx(full, found)
      else if (name.endsWith('.tsx')) found.push(full)
    }
    return found
  }

  it.each(tsx(components).map(f => [path.basename(f), f]))(
    '%s wraps every src in media()',
    (_name, file) => {
      const code = readFileSync(file, 'utf8')
        .replace(/\/\*[\s\S]*?\*\//g, '')
        .replace(/^\s*\/\/.*$/gm, '')
      // Every `src={…}` whose expression is not a media()/api() call, and not
      // a plain local string (the logo, which Next serves from public/).
      const bare = [...code.matchAll(/src=\{([^}]+)\}/g)]
        .map(m => m[1].trim())
        .filter(e => !e.startsWith('media(') && !e.startsWith('api('))
      expect(bare).toEqual([])
    },
  )
})
