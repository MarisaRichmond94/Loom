import path from 'node:path'
import { resolveDbPath } from '@/lib/dbSafety'

/**
 * Where the reader tier's files live.
 *
 * Centralised so the publish route, the status endpoint and (from LOOM-130) the
 * reader app itself cannot disagree — a mismatch would present as "publish
 * succeeded but readers see nothing", which is a miserable thing to debug.
 *
 * THE SOURCE FOLLOWS DATABASE_URL, not a hardcoded dev.db. Publish must read
 * whichever database the app is actually running against, or `npm run
 * dev:sandbox` would serve the fixture while publishing the real manuscript —
 * the exact confusion the sandbox exists to prevent.
 *
 * The outputs are namespaced by the source's filename for the same reason: a
 * sandbox publish must not overwrite the snapshot real readers are served.
 */
const repoRoot = process.cwd()

/** The manuscript — or the fixture, when running against one. Read-only here. */
export const SOURCE_DB_PATH = resolveDbPath(process.env.DATABASE_URL ?? 'file:./dev.db', repoRoot)

/**
 * `dev.db` -> "", `sandbox.db` -> "-sandbox". Keeps a fixture publish in its
 * own files rather than clobbering the real one.
 */
const sourceName = path.basename(SOURCE_DB_PATH, '.db')
const suffix = sourceName === 'dev' ? '' : `-${sourceName}`

/** The snapshot the reader app serves. Disposable — rebuilt by every publish. */
export const CONTENT_DB_PATH = path.join(repoRoot, 'reader', `content${suffix}.db`)

/** Loom's own media. Read from, never written by publish. */
export const LOOM_PUBLIC_ROOT = path.join(repoRoot, 'public')

/**
 * The reader tier's media root. Publish PRUNES here, so it must never overlap
 * LOOM_PUBLIC_ROOT — `publishAssets` refuses outright if it ever does.
 */
export const READER_ASSET_ROOT = path.join(repoRoot, 'reader', `public${suffix}`)
