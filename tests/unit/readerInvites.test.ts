import { readFileSync } from 'fs'
import path from 'path'

import { inviteUrl, readerInviteDefaults } from '@/lib/readerInvites'

// The author side of reader identity (LOOM-132).
//
// Two failure modes are worth pinning, because neither shows up as an error:
// a link built against the wrong host (works for the author, useless to the
// reader), and a token reaching the settings page (renders identically, but
// every invite in the household is then sitting in a browser tab).

const read = (p: string) => readFileSync(path.join(__dirname, '../../src', p), 'utf8')
const strip = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')

const listRoute = read('app/api/settings/readers/route.ts')
const itemRoute = read('app/api/settings/readers/[id]/route.ts')
const linkRoute = read('app/api/settings/readers/[id]/link/route.ts')
const section = read('components/ReadersSection.tsx')

describe('invite links', () => {
  it('joins base and token', () => {
    expect(inviteUrl('http://loom.local:3200', 'abc')).toBe('http://loom.local:3200/r/abc')
  })

  it('tolerates a trailing slash, which is how everyone pastes a host', () => {
    expect(inviteUrl('http://loom.local:3200/', 'abc')).toBe('http://loom.local:3200/r/abc')
    expect(inviteUrl('http://loom.local:3200///', 'abc')).toBe('http://loom.local:3200/r/abc')
  })

  it('defaults to the only place the reader currently runs', () => {
    expect(readerInviteDefaults().baseUrl).toBe('http://localhost:3200')
  })
})

describe('the settings page never receives a token', () => {
  // The list renders on screen and lives as long as the tab is open. A token is
  // a reusable bearer credential, so it takes the on-demand door instead.
  it('the list route strips the token from every reader it returns', () => {
    const code = strip(listRoute)
    // Stated positively: the rows must go through `view`. Asserting the absence
    // of some particular unsafe spelling only pins the spellings imagined here,
    // and the first version of this test failed the SAFE code for that reason.
    // `[\s\S]*?` rather than `[^)]*` — the argument is `readerDb()`, so a
    // character class that excludes `)` stops inside the nested call.
    expect(code).toMatch(/readers:\s*listReaders\([\s\S]*?\)\s*\.map\(view\)/)
    expect(code).not.toMatch(/token:\s*r\.token/)
  })

  it('the create route returns the view, not the new reader', () => {
    expect(strip(listRoute)).toContain('reader: view(reader)')
  })

  it('the rename/revoke route returns no token either', () => {
    expect(strip(itemRoute)).not.toContain('token')
  })

  it('only the link route emits one, and only one', () => {
    expect(strip(linkRoute)).toContain('inviteUrl(baseUrl, reader.token)')
  })

  it('the link route is a POST, so it is never prefetched or left in history', () => {
    expect(linkRoute).toContain('export async function POST')
    expect(linkRoute).not.toContain('export async function GET')
  })

  it('the section holds no token in state', () => {
    const code = strip(section)
    // It may name `url` transiently inside copyLink; what it must never do is
    // keep tokens in component state alongside the list.
    expect(code).not.toMatch(/useState<[^>]*token/i)
    expect(code).not.toMatch(/setReaders\([^)]*token/)
  })
})

describe('reader identity stays out of the manuscript', () => {
  it.each([
    ['list', listRoute],
    ['rename/revoke', itemRoute],
    ['link', linkRoute],
  ])('the %s route never reaches for prisma or dev.db', (_name, src) => {
    const code = strip(src)
    expect(code).not.toContain('prisma')
    expect(code).not.toContain('dev.db')
  })

  it('routes go through the shared module, which refuses a manuscript path', () => {
    for (const src of [listRoute, itemRoute, linkRoute]) {
      expect(src).toContain('@/lib/readerInvites')
    }
  })
})

describe('renaming does not invalidate a link already sent', () => {
  it('the rename path never regenerates a token', () => {
    const code = strip(itemRoute)
    expect(code).toContain('renameReader')
    expect(code).not.toContain('newToken')
  })
})
