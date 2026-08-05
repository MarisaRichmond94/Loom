'use client'

import { useEffect, useMemo, useState } from 'react'
import { LuUser } from 'react-icons/lu'
import { writerPortraitUrl } from '@/lib/writerPortrait'
import type { SeriesWriterCharacter } from '@/lib/writerCharacterSeries'
import { getCachedSeriesCharacters, prefetchSeriesCharacters } from './seriesCharactersCache'

// The series page's Characters tab — LOOM-105, over LOOM-104's route.
//
// Deliberately PLAIN: portrait, name, category, and which books the character
// appears in. It is a roster and a jumping-off point, not a second editor.
//
// Per-book editing stays on the book page, where it means something — an age
// override, a per-book portrait and a hidden flag are all answers to "in THIS
// book", and a series-level card has no book to answer for. LOOM-104 found
// that `starred` and the first/death/last range ARE well defined per series
// (WriterCharacterMeta is keyed by series, not book), so they could be shown
// here later; they are left out for now because the question this tab answers
// is "who is in this series", and nothing else earns the space until asked for.

/** No book at series scope, so the portrait chain is canonical file → WriteAI's
 *  own photo. writerPortraitUrl handles the null bookId by skipping the
 *  per-book rung. */
function portraitFor(character: SeriesWriterCharacter): string | null {
  return writerPortraitUrl(
    {
      id: character.id,
      hasBookAvatar: false,
      hasCanonicalAvatar: character.hasCanonicalAvatar,
      writerPhotoUrl: character.writerPhotoUrl,
    },
    null,
  )
}

function CharacterCard({ character }: { character: SeriesWriterCharacter }) {
  const url = portraitFor(character)
  // "B1, B3" — reading order, from LOOM-104's tag-derived appearances. Empty is
  // a real answer: WriteAI knows them, but no chapter references them yet.
  const books = character.appearsIn.map(a => `B${a.bookOrder}`).join(', ')

  return (
    <div
      title={
        character.appearsIn.length > 0
          ? `Appears in ${character.appearsIn.map(a => a.bookTitle).join(', ')}`
          : 'Not referenced in any chapter yet'
      }
      className="flex h-[146px] w-full flex-col items-center gap-2 rounded-xl border border-accent/10 bg-surface-raised p-3"
    >
      <div className="flex h-20 w-20 shrink-0 items-center justify-center overflow-hidden rounded-full border-2 border-accent/20 bg-surface-overlay">
        {url ? (
          <img src={url} alt={character.name} className="h-full w-full object-cover" />
        ) : (
          <LuUser size={32} className="text-ink-faint" />
        )}
      </div>
      <div className="w-full text-center">
        <p className="truncate text-xs font-medium text-ink">{character.name}</p>
        <p className="truncate text-[10px] uppercase tracking-widest text-ink-faint">
          {books || '—'}
        </p>
      </div>
    </div>
  )
}

export default function SeriesCharactersSection({ seriesId }: { seriesId: string }) {
  // Lazy initializers, not `useState(null)` + effect: if the page's idle
  // prefetch already landed by the time this tab mounts (the common case),
  // this renders WITH the real roster on the very first paint — no empty
  // stage, no resize once the effect below catches up.
  const [characters, setCharacters] = useState<SeriesWriterCharacter[] | null>(
    () => getCachedSeriesCharacters(seriesId) ?? null,
  )
  const [failed, setFailed] = useState(() => getCachedSeriesCharacters(seriesId) === null)

  useEffect(() => {
    let cancelled = false
    prefetchSeriesCharacters(seriesId).then(data => {
      if (cancelled) return
      if (data) setCharacters(data)
      else setFailed(true)
    })
    return () => {
      cancelled = true
    }
  }, [seriesId])

  // Grouped by category, which is how the pool is already sorted server-side
  // (byCategoryThenName) — so this only inserts headings, it does not reorder.
  const groups = useMemo(() => {
    if (!characters) return []
    const out: { label: string; members: SeriesWriterCharacter[] }[] = []
    for (const character of characters) {
      const label = character.category?.trim() || 'Uncategorised'
      const last = out.at(-1)
      if (last?.label === label) last.members.push(character)
      else out.push({ label, members: [character] })
    }
    return out
  }, [characters])

  if (failed) {
    return (
      <div
        className="flex items-center justify-center rounded-xl border-2 border-dashed border-accent/20"
        style={{ minHeight: 300 }}
      >
        <p className="px-8 text-center text-sm italic text-ink-faint">
          Couldn’t load the cast.
        </p>
      </div>
    )
  }

  if (!characters) {
    return (
      <div
        className="grid animate-pulse gap-2"
        style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(112px, 1fr))', minHeight: 300 }}
      >
        {[...Array(12)].map((_, i) => (
          <div key={i} className="h-[146px] rounded-xl border border-accent/10 bg-surface-raised" />
        ))}
      </div>
    )
  }

  if (characters.length === 0) {
    return (
      <div
        className="flex items-center justify-center rounded-xl border-2 border-dashed border-accent/20"
        style={{ minHeight: 300 }}
      >
        <p className="px-8 text-center text-sm italic text-ink-faint">
          No characters yet. They’re created in WriteAI, or on a book page.
        </p>
      </div>
    )
  }

  return (
    <div className="flex flex-col gap-6" style={{ minHeight: 300 }}>
      {groups.map(group => (
        <div key={group.label}>
          <p className="mb-2 text-xs uppercase tracking-widest text-ink-faint">
            {group.label} ({group.members.length})
          </p>
          <div
            className="grid gap-2"
            style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(112px, 1fr))' }}
          >
            {group.members.map(c => (
              <CharacterCard key={c.id} character={c} />
            ))}
          </div>
        </div>
      ))}
    </div>
  )
}
