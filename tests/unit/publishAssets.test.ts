import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'fs'
import { mkdtempSync } from 'fs'
import { tmpdir } from 'os'
import path from 'path'
import { publishAssets, resolveInside } from '@/lib/publish/assets'

// LOOM-128. The prune deletes files, driven by paths that come out of a
// database. WriteAI has already lost real portraits to a glob-then-unlink over
// an unvalidated path param; this is the same shape of code, so the tests aim
// hostile paths at it rather than trusting intent.

let root: string
let publicRoot: string
let readerRoot: string

const write = (base: string, rel: string, body: string) => {
  const full = path.join(base, rel)
  mkdirSync(path.dirname(full), { recursive: true })
  writeFileSync(full, body)
  return full
}

beforeEach(() => {
  root = mkdtempSync(path.join(tmpdir(), 'loom-assets-'))
  publicRoot = path.join(root, 'public')
  readerRoot = path.join(root, 'reader-public')
  mkdirSync(publicRoot, { recursive: true })
  mkdirSync(readerRoot, { recursive: true })
})
afterEach(() => rmSync(root, { recursive: true, force: true }))

describe('resolveInside', () => {
  it('resolves a normal stored path', () => {
    expect(resolveInside('/srv/public', '/covers/a.jpg')).toBe('/srv/public/covers/a.jpg')
  })

  it('strips the cache-busting query soundtrack paths carry', () => {
    expect(resolveInside('/srv/public', '/music/x.mp3?t=123')).toBe('/srv/public/music/x.mp3')
  })

  it('refuses to escape the root', () => {
    for (const hostile of [
      '/../../etc/passwd',
      '../../../etc/passwd',
      '/covers/../../../../etc/passwd',
      '',
      '/',
    ]) {
      expect(resolveInside('/srv/public', hostile)).toBeNull()
    }
  })

  it('treats an absolute-looking path as relative to the root, not the filesystem', () => {
    // "/etc/passwd" is a stored-path shape, not a filesystem path — the leading
    // slash must not send it to the real /etc.
    expect(resolveInside('/srv/public', '/etc/passwd')).toBe('/srv/public/etc/passwd')
  })
})

describe('publishAssets', () => {
  it('copies only referenced files', () => {
    write(publicRoot, 'covers/wanted.jpg', 'W')
    write(publicRoot, 'covers/draft-spoiler.jpg', 'D')
    const report = publishAssets({ publicRoot, readerRoot, referenced: ['/covers/wanted.jpg'] })
    expect(report.copied).toBe(1)
    expect(existsSync(path.join(readerRoot, 'covers/wanted.jpg'))).toBe(true)
    // A draft's cover is a spoiler; mirroring the directory would ship it.
    expect(existsSync(path.join(readerRoot, 'covers/draft-spoiler.jpg'))).toBe(false)
  })

  it('prunes what is no longer referenced', () => {
    write(publicRoot, 'covers/a.jpg', 'A')
    write(readerRoot, 'covers/stale.jpg', 'OLD')
    const report = publishAssets({ publicRoot, readerRoot, referenced: ['/covers/a.jpg'] })
    expect(report.pruned).toBe(1)
    expect(existsSync(path.join(readerRoot, 'covers/stale.jpg'))).toBe(false)
    expect(existsSync(path.join(readerRoot, 'covers/a.jpg'))).toBe(true)
  })

  it('never touches the source, even for files it prunes on the other side', () => {
    write(publicRoot, 'covers/a.jpg', 'A')
    write(publicRoot, 'covers/unreferenced.jpg', 'KEEP ME')
    write(readerRoot, 'covers/unreferenced.jpg', 'copy')
    publishAssets({ publicRoot, readerRoot, referenced: ['/covers/a.jpg'] })
    // Pruned on the reader side; untouched at the source.
    expect(existsSync(path.join(readerRoot, 'covers/unreferenced.jpg'))).toBe(false)
    expect(readFileSync(path.join(publicRoot, 'covers/unreferenced.jpg'), 'utf8')).toBe('KEEP ME')
  })

  it('reports a referenced file that is missing instead of failing silently', () => {
    const report = publishAssets({ publicRoot, readerRoot, referenced: ['/covers/gone.jpg'] })
    expect(report.missing).toEqual(['/covers/gone.jpg'])
    expect(report.copied).toBe(0)
  })

  it('ignores hostile references rather than reaching outside public/', () => {
    write(publicRoot, 'covers/a.jpg', 'A')
    const outsider = write(root, 'secret.txt', 'SECRET')
    const report = publishAssets({
      publicRoot, readerRoot,
      referenced: ['/covers/a.jpg', '../secret.txt', '/covers/../../secret.txt'],
    })
    expect(report.missing).toContain('../secret.txt')
    expect(existsSync(path.join(readerRoot, 'secret.txt'))).toBe(false)
    expect(readFileSync(outsider, 'utf8')).toBe('SECRET')
  })

  it('leaves files outside the media roots alone', () => {
    // The reader app's own assets (a logo, a favicon) are not ours to prune.
    write(readerRoot, 'logo.svg', 'LOGO')
    write(publicRoot, 'covers/a.jpg', 'A')
    publishAssets({ publicRoot, readerRoot, referenced: ['/covers/a.jpg'] })
    expect(existsSync(path.join(readerRoot, 'logo.svg'))).toBe(true)
  })

  it('skips a re-copy when the destination is already current', () => {
    write(publicRoot, 'narration/big.m4a', 'AUDIO')
    const first = publishAssets({ publicRoot, readerRoot, referenced: ['/narration/big.m4a'] })
    expect(first.copied).toBe(1)
    const second = publishAssets({ publicRoot, readerRoot, referenced: ['/narration/big.m4a'] })
    expect(second.copied).toBe(0)
    expect(second.pruned).toBe(0)
  })
})
