import cron, { type ScheduledTask } from 'node-cron'
import { prisma } from '@/lib/prisma'
import { findMissingCanonNarration } from './canonBackfill'
import { ensureFresh, regenerateStaleChapter } from './generate'

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

  await canonSweep()
}

/**
 * The second half, and the one that stops chapters publishing silent.
 *
 * The sweep above warms the DEFAULT (pre-choice) variant of every chapter —
 * right for read mode, and exactly the wrong thing for publishing. Publish
 * matches a recording against the CANON path's state and answered choices, so
 * any chapter reached through a choice has a different variant hash. The
 * nightly job was therefore recording one variant while publish looked for
 * another, night after night, and the author kept finding silent chapters with
 * no indication why.
 *
 * Runs after the pre-warm so read mode stays the priority, and only over
 * PUBLISHED books — a draft has no readers to be silent for.
 */
async function canonSweep() {
  const series = await prisma.series.findMany({ select: { id: true, title: true } })
  for (const s of series) {
    let missing
    try {
      missing = await findMissingCanonNarration(s.id)
    } catch (err) {
      console.error(`[narration] canon scan failed for ${s.title}:`, err instanceof Error ? err.message : err)
      continue
    }
    if (missing.length === 0) continue

    console.log(`[narration] ${missing.length} canon chapter(s) without audio in ${s.title} — generating`)
    let made = 0
    for (const m of missing) {
      try {
        // The canon state and answers, so the variant that appears is the one
        // publish will look for.
        await ensureFresh(m.chapterId, m.state, m.answered)
        made++
      } catch (err) {
        console.error(`[narration] canon regen failed for ${m.bookTitle} ${m.label}:`, err instanceof Error ? err.message : err)
      }
    }
    console.log(`[narration] canon sweep done for ${s.title} — ${made}/${missing.length} started`)
  }
}

export function scheduleNarration() {
  if (task) return
  task = cron.schedule(NIGHTLY_CRON, () => {
    console.log('[narration] running nightly narration sweep…')
    void sweep()
  })
  console.log(`[narration] nightly sweep scheduled (cron: ${NIGHTLY_CRON})`)
}
