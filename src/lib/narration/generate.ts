import { writeFile, mkdir } from 'fs/promises'
import { existsSync } from 'fs'
import path from 'path'
import { prisma } from '@/lib/prisma'
import { narrationHash, narrationSegments, DEFAULT_VOICE, type NarrationPlan, type WordTiming } from './text'
import type { StoryState } from '@/lib/storyEngine'
import { synthesize, concatM4a } from './synthesize'

const NARRATION_DIR = path.join(process.cwd(), 'public', 'narration')
const SEGMENT_DIR = path.join(NARRATION_DIR, 'seg')

const publicPath = (p: string) => path.join(process.cwd(), 'public', p)
const onDisk = (p: string) => existsSync(publicPath(p))

export type NarrationStatus =
  | {
      status: 'ready'
      audioPath: string
      durationMs: number
      timing: WordTiming[]
      voice: string
      blockIds: string[]
      // Start offset (ms) of each unlocked segment within the combined track, so
      // the reader can resume playback at the first newly-unlocked segment when a
      // choice unlocks more prose.
      segments: number[]
      // True when the track stops at a visible, still-unanswered choice (the
      // reader has reached a decision) rather than the chapter's real end.
      endsAtChoice: boolean
    }
  | { status: 'generating' } // synthesis (or concat) in progress
  | { status: 'none' }       // never generated (and nothing in flight)
  | { status: 'empty' }      // nothing narratable
  | { status: 'error' }      // last generation attempt failed

// variantHash -> in-flight generation. Keyed by the variant (segment sequence +
// voice), not the chapter, so two branches of the same chapter can generate
// independently and the nightly cron never fights a reader-triggered request for
// the same variant. Safe as module state — single-instance app.
const inFlight = new Map<string, Promise<void>>()
// variantHashes whose last generation threw. A poll (non-trigger request) that
// finds one returns 'error' so the reader stops polling instead of looping; a
// fresh trigger (re-entering the chapter) clears it and retries.
const failed = new Set<string>()

// The reader's unlocked narration as a segment plan, resolved against their
// current variable state and the choices they've answered. Merges the series'
// default variable values under the passed state so a variable added after the
// session started still resolves.
async function chapterPlan(
  chapterId: string,
  state: StoryState | undefined,
  answered: Record<string, string> | undefined,
): Promise<NarrationPlan> {
  const chapter = await prisma.chapter.findUnique({
    where: { id: chapterId },
    select: {
      book: { select: { series: { select: { variables: { select: { name: true, defaultValue: true } } } } } },
      blocks: {
        select: {
          id: true, type: true, content: true, condition: true, order: true,
          overrides: { select: { id: true, order: true, condition: true, content: true, endingMessage: true } },
          choices: { select: { id: true, endingMessage: true, isBadEnding: true } },
        },
        orderBy: { order: 'asc' },
      },
    },
  })
  if (!chapter) return { segments: [], endsAtChoice: false }
  const merged: StoryState = {}
  for (const v of chapter.book.series.variables) {
    const parsed = ((): unknown => { try { return JSON.parse(v.defaultValue) } catch { return undefined } })()
    if (parsed !== undefined) merged[v.name] = parsed as StoryState[string]
  }
  if (state) for (const [k, val] of Object.entries(state)) merged[k] = val
  return narrationSegments(chapter.blocks, merged, answered ?? {})
}

const segHashesFor = (plan: NarrationPlan, voice: string) =>
  plan.segments.map(s => narrationHash(s.text, voice))

// Fingerprint the whole unlocked sequence: fold the per-segment hashes together
// so a chapter edit, a different branch, or a newly-unlocked segment all yield a
// distinct variant (and thus a cache miss that regenerates).
const variantHashFor = (segHashes: string[], voice: string) =>
  narrationHash(segHashes.join('|'), voice)

// Synthesize + persist one segment clip, content-addressed by its hash. A no-op
// when the clip already exists on disk, so the shared pre-choice segment (and
// any branch a reader revisits) is synthesized at most once.
async function ensureSegmentClip(hash: string, text: string, voice: string): Promise<void> {
  const existing = await prisma.narrationSegment.findUnique({ where: { hash } })
  if (existing && onDisk(existing.audioPath)) return
  const { audio, timing, durationMs } = await synthesize(text, voice)
  await mkdir(SEGMENT_DIR, { recursive: true })
  const audioPath = `/narration/seg/${hash}.m4a`
  await writeFile(publicPath(audioPath), audio)
  const data = { voice, audioPath, timing: JSON.stringify(timing), durationMs }
  await prisma.narrationSegment.upsert({ where: { hash }, create: { hash, ...data }, update: data })
}

// Concatenate the (already-synthesized) segment clips for this variant into the
// chapter's combined track and upsert the variant row. A single-segment variant
// reuses its shared clip directly — no per-chapter file, no concat.
async function buildVariant(
  chapterId: string,
  plan: NarrationPlan,
  segHashes: string[],
  variantHash: string,
  voice: string,
): Promise<void> {
  const rows = await prisma.narrationSegment.findMany({ where: { hash: { in: segHashes } } })
  const byHash = new Map(rows.map(r => [r.hash, r]))
  const segRows = segHashes.map(h => byHash.get(h))
  if (segRows.some(r => !r)) throw new Error('missing segment clip during variant build')

  // Combine the per-segment word timings into one continuous track: offset each
  // segment's word times by the cumulative duration ahead of it, and its char
  // ranges by the cumulative text length (+2 per '\n\n' segment join).
  const timing: WordTiming[] = []
  let cumMs = 0
  let cumChars = 0
  for (let i = 0; i < segRows.length; i++) {
    const row = segRows[i]!
    const segTiming = JSON.parse(row.timing) as WordTiming[]
    for (const w of segTiming) {
      timing.push({ word: w.word, charStart: w.charStart + cumChars, charLen: w.charLen, timeMs: w.timeMs + cumMs })
    }
    cumMs += row.durationMs
    cumChars += plan.segments[i].text.length + 2
  }

  let audioPath: string
  if (segRows.length === 1) {
    audioPath = segRows[0]!.audioPath
  } else {
    await mkdir(NARRATION_DIR, { recursive: true })
    const file = `${chapterId}-${variantHash.slice(0, 16)}.m4a`
    await concatM4a(segRows.map(r => publicPath(r!.audioPath)), path.join(NARRATION_DIR, file))
    audioPath = `/narration/${file}`
  }

  const data = { voice, audioPath, timing: JSON.stringify(timing), contentHash: variantHash, durationMs: cumMs }
  await prisma.chapterNarration.upsert({
    where: { chapterId_contentHash: { chapterId, contentHash: variantHash } },
    create: { chapterId, ...data },
    update: data,
  })
}

// Synthesize any missing segments (serially — synthesis is CPU-heavy), then
// stitch the variant together.
async function generateVariant(
  chapterId: string,
  plan: NarrationPlan,
  segHashes: string[],
  variantHash: string,
  voice: string,
): Promise<void> {
  for (let i = 0; i < plan.segments.length; i++) {
    await ensureSegmentClip(segHashes[i], plan.segments[i].text, voice)
  }
  await buildVariant(chapterId, plan, segHashes, variantHash, voice)
}

// Run generation for a variant unless it's already running; dedupe via the
// in-flight map and record failures so polls can surface them.
function startGeneration(variantHash: string, work: () => Promise<void>): Promise<void> {
  const existing = inFlight.get(variantHash)
  if (existing) return existing
  const p = work()
    .then(() => { failed.delete(variantHash) })
    .catch(err => {
      failed.add(variantHash)
      console.error(`[narration] ${variantHash.slice(0, 12)} failed:`, err instanceof Error ? err.message : err)
    })
    .finally(() => { inFlight.delete(variantHash) })
  inFlight.set(variantHash, p)
  return p
}

// Build the ready payload for an existing variant row: the combined track plus
// the per-segment start offsets (from the cached segment durations) and the
// block ids / endsAtChoice recomputed from the plan.
async function readyPayload(
  row: { audioPath: string; durationMs: number; timing: string; voice: string },
  plan: NarrationPlan,
  segHashes: string[],
): Promise<NarrationStatus> {
  const rows = await prisma.narrationSegment.findMany({
    where: { hash: { in: segHashes } },
    select: { hash: true, durationMs: true },
  })
  const durByHash = new Map(rows.map(r => [r.hash, r.durationMs]))
  const segments: number[] = []
  let cum = 0
  for (const h of segHashes) { segments.push(cum); cum += durByHash.get(h) ?? 0 }
  return {
    status: 'ready',
    audioPath: row.audioPath,
    durationMs: row.durationMs,
    timing: JSON.parse(row.timing),
    voice: row.voice,
    blockIds: plan.segments.flatMap(s => s.blockIds),
    segments,
    endsAtChoice: plan.endsAtChoice,
  }
}

// The read-mode entry point. Resolves the reader's unlocked narration for their
// current state + answered choices, returns it if cached, otherwise kicks off
// background generation and returns immediately. `trigger` is true for the
// initial request (which may start generation) and false for polls (which only
// observe — a failed variant reports 'error' so the reader stops polling).
export async function ensureFresh(
  chapterId: string,
  state?: StoryState,
  answered?: Record<string, string>,
  voice = DEFAULT_VOICE,
  trigger = true,
): Promise<NarrationStatus> {
  const plan = await chapterPlan(chapterId, state, answered)
  if (plan.segments.length === 0) return { status: 'empty' }
  const segHashes = segHashesFor(plan, voice)
  const variantHash = variantHashFor(segHashes, voice)

  const row = await prisma.chapterNarration.findUnique({
    where: { chapterId_contentHash: { chapterId, contentHash: variantHash } },
  })
  if (row && onDisk(row.audioPath)) return readyPayload(row, plan, segHashes)

  if (inFlight.has(variantHash)) return { status: 'generating' }
  if (failed.has(variantHash)) {
    if (!trigger) return { status: 'error' }
    failed.delete(variantHash)
  }
  if (!trigger) return { status: 'generating' }

  startGeneration(variantHash, () => generateVariant(chapterId, plan, segHashes, variantHash, voice))
  return { status: 'generating' }
}

// Read-only status against the default (pre-choice) variant — never triggers
// work. Kept for the GET route; the reader itself drives ensureFresh with its
// own state.
export async function getStatus(chapterId: string, voice = DEFAULT_VOICE): Promise<NarrationStatus> {
  const plan = await chapterPlan(chapterId, undefined, {})
  if (plan.segments.length === 0) return { status: 'empty' }
  const segHashes = segHashesFor(plan, voice)
  const variantHash = variantHashFor(segHashes, voice)
  if (inFlight.has(variantHash)) return { status: 'generating' }
  const row = await prisma.chapterNarration.findUnique({
    where: { chapterId_contentHash: { chapterId, contentHash: variantHash } },
  })
  if (row && onDisk(row.audioPath)) return readyPayload(row, plan, segHashes)
  return { status: 'none' }
}

// Nightly pre-warm: ensure the default (pre-choice) variant exists so opening a
// chapter in read mode is instant. Branch variants warm on demand when a reader
// answers a choice. Returns whether it kicked off generation.
export async function regenerateStaleChapter(chapterId: string, voice = DEFAULT_VOICE): Promise<boolean> {
  const plan = await chapterPlan(chapterId, undefined, {})
  if (plan.segments.length === 0) return false
  const segHashes = segHashesFor(plan, voice)
  const variantHash = variantHashFor(segHashes, voice)
  const row = await prisma.chapterNarration.findUnique({
    where: { chapterId_contentHash: { chapterId, contentHash: variantHash } },
    select: { audioPath: true },
  })
  if (row && onDisk(row.audioPath)) return false
  await startGeneration(variantHash, () => generateVariant(chapterId, plan, segHashes, variantHash, voice))
  return true
}
