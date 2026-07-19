import { spawn } from 'child_process'
import { existsSync } from 'fs'
import { mkdtemp, writeFile, readFile, rm } from 'fs/promises'
import { tmpdir } from 'os'
import path from 'path'
import type { WordTiming } from './text'

// Compiled by scripts/ensure-narrate.mjs before dev/build/start.
const NARRATE_BIN = path.join(process.cwd(), 'scripts', 'native', 'bin', 'narrate')

// A whole chapter can be many minutes of audio; offline synthesis is faster
// than real time but not instant. This timeout only guards against a wedged
// process (the historical `say` hang the shell pipeline retried around) — it
// is not a performance bound.
const HANG_TIMEOUT_MS = 20 * 60 * 1000
const FFMPEG_TIMEOUT_MS = 5 * 60 * 1000
const MAX_TRIES = 3

export type SynthResult = {
  audio: Buffer          // AAC m4a bytes
  timing: WordTiming[]
  durationMs: number
  sampleRate: number
}

export class NarrateUnavailableError extends Error {}

function run(cmd: string, args: string[], timeoutMs: number): Promise<void> {
  return new Promise((resolve, reject) => {
    const proc = spawn(cmd, args)
    let stderr = ''
    let killed = false
    const timer = setTimeout(() => { killed = true; proc.kill('SIGKILL') }, timeoutMs)
    proc.stderr?.on('data', d => { stderr += d.toString() })
    proc.on('error', err => { clearTimeout(timer); reject(err) })
    proc.on('close', code => {
      clearTimeout(timer)
      if (killed) return reject(new Error(`${cmd} timed out after ${timeoutMs}ms`))
      if (code !== 0) return reject(new Error(stderr.trim() || `${cmd} exited ${code}`))
      resolve()
    })
  })
}

// Synthesize narration text to AAC m4a audio + per-word timings via the Swift
// helper (offline AVSpeechSynthesizer), converting its lossless CAF to aac
// with ffmpeg. Retries on a hang or empty output, mirroring the per-segment
// watchdog in ~/Scripts/generate_audiobook.sh's gen_one.
// Concatenate several AAC m4a clips into one, in order, without re-encoding.
// The clips all come from synthesize()'s identical pipeline (same codec, sample
// rate, channel count), so ffmpeg's concat demuxer with stream copy joins them
// losslessly and cheaply — this is what lets answering a choice stitch the
// newly-synthesized segment onto the already-cached ones instead of re-narrating
// the whole chapter.
export async function concatM4a(parts: string[], outPath: string): Promise<void> {
  if (parts.length === 0) throw new Error('concatM4a: no parts')
  const work = await mkdtemp(path.join(tmpdir(), 'loom-concat-'))
  const list = path.join(work, 'list.txt')
  try {
    // concat demuxer entries: file '<path>' with single quotes escaped.
    const body = parts.map(p => `file '${p.replace(/'/g, "'\\''")}'`).join('\n')
    await writeFile(list, body, 'utf-8')
    await run(
      'ffmpeg',
      ['-y', '-f', 'concat', '-safe', '0', '-i', list, '-c', 'copy', '-movflags', '+faststart', outPath],
      FFMPEG_TIMEOUT_MS,
    )
  } finally {
    await rm(work, { recursive: true, force: true }).catch(() => {})
  }
}

export async function synthesize(text: string, voice: string): Promise<SynthResult> {
  if (!existsSync(NARRATE_BIN)) {
    throw new NarrateUnavailableError(
      'narrate helper not built — run `node scripts/ensure-narrate.mjs` (needs the Swift toolchain).',
    )
  }
  let lastErr: unknown
  for (let attempt = 1; attempt <= MAX_TRIES; attempt++) {
    const work = await mkdtemp(path.join(tmpdir(), 'loom-narrate-'))
    const txt = path.join(work, 'in.txt')
    const caf = path.join(work, 'out.caf')
    const json = path.join(work, 'out.json')
    const m4a = path.join(work, 'out.m4a')
    try {
      await writeFile(txt, text, 'utf-8')
      await run(NARRATE_BIN, [voice, txt, caf, json], HANG_TIMEOUT_MS)
      const parsed = JSON.parse(await readFile(json, 'utf-8')) as {
        sampleRate: number; frames: number; words: WordTiming[]
      }
      // A watchdog-killed or silent run yields no words/frames — reject so the
      // loop retries rather than persisting a broken track.
      if (!parsed.words?.length || !parsed.frames) throw new Error('empty synthesis output')
      await run('ffmpeg', ['-y', '-i', caf, '-c:a', 'aac', '-b:a', '64k', '-ac', '1', m4a], FFMPEG_TIMEOUT_MS)
      const audio = await readFile(m4a)
      const durationMs = Math.round((parsed.frames / parsed.sampleRate) * 1000)
      return { audio, timing: parsed.words, durationMs, sampleRate: parsed.sampleRate }
    } catch (err) {
      // A missing ffmpeg is not retryable — surface it immediately.
      if ((err as NodeJS.ErrnoException).code === 'ENOENT') throw err
      lastErr = err
    } finally {
      await rm(work, { recursive: true, force: true }).catch(() => {})
    }
  }
  throw lastErr instanceof Error ? lastErr : new Error('synthesis failed')
}
