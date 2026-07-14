import cron, { type ScheduledTask } from 'node-cron'
import { prisma } from '@/lib/prisma'
import { regenerateStaleChapter } from './generate'

// Nightly pre-warm: keep chapter narration in sync with prose so opening a
// chapter in read mode is instant most of the time. Runs after the writing day
// (03:00), scanning every chapter and regenerating only those whose spoken text
// changed since it was last narrated — the same hash-skip logic the Preview
// trigger uses, so the two never fight (they share generate.ts's in-flight map).
const NIGHTLY_CRON = '0 3 * * *'

let task: ScheduledTask | null = null

// Serialized on purpose: synthesis is CPU-heavy, so we regenerate one chapter
// at a time rather than saturating the machine overnight.
async function sweep() {
  const chapters = await prisma.chapter.findMany({ select: { id: true } })
  let regenerated = 0
  for (const { id } of chapters) {
    try {
      if (await regenerateStaleChapter(id)) regenerated++
    } catch (err) {
      console.error(`[narration] nightly regen failed for ${id}:`, err instanceof Error ? err.message : err)
    }
  }
  console.log(`[narration] nightly sweep done — ${regenerated}/${chapters.length} chapter(s) regenerated`)
}

export function scheduleNarration() {
  if (task) return
  task = cron.schedule(NIGHTLY_CRON, () => {
    console.log('[narration] running nightly narration sweep…')
    void sweep()
  })
  console.log(`[narration] nightly sweep scheduled (cron: ${NIGHTLY_CRON})`)
}
