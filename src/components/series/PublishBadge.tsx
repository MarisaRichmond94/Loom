'use client'

import { LuCheck } from 'react-icons/lu'
import type { BookPublishStatus } from '@/components/series/usePublishStatus'

/**
 * "What can my family see of this book?" — top-right of a book card.
 *
 * Every book gets one, including drafts: "nothing has been sent" is a state
 * worth stating, and a card with no badge is ambiguous between "nothing to
 * report" and "not loaded yet".
 *
 * The label carries the STATE; dates live in the tooltip. An earlier version
 * put the date in the label and produced "Readers have today's version" for a
 * book that was out of date — technically what happened, and exactly backwards
 * as a signal.
 *
 * Colour is the urgency, and it is deliberate:
 *   neutral — intentional; nothing to do
 *   amber   — you can act on this right now
 *   green   — done
 */

const chip = 'shrink-0 text-[10px] uppercase tracking-widest rounded px-1.5 py-0.5'
const neutral = `${chip} text-ink-faint border border-accent/20`
const amber = `${chip} text-choice-amber border border-choice-amber-border bg-choice-amber-bg`
const green = `${chip} text-choice-spare border border-choice-spare-border bg-choice-spare-bg flex items-center gap-1`

const stamp = (iso: string | null) => {
  if (!iso) return null
  const d = new Date(iso)
  return Number.isNaN(d.getTime()) ? null : d.toLocaleString()
}

export default function PublishBadge({ status }: { status: BookPublishStatus | null }) {
  if (!status) return null
  const at = stamp(status.publishedAt)

  // A draft. Readers do get a card for it — title and position only — so the
  // honest description is what they actually see, not "nothing".
  if (!status.eligible) {
    return (
      <span
        title="Draft. Readers see the title as “Coming Soon” — no chapters, synopsis or cover leave Loom."
        className={neutral}
      >
        Coming soon to readers
      </span>
    )
  }

  if (!status.inSnapshot) {
    return (
      <span
        title="Marked Published, but nothing has been sent yet — readers still see it as “Coming Soon”. Publish it to send the content."
        className={amber}
      >
        Never sent to readers
      </span>
    )
  }

  if (status.changed) {
    return (
      <span
        title={at
          ? `Changed since you last published it. Readers are still on the version from ${at}.`
          : 'Changed since you last published it. Readers are still on the older version.'}
        className={amber}
      >
        Unpublished changes
      </span>
    )
  }

  return (
    <span
      title={at
        ? `Readers have exactly what is in Loom right now. Published ${at}.`
        : 'Readers have exactly what is in Loom right now.'}
      className={green}
    >
      <LuCheck size={9} /> Readers are current
    </span>
  )
}
