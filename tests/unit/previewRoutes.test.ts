import { readdirSync, readFileSync, statSync } from 'fs'
import path from 'path'

// The author's preview routes moved to /author/preview/* (LOOM-137).
//
// This exists because I missed five call sites doing it. They were all
// `router.push(\`/read/${id}\`)` — string literals, so nothing failed to
// compile and nothing failed a test; the Preview button in the chapter editor
// simply 404'd when pressed. The sweep that was supposed to catch them used a
// shell pattern with an unescaped backtick, which silently matched nothing.
//
// So the rule is enforced here instead of by grepping carefully next time.

const SRC = path.join(__dirname, '../../src')

function files(dir: string, found: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const full = path.join(dir, name)
    if (statSync(full).isDirectory()) files(full, found)
    else if (/\.tsx?$/.test(name)) found.push(full)
  }
  return found
}

const strip = (s: string) =>
  s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')

describe('nothing links to the old session route', () => {
  // `/read/by-id/*` and `/read/by-title/*` are a PUBLIC CONTRACT with WriteAI
  // and must keep working — they are the two routes allowed to own `/read`.
  const CONTRACT = path.join(SRC, 'app', 'read')

  it.each(
    files(SRC)
      .filter(f => !f.startsWith(CONTRACT))
      .map(f => [path.relative(SRC, f), f]),
  )('%s builds no /read/<id> link', (_rel, file) => {
    const code = strip(readFileSync(file, 'utf8'))
    // Matches '/read/…', "/read/…" and `/read/…`, but not /read/by-id or
    // /read/by-title, which are the contract.
    const offenders = [...code.matchAll(/['"`]\/read\/(?!by-id|by-title)[^'"`]*/g)]
      .map(m => m[0])
    expect(offenders).toEqual([])
  })

  it('the contract routes still exist', () => {
    // The other half of the rule: this test would also pass if someone deleted
    // them, which would break every WriteAI citation ever emitted.
    const dirs = readdirSync(CONTRACT)
    expect(dirs).toEqual(expect.arrayContaining(['by-id', 'by-title']))
  })

  it('the session route lives under /author/preview', () => {
    const p = path.join(SRC, 'app', 'author', 'preview', 'session', '[sessionId]')
    expect(statSync(p).isDirectory()).toBe(true)
  })
})
