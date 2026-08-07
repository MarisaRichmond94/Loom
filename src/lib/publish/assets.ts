import { copyFileSync, existsSync, linkSync, mkdirSync, readdirSync, rmSync, statSync } from 'node:fs'
import path from 'node:path'

/**
 * Links the media published content references into the reader tier, and prunes
 * what it no longer references (LOOM-128/131).
 *
 * Callers hand over resolved pairs — the reader-facing URL and the absolute
 * file it comes from. That indirection exists because the sources are no longer
 * all in one place: covers, soundtracks and narration live in Loom's public/,
 * while most character portraits live in the WriteAI repo. Resolution is the
 * publisher's job; this module only links and prunes.
 *
 * THE PRUNE IS THE DANGEROUS PART. It deletes files, driven by paths that came
 * out of a database. WriteAI has already lost real portraits to a glob-then-
 * unlink over an unvalidated path parameter, so every delete is bounded by
 * `assertInside`, and the tests aim hostile paths at it rather than assuming
 * intent.
 */

/** Media roots, relative to the reader's asset root. Anything else is not ours. */
const MEDIA_DIRS = ['covers', 'characters', 'music', 'narration'] as const

/** A reader-facing URL and the file it should be linked from. */
export type AssetRef = { url: string; source: string }

export type AssetReport = {
  /** Hardlinked — the normal case, and free. */
  linked: number
  /** Copied because a hardlink was impossible (different filesystem). */
  copied: number
  pruned: number
  /** Referenced but not on disk. Reported, never silently skipped. */
  missing: string[]
  /** Bytes actually consumed. Hardlinks contribute nothing. */
  bytes: number
}

/**
 * Resolve `rel` under `root` and refuse anything that escapes.
 *
 * Guards `..`, absolute paths and root escapes by comparing the RESOLVED path
 * against the resolved root. Returns null rather than throwing so a caller can
 * report a bad reference and continue — one malformed row should not abort a
 * publish.
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

export function publishAssets(opts: {
  readerRoot: string
  referenced: Iterable<AssetRef>
  /**
   * Directories the sources come from. Used ONLY to refuse an overlapping
   * reader root — never to resolve anything.
   */
  sourceRoots: string[]
}): AssetReport {
  // THE GUARD THAT MATTERS MOST IN THIS FILE.
  //
  // The prune deletes every file under readerRoot's media dirs that publish did
  // not just reference. If readerRoot were ever pointed at Loom's public/ — a
  // copy-pasted config, an unset env var, a typo — that would delete the
  // author's unreferenced covers, portraits, music and narration.
  // public/narration alone is 2.6 GB of generated audiobook. And with the
  // WriteAI photo directory now a source too, the same mistake would reach
  // another repo's files.
  const readerAbs = path.resolve(opts.readerRoot)
  for (const root of opts.sourceRoots) {
    const srcAbs = path.resolve(root)
    if (
      srcAbs === readerAbs ||
      readerAbs.startsWith(srcAbs + path.sep) ||
      srcAbs.startsWith(readerAbs + path.sep)
    ) {
      throw new Error(
        `Refusing to publish assets: reader root overlaps a source root.\n` +
        `  source: ${srcAbs}\n  reader: ${readerAbs}\n` +
        `The prune deletes unreferenced files under the reader root; an overlap would delete originals.`,
      )
    }
  }

  const report: AssetReport = { linked: 0, copied: 0, pruned: 0, missing: [], bytes: 0 }

  const wanted = new Map<string, string>() // reader-relative path -> source
  for (const ref of opts.referenced) {
    const dest = resolveInside(readerAbs, ref.url)
    if (!dest || !ref.source || !existsSync(ref.source)) {
      report.missing.push(ref.url)
      continue
    }
    wanted.set(path.relative(readerAbs, dest), ref.source)
  }

  const existing = listExisting(readerAbs)

  for (const [rel, src] of wanted) {
    const dest = path.join(readerAbs, rel)
    assertInside(readerAbs, dest)
    mkdirSync(path.dirname(dest), { recursive: true })

    const srcStat = statSync(src)
    if (existsSync(dest)) {
      const destStat = statSync(dest)
      // Already the same inode: the hardlink from a previous publish. Exact
      // rather than heuristic.
      if (destStat.dev === srcStat.dev && destStat.ino === srcStat.ino) continue
      // A stale copy, or a link to a replaced file — clear it and relink.
      rmSync(dest, { force: true })
    }

    // HARDLINK, not copy. public/narration alone is 2.6 GB, and duplicating it
    // per publish would be waste — a hardlink is a second name for one inode.
    //
    // Safe for the prune: rmSync drops that NAME only, and the data survives
    // while any name remains. So "the reader tier may delete its own files"
    // stays true even though those files are the author's originals.
    //
    // The rule this imposes: the reader tier treats its assets as READ-ONLY.
    // Writing through a hardlink writes the original too.
    try {
      linkSync(src, dest)
      report.linked += 1
    } catch {
      // Different filesystem (EXDEV), or one without hardlinks. Copy instead —
      // correct, just not free. The WriteAI repo could plausibly be on another
      // volume, so this path is not hypothetical.
      copyFileSync(src, dest)
      report.copied += 1
      report.bytes += srcStat.size
    }
  }

  for (const rel of existing) {
    if (wanted.has(rel)) continue
    const target = path.join(readerAbs, rel)
    // A path derived from a directory listing should always be inside the root
    // — but "should" is what the WriteAI portrait bug also assumed.
    assertInside(readerAbs, target)
    rmSync(target, { force: true })
    report.pruned += 1
  }

  return report
}
