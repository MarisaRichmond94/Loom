import { readFile, writeFile, mkdir } from 'fs/promises'
import path from 'path'

// Remembers where the writer last worked — one entry per series, stamped
// whenever a chapter editor is opened. Powers "pick up where I left off"
// landings (e.g. the WriteAI → Loom jump goes straight to this chapter).
// Same one-JSON-blob-under-data/ pattern as the other author-side settings.

export type LastTouched = { chapterId: string; at: string }
type AuthorState = { lastTouched: Record<string, LastTouched> }

const STATE_PATH = path.join(process.cwd(), 'data', 'author-state.json')

async function readState(): Promise<AuthorState> {
  try {
    const raw = JSON.parse(await readFile(STATE_PATH, 'utf-8'))
    return { lastTouched: raw.lastTouched ?? {} }
  } catch {
    return { lastTouched: {} }
  }
}

export async function getLastTouchedChapter(seriesId: string): Promise<LastTouched | null> {
  return (await readState()).lastTouched[seriesId] ?? null
}

export async function recordLastTouchedChapter(seriesId: string, chapterId: string): Promise<void> {
  const state = await readState()
  state.lastTouched[seriesId] = { chapterId, at: new Date().toISOString() }
  await mkdir(path.dirname(STATE_PATH), { recursive: true })
  await writeFile(STATE_PATH, JSON.stringify(state, null, 2), 'utf-8')
}
