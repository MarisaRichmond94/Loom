import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import path from 'path'
import { publishAssets, resolveInside, type AssetRef } from '@/lib/publish/assets'

// LOOM-128/131. The prune deletes files, driven by paths that came out of a
// database — and since LOOM-131 the sources include another repo's photo
// directory. WriteAI has already lost real portraits to a glob-then-unlink over
// an unvalidated path param, so these tests aim hostile paths at it rather than
// trusting intent.

let root: string
let publicRoot: string
let readerRoot: string
let photoRoot: string

const write = (base: string, rel: string, body: string) => {
  const full = path.join(base, rel)
  mkdirSync(path.dirname(full), { recursive: true })
  writeFileSync(full, body)
  return full
}

/** A reference whose source is under Loom's public/. */
const ref = (rel: string): AssetRef => ({ url: `/${rel}`, source: path.join(publicRoot, rel) })

const run = (referenced: AssetRef[]) =>
  publishAssets({ readerRoot, referenced, sourceRoots: [publicRoot, photoRoot] })

beforeEach(() => {
  root = mkdtempSync(path.join(tmpdir(), 'loom-assets-'))
  publicRoot = path.join(root, 'public')
  readerRoot = path.join(root, 'reader-public')
  photoRoot = path.join(root, 'writeai-photos')
  for (const d of [publicRoot, readerRoot, photoRoot]) mkdirSync(d, { recursive: true })
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
      '/../../etc/passwd', '../../../etc/passwd',
      '/covers/../../../../etc/passwd', '', '/',
    ]) {
      expect(resolveInside('/srv/public', hostile)).toBeNull()
    }
  })

  it('treats an absolute-looking path as relative to the root', () => {
    // "/etc/passwd" is a stored-path shape, not a filesystem path — the leading
    // slash must not send it to the real /etc.
    expect(resolveInside('/srv/public', '/etc/passwd')).toBe('/srv/public/etc/passwd')
  })
})

describe('publishAssets', () => {
  it('links only what is referenced', () => {
    write(publicRoot, 'covers/wanted.jpg', 'W')
    write(publicRoot, 'covers/draft-spoiler.jpg', 'D')
    const report = run([ref('covers/wanted.jpg')])
    expect(report.linked + report.copied).toBe(1)
    expect(existsSync(path.join(readerRoot, 'covers/wanted.jpg'))).toBe(true)
    // Mirroring the directory would ship an unreferenced file.
    expect(existsSync(path.join(readerRoot, 'covers/draft-spoiler.jpg'))).toBe(false)
  })

  it('links a portrait from OUTSIDE public/ — the WriteAI case', () => {
    // Most character portraits live in the WriteAI repo. The reader-facing URL
    // is still /characters/..., but the source is another directory entirely.
    const src = write(photoRoot, 'wc-abc123.jpg', 'PORTRAIT')
    const report = run([{ url: '/characters/wc-abc123.jpg', source: src }])
    expect(report.linked + report.copied).toBe(1)
    const dest = path.join(readerRoot, 'characters/wc-abc123.jpg')
    expect(readFileSync(dest, 'utf8')).toBe('PORTRAIT')
    expect(statSync(dest).ino).toBe(statSync(src).ino)
  })

  it('prunes what is no longer referenced', () => {
    write(publicRoot, 'covers/a.jpg', 'A')
    write(readerRoot, 'covers/stale.jpg', 'OLD')
    const report = run([ref('covers/a.jpg')])
    expect(report.pruned).toBe(1)
    expect(existsSync(path.join(readerRoot, 'covers/stale.jpg'))).toBe(false)
  })

  it('never touches a source, even one it prunes on the other side', () => {
    write(publicRoot, 'covers/a.jpg', 'A')
    write(publicRoot, 'covers/unreferenced.jpg', 'KEEP ME')
    write(readerRoot, 'covers/unreferenced.jpg', 'copy')
    run([ref('covers/a.jpg')])
    expect(existsSync(path.join(readerRoot, 'covers/unreferenced.jpg'))).toBe(false)
    expect(readFileSync(path.join(publicRoot, 'covers/unreferenced.jpg'), 'utf8')).toBe('KEEP ME')
  })

  it('reports a missing source instead of failing silently', () => {
    const report = run([ref('covers/gone.jpg')])
    expect(report.missing).toEqual(['/covers/gone.jpg'])
    expect(report.linked + report.copied).toBe(0)
  })

  it('refuses a destination URL that escapes the reader root', () => {
    const src = write(publicRoot, 'covers/a.jpg', 'A')
    const outsider = write(root, 'secret.txt', 'SECRET')
    const report = run([
      ref('covers/a.jpg'),
      { url: '../secret.txt', source: src },
      { url: '/covers/../../secret.txt', source: src },
    ])
    expect(report.missing).toContain('../secret.txt')
    expect(existsSync(path.join(readerRoot, 'secret.txt'))).toBe(false)
    expect(readFileSync(outsider, 'utf8')).toBe('SECRET')
  })

  it('leaves files outside the media roots alone', () => {
    // The reader app's own assets (a logo, a favicon) are not ours to prune.
    write(readerRoot, 'logo.svg', 'LOGO')
    write(publicRoot, 'covers/a.jpg', 'A')
    run([ref('covers/a.jpg')])
    expect(existsSync(path.join(readerRoot, 'logo.svg'))).toBe(true)
  })

  it('refuses overlap with ANY source root, including WriteAI&apos;s', () => {
    // The catastrophic misconfiguration: the reader root pointed at a source.
    // The prune would delete unreferenced originals — 2.6 GB of audiobook in
    // Loom's case, another repo's photo library in WriteAI's.
    write(publicRoot, 'narration/precious.m4a', 'AUDIOBOOK')
    write(photoRoot, 'wc-1.jpg', 'PORTRAIT')
    for (const bad of [publicRoot, photoRoot, path.join(publicRoot, 'sub'), root]) {
      expect(() => publishAssets({
        readerRoot: bad, referenced: [], sourceRoots: [publicRoot, photoRoot],
      })).toThrow(/overlap/)
    }
    expect(readFileSync(path.join(publicRoot, 'narration/precious.m4a'), 'utf8')).toBe('AUDIOBOOK')
    expect(readFileSync(path.join(photoRoot, 'wc-1.jpg'), 'utf8')).toBe('PORTRAIT')
  })

  it('hardlinks rather than copying, so 2.6 GB of narration costs nothing', () => {
    const src = write(publicRoot, 'narration/big.m4a', 'AUDIO')
    const report = run([ref('narration/big.m4a')])
    expect(report.linked).toBe(1)
    expect(report.copied).toBe(0)
    expect(report.bytes).toBe(0)
    expect(statSync(path.join(readerRoot, 'narration/big.m4a')).ino).toBe(statSync(src).ino)
    expect(statSync(src).nlink).toBe(2)
  })

  it('pruning a hardlink leaves the original whole', () => {
    // The property that makes hardlinks viable: rmSync drops one NAME, and the
    // data survives while any name remains. Without it the prune would be
    // deleting the author's audiobook rather than the reader's view of it.
    const src = write(publicRoot, 'narration/keeper.m4a', 'AUDIOBOOK')
    run([ref('narration/keeper.m4a')])
    const report = run([])
    expect(report.pruned).toBe(1)
    expect(readFileSync(src, 'utf8')).toBe('AUDIOBOOK')
    expect(statSync(src).nlink).toBe(1)
  })

  it('relinks when the source file was replaced', () => {
    write(publicRoot, 'covers/a.jpg', 'OLD')
    run([ref('covers/a.jpg')])
    rmSync(path.join(publicRoot, 'covers/a.jpg'))
    const fresh = write(publicRoot, 'covers/a.jpg', 'NEW')
    const report = run([ref('covers/a.jpg')])
    expect(report.linked).toBe(1)
    expect(readFileSync(path.join(readerRoot, 'covers/a.jpg'), 'utf8')).toBe('NEW')
    expect(statSync(path.join(readerRoot, 'covers/a.jpg')).ino).toBe(statSync(fresh).ino)
  })

  it('skips work when the destination is already the same inode', () => {
    write(publicRoot, 'narration/big.m4a', 'AUDIO')
    expect(run([ref('narration/big.m4a')]).linked).toBe(1)
    const second = run([ref('narration/big.m4a')])
    expect(second.linked + second.copied).toBe(0)
    expect(second.pruned).toBe(0)
  })
})
