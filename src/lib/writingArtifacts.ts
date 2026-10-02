// Explicit, on-demand runs of the nightly audiobook / EPUB builders (LOOM-157).
//
// `ops/generate_audiobook.sh` and `ops/generate_ebook.sh` already do this work
// every night from `book_backup.sh`. Nothing here re-implements them: the whole
// point is that the button runs the SAME script the nightly runs, in the same
// `--update` incremental mode, so an artifact built from the series page and
// one built at 22:30 are the same artifact. A second pipeline in TypeScript
// would be a second thing to get wrong, and the parts that matter (the shared
// chapter split, the hang watchdog around `say`, the m4b chapter markers) are
// exactly the parts that would be reimplemented worst.
//
// Two things make this more than "spawn a script":
//
//   1. ADDRESSING. The scripts take a 1-based index into a hardcoded registry
//      of the five canon books. Loom knows books by cuid. The index is read
//      out of the script's own `add_book` lines and joined on the title, the
//      same way the WriteAI seam joins on title (see writeaiBooks.ts) — so
//      reordering or renaming in the script cannot silently point a button at
//      the wrong book. A book the script has never heard of is a real state,
//      reported as such, not a run against index 1.
//
//   2. DURATION. A narration pass is minutes, not milliseconds, and the EPUB
//      step drives Pages through the GUI. Neither can live inside a request.
//      Runs are tracked in a module-level registry and polled; the Next server
//      is a permanent launchd service, so in-process state outlives the
//      request that started it. It does NOT outlive a restart — a run in
//      flight when the service is kicked is simply forgotten, which is why
//      every run also appends to a log file under ~/Backups/_logs/ alongside
//      the nightly's own logs.

import { spawn } from 'node:child_process'
import { createWriteStream } from 'node:fs'
import { readFile, mkdir } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { normBookTitle } from './bookTitleMatch'

export type ArtifactKind = 'audiobook' | 'epub'

const SCRIPTS: Record<ArtifactKind, string> = {
  audiobook: 'generate_audiobook.sh',
  epub: 'generate_ebook.sh',
}

/** How these read in a sentence the writer sees. */
export const ARTIFACT_LABELS: Record<ArtifactKind, string> = {
  audiobook: 'Audiobook',
  epub: 'EPUB',
}

/**
 * A narration pass over a changed book is minutes; a whole book that somehow
 * needs re-narrating is longer. The cap exists so a wedged `say` or a Pages
 * dialog waiting for a click cannot leave a job "running" forever — the
 * script has its own per-chapter watchdog, this is the outer bound.
 */
const TIMEOUT_MS = 90 * 60 * 1000

/** Tail kept in memory, so a failure can be explained without opening a log. */
const TAIL_LINES = 14

export type ArtifactRun = {
  kind: ArtifactKind
  bookId: string
  bookTitle: string
  startedAt: number
  finishedAt: number | null
  /** null while running. */
  ok: boolean | null
  /** Set when `ok` is false. One sentence, already fit to show. */
  error: string | null
  /** The script's last lines — its own progress narration. */
  tail: string[]
  logPath: string
  timedOut: boolean
}

/** Public shape: same thing, minus the handle to the child. */
export type ArtifactRunState = Omit<ArtifactRun, never>

type Tracked = ArtifactRun & { child: ReturnType<typeof spawn> | null }

// Keyed by book + kind. One run per pair: the scripts write into a single
// output directory per book, so two concurrent runs over the same book would
// race over the same chapter split.
const runs = new Map<string, Tracked>()

const key = (bookId: string, kind: ArtifactKind) => `${bookId}:${kind}`

const strip = ({ child: _child, ...rest }: Tracked): ArtifactRunState => rest

/** The current or most recent run for this book, per kind. */
export function artifactRuns(bookId: string): Partial<Record<ArtifactKind, ArtifactRunState>> {
  const out: Partial<Record<ArtifactKind, ArtifactRunState>> = {}
  for (const kind of Object.keys(SCRIPTS) as ArtifactKind[]) {
    const run = runs.get(key(bookId, kind))
    if (run) out[kind] = strip(run)
  }
  return out
}

export const isRunning = (bookId: string, kind: ArtifactKind) =>
  runs.get(key(bookId, kind))?.ok === null

/**
 * The script's own index for a book title, or null if it has no such book.
 *
 * Parsed from the script rather than duplicated here. The registry is five
 * lines of zsh that have been edited by hand each time a book shipped; a copy
 * in TypeScript would be correct exactly until the next edit, and the failure
 * mode of a stale copy is the worst one available — building the wrong book's
 * audiobook and reporting success.
 */
export async function scriptBookIndex(
  kind: ArtifactKind,
  title: string,
): Promise<number | null> {
  const script = path.join(process.cwd(), 'ops', SCRIPTS[kind])
  let source: string
  try {
    source = await readFile(script, 'utf-8')
  } catch {
    return null
  }
  // add_book "Nobody's Hero"  "/Users/…/Nobody's Hero.pages"  1
  //                  ^ the title, which is what we join on. The trailing
  //                  number is the SERIES TRACK, not the menu index — the
  //                  index is the line's position, which is what the script's
  //                  own `sel` loop uses.
  const titles = [...source.matchAll(/^add_book\s+"([^"]+)"/gm)].map(m => m[1])
  const at = titles.findIndex(t => normBookTitle(t) === normBookTitle(title))
  return at === -1 ? null : at + 1
}

/**
 * Start an incremental run, or hand back the one already going.
 *
 * `--update` is the nightly's mode, deliberately: it re-exports from Pages,
 * re-splits, and only re-narrates segments whose text actually changed. A book
 * whose prose has not moved reports "nothing to re-narrate" in seconds rather
 * than spending an hour reproducing a byte-identical file.
 */
export async function startArtifactRun(
  kind: ArtifactKind,
  book: { id: string; title: string },
): Promise<{ run: ArtifactRunState } | { error: string; status: number }> {
  const existing = runs.get(key(book.id, kind))
  if (existing && existing.ok === null) return { run: strip(existing) }

  const index = await scriptBookIndex(kind, book.title)
  if (index === null) {
    return {
      // Not a 500: the scripts only know the five canon books, and a branch
      // book or a new one legitimately has no entry yet. Say which thing is
      // missing, because the fix is a one-line edit to a file she owns.
      error: `${SCRIPTS[kind]} has no entry for “${book.title}”. Add it to the script's add_book list first.`,
      status: 409,
    }
  }

  const logDir = path.join(os.homedir(), 'Backups', '_logs')
  await mkdir(logDir, { recursive: true })
  const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19)
  const logPath = path.join(logDir, `${kind}_ondemand_${stamp}.log`)

  const script = path.join(process.cwd(), 'ops', SCRIPTS[kind])
  const child = spawn('/bin/zsh', [script, '--update', String(index)], {
    cwd: process.cwd(),
    // The scripts shell out to ffmpeg, pandoc, AtomicParsley and say, all of
    // which live in Homebrew's bin. launchd hands this service a minimal
    // PATH, and a missing `pandoc` would surface as the script's own
    // dependency check failing rather than anything about this file.
    env: { ...process.env, PATH: `/opt/homebrew/bin:/usr/local/bin:${process.env.PATH ?? ''}` },
  })

  const run: Tracked = {
    kind,
    bookId: book.id,
    bookTitle: book.title,
    startedAt: Date.now(),
    finishedAt: null,
    ok: null,
    error: null,
    tail: [],
    logPath,
    timedOut: false,
    child,
  }
  runs.set(key(book.id, kind), run)

  const log = createWriteStream(logPath, { flags: 'a' })
  log.write(`[${new Date().toISOString()}] ${SCRIPTS[kind]} --update ${index}  (${book.title})\n`)

  const absorb = (chunk: Buffer) => {
    const text = chunk.toString()
    log.write(text)
    for (const line of text.split('\n')) {
      if (line.trim()) run.tail.push(line.trimEnd())
    }
    if (run.tail.length > TAIL_LINES) run.tail = run.tail.slice(-TAIL_LINES)
  }
  child.stdout?.on('data', absorb)
  child.stderr?.on('data', absorb)

  const timer = setTimeout(() => {
    run.timedOut = true
    child.kill('SIGTERM')
  }, TIMEOUT_MS)

  const settle = (ok: boolean, error: string | null) => {
    if (run.ok !== null) return
    clearTimeout(timer)
    run.child = null
    run.ok = ok
    run.error = error
    run.finishedAt = Date.now()
    log.write(`[${new Date().toISOString()}] ${ok ? 'OK' : `FAILED: ${error}`}\n`)
    log.end()
  }

  child.on('error', err => settle(false, `Could not start ${SCRIPTS[kind]}: ${err.message}`))
  child.on('close', code => {
    if (run.timedOut) {
      settle(false, `Timed out after ${TIMEOUT_MS / 60000} minutes and was stopped. Check the log — a Pages dialog waiting for a click will do this.`)
    } else if (code === 0) {
      settle(true, null)
    } else {
      settle(false, `${SCRIPTS[kind]} exited ${code}. The last lines are below; the full log is at ${logPath}.`)
    }
  })

  return { run: strip(run) }
}
