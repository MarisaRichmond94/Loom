import { writeFile, mkdir } from 'fs/promises'
import path from 'path'
import { prisma } from '@/lib/prisma'
import { narrationContent, narrationHash, DEFAULT_VOICE, type WordTiming } from './text'
import type { StoryState } from '@/lib/storyEngine'
import { synthesize } from './synthesize'

const NARRATION_DIR = path.join(process.cwd(), 'public', 'narration')

export type NarrationStatus =
  | { status: 'ready'; audioPath: string; durationMs: number; timing: WordTiming[]; voice: string; blockIds: string[] }
  | { status: 'generating' }   // synthesis in progress
  | { status: 'stale' }        // audio on disk, but the chapter text changed since
  | { status: 'none' }         // never generated (or last attempt failed)
  | { status: 'empty' }        // chapter has no narratable prose

// chapterId -> in-flight generation. The single guard that keeps the nightly
// cron and a Preview-triggered request from synthesizing the same chapter
// twice at once. Safe as module state because this is a single-instance app.
const inFlight = new Map<string, Promise<void>>()

export function isGenerating(chapterId: string): boolean {
  return inFlight.has(chapterId)
}

// The spoken text + contributing block ids for a chapter, resolved against the
// series' default variable state (what a fresh Preview session renders).
async function chapterContent(chapterId: string): Promise<{ text: string; blockIds: string[] }> {
  const chapter = await prisma.chapter.findUnique({
    where: { id: chapterId },
    select: {
      book: { select: { series: { select: { variables: { select: { name: true, defaultValue: true } } } } } },
      blocks: {
        select: {
          id: true, type: true, content: true, condition: true, order: true,
          overrides: { select: { id: true, order: true, condition: true, content: true, endingMessage: true } },
        },
        orderBy: { order: 'asc' },
      },
    },
  })
  if (!chapter) return { text: '', blockIds: [] }
  const state: StoryState = {}
  for (const v of chapter.book.series.variables) {
    const parsed = ((): unknown => { try { return JSON.parse(v.defaultValue) } catch { return undefined } })()
    if (parsed !== undefined) state[v.name] = parsed as StoryState[string]
  }
  return narrationContent(chapter.blocks, state)
}

// Synthesize and persist. Writes the audio to disk first, then upserts the row,
// so a reader never sees a DB row pointing at a file that isn't there yet.
async function generate(chapterId: string, text: string, voice: string): Promise<void> {
  const { audio, timing, durationMs } = await synthesize(text, voice)
  await mkdir(NARRATION_DIR, { recursive: true })
  await writeFile(path.join(NARRATION_DIR, `${chapterId}.m4a`), audio)
  const data = {
    voice,
    audioPath: `/narration/${chapterId}.m4a`,
    timing: JSON.stringify(timing),
    contentHash: narrationHash(text, voice),
    durationMs,
  }
  await prisma.chapterNarration.upsert({
    where: { chapterId },
    create: { chapterId, ...data },
    update: data,
  })
}

// Start generation unless it's already running for this chapter; dedupe via the
// in-flight map. Returns the shared promise so the cron can await it (the
// Preview path deliberately does not).
export function startGeneration(chapterId: string, text: string, voice: string): Promise<void> {
  const existing = inFlight.get(chapterId)
  if (existing) return existing
  const p = generate(chapterId, text, voice)
    .catch(err => {
      console.error(`[narration] ${chapterId} failed:`, err instanceof Error ? err.message : err)
    })
    .finally(() => { inFlight.delete(chapterId) })
  inFlight.set(chapterId, p)
  return p
}

// Preview trigger: make sure fresh audio exists, but return immediately with a
// status instead of blocking on synthesis (a chapter can take minutes).
export async function ensureFresh(chapterId: string, voice = DEFAULT_VOICE): Promise<NarrationStatus> {
  if (inFlight.has(chapterId)) return { status: 'generating' }
  const { text, blockIds } = await chapterContent(chapterId)
  if (!text.trim()) return { status: 'empty' }
  const hash = narrationHash(text, voice)
  const row = await prisma.chapterNarration.findUnique({ where: { chapterId } })
  if (row && row.contentHash === hash) {
    return { status: 'ready', audioPath: row.audioPath, durationMs: row.durationMs, timing: JSON.parse(row.timing), voice: row.voice, blockIds }
  }
  startGeneration(chapterId, text, voice)
  return { status: 'generating' }
}

// Read-only status for the reader's polling GET — never triggers work itself.
export async function getStatus(chapterId: string, voice = DEFAULT_VOICE): Promise<NarrationStatus> {
  if (inFlight.has(chapterId)) return { status: 'generating' }
  const { text, blockIds } = await chapterContent(chapterId)
  if (!text.trim()) return { status: 'empty' }
  const hash = narrationHash(text, voice)
  const row = await prisma.chapterNarration.findUnique({ where: { chapterId } })
  if (!row) return { status: 'none' }
  if (row.contentHash === hash) {
    return { status: 'ready', audioPath: row.audioPath, durationMs: row.durationMs, timing: JSON.parse(row.timing), voice: row.voice, blockIds }
  }
  return { status: 'stale' }
}

// Used by the nightly scheduler: regenerate every chapter whose spoken text no
// longer matches its stored narration. Serialized by the caller; returns the
// count regenerated.
export async function regenerateStaleChapter(chapterId: string, voice = DEFAULT_VOICE): Promise<boolean> {
  const { text } = await chapterContent(chapterId)
  if (!text.trim()) return false
  const hash = narrationHash(text, voice)
  const row = await prisma.chapterNarration.findUnique({ where: { chapterId }, select: { contentHash: true } })
  if (row && row.contentHash === hash) return false
  await startGeneration(chapterId, text, voice)
  return true
}
