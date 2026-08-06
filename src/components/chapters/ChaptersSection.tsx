'use client'

import { useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import { LuExternalLink, LuGitBranch, LuSearch, LuX } from 'react-icons/lu'
import { useBookChapterTags } from './useBookChapterTags'
import { useTimelineData } from '@/components/timeline/useTimelineData'
import { prefetchBookOutline } from '@/components/editor/outlineCache'
import { htmlToParagraphs } from '@/lib/outlineCards'
import { matchGaps, type BookChapterRow } from '@/lib/bookChapterTags'
import type { OutlineCard } from '@/lib/writerOutline'

// The book page's Chapters tab (LOOM-120/121).
//
// "I want to add a chapter with Chase, but I need to see every chapter Chase is
// already in" — and, crucially, the SPACING between those chapters. That is why
// this is a sequence and not a list: non-matching chapters stay in place,
// collapsed, so a nine-chapter absence is visible as nine chapters rather than
// inferred from two numbers that happen to be far apart.
//
// ⚠️ Why this is not the Outline tab, recorded here because it looks like it
// should be: the outline is WriteAI's store and holds canon only. Branch-gated
// chapters ("Bonus Chapter 1") never reach the canon manifest, so they never get
// an outline card — 343 Loom chapters, 334 cards when this shipped, the 9
// missing being exactly the bonus chapters. Worse, a card added for one is
// PRUNED by WriteAI's `_auto_reconcile`, which drops any card whose `loom_id` is
// absent from the manifest. So the sequence comes from Loom and the summaries
// are joined ON to it, read-only, one direction only. Nothing here writes.

type Mode = 'characters' | 'events'

/** Summaries keyed by Loom chapter id, joined from the outline read-only. */
type SummaryMap = Record<string, { text: string; source: 'writer' | 'machine' }>

function buildSummaries(cards: OutlineCard[]): SummaryMap {
  const out: SummaryMap = {}
  for (const card of cards) {
    if (!card.loom_id) continue
    // `writer_summary` is HTML on every card in the live store. Rendered as
    // TEXT, never injected — this view is read-only and dangerouslySetInnerHTML
    // on a string from another process buys nothing here.
    const paragraphs = htmlToParagraphs(card.writer_summary)
    const text = paragraphs.join(' ')
    if (text) {
      // `summary_source` records what the machine last wrote. A writer_summary
      // that still matches it is machine text; anything else the writer touched.
      const machine = (card.summary_source ?? '').trim().length > 0
        && htmlToParagraphs(card.summary_source).join(' ') === text
      out[card.loom_id] = { text, source: machine ? 'machine' : 'writer' }
      continue
    }
    const bullets = (card.extracted_bullets ?? []).filter(Boolean)
    if (bullets.length) out[card.loom_id] = { text: bullets.join(' • '), source: 'machine' }
  }
  return out
}

function Chip({
  label,
  active,
  onClick,
}: {
  label: string
  active: boolean
  onClick: () => void
}) {
  return (
    <button
      onClick={onClick}
      className={`flex items-center gap-1 rounded-full px-2.5 py-1 text-[11px] font-medium transition ${
        active
          ? 'bg-accent text-white'
          : 'bg-surface-raised text-ink-faint hover:text-ink border border-accent/10'
      }`}
    >
      {label}
      {active && <LuX size={11} />}
    </button>
  )
}

/** The run of non-matching chapters between two matches, as a readable rule. */
function Gap({ count }: { count: number }) {
  if (count === 0) return null
  return (
    <div className="col-span-full flex items-center gap-3 py-1">
      <div className="h-px flex-1 bg-accent/10" />
      <span className="text-[10px] italic text-ink-faint">
        {count} chapter{count === 1 ? '' : 's'} without
      </span>
      <div className="h-px flex-1 bg-accent/10" />
    </div>
  )
}

function ChapterCard({
  row,
  summary,
  seriesId,
  matched,
  filtering,
}: {
  row: BookChapterRow
  summary: SummaryMap[string] | undefined
  seriesId: string
  matched: boolean
  filtering: boolean
}) {
  // Dimmed rather than hidden while filtering — the gap IS the answer. A
  // collapsed card still occupies the sequence, so the eye can count it.
  const dim = filtering && !matched
  if (dim) {
    return (
      <div
        title={row.title}
        className="flex h-9 items-center gap-2 overflow-hidden rounded border border-accent/5 bg-surface-raised/40 px-2.5 opacity-50"
      >
        <span className="truncate text-[10px] text-ink-faint">{row.title}</span>
      </div>
    )
  }

  return (
    <div
      className={`group relative flex min-h-[150px] flex-col overflow-hidden rounded-lg border bg-surface-raised px-3.5 py-3 transition-colors ${
        row.offCanon
          ? 'border-dashed border-amber-500/40 hover:border-amber-500/60'
          : 'border-accent/10 hover:border-accent/25'
      } ${matched && filtering ? 'ring-1 ring-accent/40' : ''}`}
    >
      <div className="flex items-start justify-between gap-2">
        <div className="flex min-w-0 flex-col">
          {/* The AUTHORED title, verbatim — the same string the left-hand
              sidebar shows. A branch chapter reads "Bonus Chapter 1", which no
              canon numbering would ever produce for it. */}
          <span className="truncate text-xs font-medium text-ink">{row.title}</span>
          {row.offCanon && (
            <span className="mt-1 flex items-center gap-1 text-[10px] text-amber-400">
              <LuGitBranch size={10} /> Branch only
            </span>
          )}
        </div>
        <Link
          href={`/author/${seriesId}/chapter/${row.chapterId}`}
          title="Open this chapter"
          aria-label={`Open ${row.title}`}
          className="shrink-0 rounded p-0.5 text-ink-faint opacity-0 transition hover:text-accent focus-visible:opacity-100 group-hover:opacity-100"
        >
          <LuExternalLink size={12} />
        </Link>
      </div>

      <p className="mt-2 min-h-0 flex-1 overflow-hidden text-[11px] leading-relaxed text-ink-faint">
        {summary?.text ?? (
          <span className="italic">
            {row.offCanon
              ? 'No summary — branch chapters have no outline card. Add one in the chapter’s notes.'
              : 'No summary yet.'}
          </span>
        )}
      </p>
    </div>
  )
}

export default function ChaptersSection({ seriesId, bookId }: { seriesId: string; bookId: string }) {
  const { chapters, loading, failed, refresh } = useBookChapterTags(seriesId, bookId)
  // Shared with the Timeline tab through its cache, so opening this tab costs
  // no extra WriteAI request when Timeline has already been opened (and warms
  // it when it has not).
  const { events, characterPool, unreachable } = useTimelineData()

  const [mode, setMode] = useState<Mode>('characters')
  const [selected, setSelected] = useState<string | null>(null)
  const [query, setQuery] = useState('')

  // Summaries, joined read-only from the outline the Outline tab already
  // fetched. Through the shared cache, so this does not add a second
  // seed-and-save GET on WriteAI's side.
  const [summaries, setSummaries] = useState<SummaryMap>({})
  useEffect(() => {
    let live = true
    void prefetchBookOutline(seriesId, bookId).then(({ outline }) => {
      if (live) setSummaries(outline ? buildSummaries(outline.cards) : {})
    })
    return () => {
      live = false
    }
  }, [seriesId, bookId])

  // Switching what you filter BY must clear what you filtered TO — a character
  // id left selected in event mode matches nothing and reads as "no results".
  useEffect(() => setSelected(null), [mode])

  // Only entities actually tagged somewhere in this book. Offering the full
  // cast would fill the picker with names whose every chip returns nothing.
  const options = useMemo(() => {
    const tagged = new Set(
      chapters.flatMap(c => (mode === 'characters' ? c.characters : c.events)).map(e => e.id),
    )
    const named =
      mode === 'characters'
        ? characterPool.map(c => ({ id: c.id, name: c.name }))
        : events.map(e => ({ id: e.id, name: e.title }))
    return named
      .filter(o => tagged.has(o.id))
      .filter(o => o.name.toLowerCase().includes(query.trim().toLowerCase()))
      .sort((a, b) => a.name.localeCompare(b.name))
  }, [chapters, characterPool, events, mode, query])

  const filtering = selected !== null
  const matches = useMemo(
    () => (row: BookChapterRow) =>
      selected === null
        ? true
        : (mode === 'characters' ? row.characters : row.events).some(e => e.id === selected),
    [selected, mode],
  )

  const gaps = useMemo(
    () => (filtering ? matchGaps(chapters, matches) : []),
    [chapters, matches, filtering],
  )
  const matchCount = gaps.length

  if (loading && chapters.length === 0) {
    return (
      <div className="grid animate-pulse gap-3" style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(220px, 1fr))' }}>
        {Array.from({ length: 8 }).map((_, i) => (
          <div key={i} className="h-[150px] rounded-lg border border-accent/10 bg-surface-raised/50" />
        ))}
      </div>
    )
  }

  if (failed) {
    return (
      <div className="flex flex-col items-center justify-center gap-2 rounded-xl border-2 border-dashed border-accent/20 px-8 py-10 text-center">
        <p className="text-sm italic text-ink-faint">This book’s chapters couldn’t be loaded.</p>
        <button onClick={() => void refresh()} className="text-xs text-accent underline underline-offset-2">
          Try again
        </button>
      </div>
    )
  }

  if (chapters.length === 0) {
    return (
      <div className="flex items-center justify-center rounded-xl border-2 border-dashed border-accent/20 px-8 py-10">
        <p className="px-8 text-center text-sm italic text-ink-faint">
          No chapters in this book yet.
        </p>
      </div>
    )
  }

  // Index of each match, so a gap rule can be placed before the right card.
  const matchIndexByChapterId = new Map<string, number>()
  if (filtering) {
    let i = 0
    for (const row of chapters) if (matches(row)) matchIndexByChapterId.set(row.chapterId, i++)
  }

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center gap-2">
        <div className="flex rounded-md border border-accent/10 p-0.5">
          {(['characters', 'events'] as const).map(m => (
            <button
              key={m}
              onClick={() => setMode(m)}
              className={`rounded px-2.5 py-1 text-[11px] font-medium capitalize transition ${
                mode === m ? 'bg-accent text-white' : 'text-ink-faint hover:text-ink'
              }`}
            >
              {m}
            </button>
          ))}
        </div>

        <div className="relative flex items-center">
          <LuSearch size={12} className="absolute left-2 text-ink-faint" />
          <input
            value={query}
            onChange={e => setQuery(e.target.value)}
            placeholder={mode === 'characters' ? 'Find a character…' : 'Find an event…'}
            className="w-44 rounded border border-accent/10 bg-surface-raised py-1 pl-7 pr-2 text-[11px] text-ink outline-none focus:border-accent/30"
          />
        </div>

        {filtering && (
          <span className="text-[11px] text-ink-faint">
            {matchCount} of {chapters.length} chapters
          </span>
        )}
      </div>

      {unreachable && (
        <p className="text-[10px] italic text-ink-faint">
          WriteAI isn’t reachable, so names and summaries are unavailable. The chapter sequence below
          is Loom’s and is complete.
        </p>
      )}

      <div className="flex flex-wrap gap-1.5">
        {options.length === 0 ? (
          <span className="text-[11px] italic text-ink-faint">
            {mode === 'characters'
              ? 'No characters tagged in this book yet. Tag them from a chapter’s Characters tab.'
              : 'No events tagged in this book yet. Tag them from a chapter’s Events tab.'}
          </span>
        ) : (
          options.map(o => (
            <Chip
              key={o.id}
              label={o.name}
              active={selected === o.id}
              onClick={() => setSelected(selected === o.id ? null : o.id)}
            />
          ))
        )}
      </div>

      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fill, minmax(220px, 1fr))',
          gap: 12,
          alignItems: 'start',
        }}
      >
        {chapters.map(row => {
          const matched = matches(row)
          const idx = matchIndexByChapterId.get(row.chapterId)
          return (
            <div key={row.chapterId} className="contents">
              {/* The run before this match, drawn across the full row so it
                  reads as a gap in the sequence rather than a card. */}
              {filtering && matched && idx !== undefined && <Gap count={gaps[idx]} />}
              <ChapterCard
                row={row}
                summary={summaries[row.chapterId]}
                seriesId={seriesId}
                matched={matched}
                filtering={filtering}
              />
            </div>
          )
        })}
      </div>
    </div>
  )
}
