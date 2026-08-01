import { readFile, writeFile, mkdir } from 'fs/promises'
import path from 'path'

// Remembers where the writer last worked — one entry per series, stamped
// whenever a chapter editor is opened. Powers "pick up where I left off"
// landings (e.g. the WriteAI → Loom jump goes straight to this chapter).
// Same one-JSON-blob-under-data/ pattern as the other author-side settings.

export type LastTouched = { chapterId: string; at: string }
type AuthorState = { lastTouched: Record<string, LastTouched>; lastActiveSeriesId: string | null }

const STATE_PATH = path.join(process.cwd(), 'data', 'author-state.json')

async function readState(): Promise<AuthorState> {
  try {
    const raw = JSON.parse(await readFile(STATE_PATH, 'utf-8'))
    return { lastTouched: raw.lastTouched ?? {}, lastActiveSeriesId: raw.lastActiveSeriesId ?? null }
  } catch {
    return { lastTouched: {}, lastActiveSeriesId: null }
  }
}

async function writeState(state: AuthorState): Promise<void> {
  await mkdir(path.dirname(STATE_PATH), { recursive: true })
  await writeFile(STATE_PATH, JSON.stringify(state, null, 2), 'utf-8')
}

export async function getLastTouchedChapter(seriesId: string): Promise<LastTouched | null> {
  return (await readState()).lastTouched[seriesId] ?? null
}

// Stamped alongside the per-series last-touched chapter so a bare /author
// visit (no seriesId in the URL yet) knows which series to resume (LOOM-57).
export async function getLastActiveSeries(): Promise<string | null> {
  return (await readState()).lastActiveSeriesId
}

export async function recordLastTouchedChapter(seriesId: string, chapterId: string): Promise<void> {
  const state = await readState()
  state.lastTouched[seriesId] = { chapterId, at: new Date().toISOString() }
  state.lastActiveSeriesId = seriesId
  await writeState(state)
}
