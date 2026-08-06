import { copyFileSync, existsSync, mkdirSync, readdirSync, rmSync, statSync } from 'node:fs'
import path from 'node:path'

/**
 * Copies the media published content references into the reader tier, and
 * prunes what it no longer references (LOOM-128).
 *
 * WHITELIST BY REFERENCE, NOT BY DIRECTORY. Mirroring `public/covers/`
 * wholesale would put an unpublished book's cover on the reader tier, and a
 * cover is a spoiler. Only files named by published, canon-reachable content
 * cross over.
 *
 * THE PRUNE IS THE DANGEROUS PART. It deletes files, driven by paths that come
 * out of the database. WriteAI has already lost real portraits to a glob-then-
 * unlink over an unvalidated path parameter, and this is the same shape of
 * code. So every delete is bounded by `assertInside`, and the tests aim
 * adversarial paths at it rather than assuming intent.
 */

/** Media roots, relative to a public/ directory. Anything outside is not ours. */
const MEDIA_DIRS = ['covers', 'characters', 'music', 'narration'] as const

export type AssetReport = {
  copied: number
  pruned: number
  /** Referenced but not on disk. Reported, never silently skipped. */
  missing: string[]
  bytes: number
}

/**
 * Resolve `rel` under `root` and refuse anything that escapes.
 *
 * Guards `..`, absolute paths, and symlink-ish trickery by comparing the
 * RESOLVED path against the resolved root. Returns null rather than throwing so
 * callers can report a bad reference and continue — one malformed row should
 * not abort a publish.
 */
export function resolveInside(root: string, rel: string): string | null {
  if (!rel) return null
  // A leading slash is how these are stored ("/covers/x.jpg"); strip it so it
  // joins as relative rather than resolving to the filesystem root.
  const cleaned = rel.replace(/^\/+/, '').split('?')[0]
  if (!cleaned) return null
  const rootAbs = path.resolve(root)
  const candidate = path.resolve(rootAbs, cleaned)
  if (candidate !== rootAbs && !candidate.startsWith(rootAbs + path.sep)) return null
  return candidate
}

function assertInside(root: string, target: string): void {
  const rootAbs = path.resolve(root)
  const targetAbs = path.resolve(target)
  if (targetAbs !== rootAbs && !targetAbs.startsWith(rootAbs + path.sep)) {
    throw new Error(`Refusing to touch ${targetAbs}: outside ${rootAbs}`)
  }
}

/** Every media file currently under the reader root, as root-relative paths. */
function listExisting(readerRoot: string): Set<string> {
  const out = new Set<string>()
  for (const dir of MEDIA_DIRS) {
    const abs = path.join(readerRoot, dir)
    if (!existsSync(abs)) continue
    const walk = (d: string) => {
      for (const entry of readdirSync(d, { withFileTypes: true })) {
        const full = path.join(d, entry.name)
        if (entry.isDirectory()) walk(full)
        else out.add(path.relative(readerRoot, full))
      }
    }
    walk(abs)
  }
  return out
}

/**
 * @param referenced Media paths as stored in the database ("/covers/x.jpg").
 *                   Query strings are tolerated — soundtrack paths carry a
 *                   cache-busting `?t=` that is not part of the filename.
 */
export function publishAssets(opts: {
  publicRoot: string
  readerRoot: string
  referenced: Iterable<string>
}): AssetReport {
  const report: AssetReport = { copied: 0, pruned: 0, missing: [], bytes: 0 }

  const wanted = new Set<string>()
  for (const ref of opts.referenced) {
    const src = resolveInside(opts.publicRoot, ref)
    if (!src) { report.missing.push(ref); continue }
    if (!existsSync(src)) { report.missing.push(ref); continue }
    wanted.add(path.relative(path.resolve(opts.publicRoot), src))
  }

  const existing = listExisting(opts.readerRoot)

  for (const rel of wanted) {
    const src = path.join(opts.publicRoot, rel)
    const dest = path.join(opts.readerRoot, rel)
    assertInside(opts.readerRoot, dest)
    mkdirSync(path.dirname(dest), { recursive: true })
    // Skip identical files so a republish is cheap — narration audio is large,
    // and almost none of it changes between publishes.
    const srcStat = statSync(src)
    if (existsSync(dest)) {
      const destStat = statSync(dest)
      if (destStat.size === srcStat.size && destStat.mtimeMs >= srcStat.mtimeMs) continue
    }
    copyFileSync(src, dest)
    report.copied += 1
    report.bytes += srcStat.size
  }

  for (const rel of existing) {
    if (wanted.has(rel)) continue
    const target = path.join(opts.readerRoot, rel)
    // The line that matters. A path derived from a directory listing should
    // always be inside the root — but "should" is what the WriteAI portrait
    // bug also assumed.
    assertInside(opts.readerRoot, target)
    rmSync(target, { force: true })
    report.pruned += 1
  }

  return report
}
