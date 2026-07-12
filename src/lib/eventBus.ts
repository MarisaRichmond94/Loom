import { appendFile, mkdir, readFile } from 'fs/promises'
import path from 'path'

// Append-only event outbox for external consumers (WriteAI's sync, and any
// future subscriber). Events are hints, not truth — a consumer that misses
// events reconciles against the canon-export manifest — so the outbox
// deliberately lives in its own JSONL file rather than the prose database:
// nothing here can ever contend with, migrate, or corrupt the writing.
//
// Consumers pull with GET /api/events?since=<seq>; seq is monotonic and
// gapless within a file, so a stored cursor survives app restarts.

export type LoomEventType =
  | 'chapter.created'
  | 'chapter.deleted'
  | 'book.renamed'
  | 'export.completed'

export type LoomEvent = {
  seq: number
  type: LoomEventType
  at: string
  payload: Record<string, unknown>
}

const EVENTS_PATH = path.join(process.cwd(), 'data', 'events', 'events.jsonl')

// Module state survives dev-HMR via globalThis; the append lock serialises
// writers within this (single) server process so seq stays gapless.
const g = globalThis as typeof globalThis & {
  __loomEventSeq?: number
  __loomEventLock?: Promise<void>
}

async function lastSeqOnDisk(): Promise<number> {
  try {
    const text = await readFile(EVENTS_PATH, 'utf-8')
    const lines = text.trimEnd().split('\n')
    for (let i = lines.length - 1; i >= 0; i--) {
      if (!lines[i]) continue
      try {
        return (JSON.parse(lines[i]) as LoomEvent).seq
      } catch {
        continue // torn tail line (crash mid-append) — take the one before it
      }
    }
    return 0
  } catch {
    return 0 // no outbox yet
  }
}

export async function publishEvent(
  type: LoomEventType,
  payload: Record<string, unknown>,
): Promise<LoomEvent> {
  const prev = g.__loomEventLock ?? Promise.resolve()
  let event!: LoomEvent
  const next = prev.catch(() => {}).then(async () => {
    if (g.__loomEventSeq === undefined) {
      await mkdir(path.dirname(EVENTS_PATH), { recursive: true })
      g.__loomEventSeq = await lastSeqOnDisk()
    }
    event = { seq: ++g.__loomEventSeq, type, at: new Date().toISOString(), payload }
    await appendFile(EVENTS_PATH, JSON.stringify(event) + '\n', 'utf-8')
  })
  g.__loomEventLock = next
  await next
  return event
}

export async function readEvents(sinceSeq: number, limit = 500): Promise<LoomEvent[]> {
  let text: string
  try {
    text = await readFile(EVENTS_PATH, 'utf-8')
  } catch {
    return []
  }
  const out: LoomEvent[] = []
  for (const line of text.split('\n')) {
    if (!line) continue
    try {
      const event = JSON.parse(line) as LoomEvent
      if (event.seq > sinceSeq) out.push(event)
      if (out.length >= limit) break
    } catch {
      continue // torn tail line
    }
  }
  return out
}
