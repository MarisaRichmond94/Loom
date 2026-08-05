'use client'

import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { LuCalendarDays, LuMapPin, LuPlus, LuSearch, LuX } from 'react-icons/lu'
import { useSectionActionSlot } from '@/components/SectionTabs'
import { PanelEmptyState } from '@/components/editor/PanelEmptyState'
import EventModal, { type ChapterChoice } from '@/components/editor/EventModal'
import { TimelineChart, TimelineChartSkeleton } from './TimelineChart'
import { useTimelineData } from './useTimelineData'
import { formatEventWhen, matchesQuery, sortEvents, type WriterEvent } from '@/lib/eventSearch'
import type { BookEventAppearance } from '@/lib/chapterEvents'

// The timeline, shared by the book page and the series page (LOOM-102).
//
// One component for both so the two tabs are identical by construction rather
// than by discipline — the book page's is the same view over a filtered set.
//
// A port of WriteAI's WriterTimelinePane against a shared spec, with two
// deliberate departures, both recorded on the ticket:
//
//   1. A MODAL, not a drawer. WriteAI shows a slide-up drawer in list view and
//      a persistent bottom panel in chart view — two presentations of one form,
//      plus a "select an event" empty state the chart layout needs. Loom
//      already has EventModal and it already knows the create/edit/delete
//      contract. The cost, worth naming: the chart no longer shows a card and
//      its details at once.
//   2. LOOM TOKENS, WriteAI geometry. See TimelineChart for why.
//
// Sorting uses sortEvents, NOT WriteAI's inline comparator. Theirs hands
// "Saturday, January 2nd, 1943" to `new Date()`, which drags a timezone into a
// value that has none and parses implementation-defined. Loom's parses by hand.

type TimelineSectionProps = {
  /** Namespace for the persisted view choice, so two pages using this do not
   *  fight over one key. */
  id: string
  /** Restrict to these event ids — the book page's prefilter. Null or absent
   *  means every event, which is the series page. */
  eventIds?: Set<string> | null
  /** Which chapters reference each event, keyed by event id. Absent at series
   *  scope, where "which chapters" spans the whole series and is not what the
   *  card is for. */
  appearances?: Record<string, BookEventAppearance[]>
  /** Shown when the filtered set is empty but events do exist. */
  emptyTitle?: string
  emptyBody?: ReactNode
  /** Chapters a newly created event can be tagged to (LOOM-103). Offered only
   *  where this section is FILTERED by tag — otherwise a new event is created
   *  and immediately vanishes from the view that created it. The series
   *  timeline is unfiltered and passes nothing. */
  chapterChoices?: ChapterChoice[]
  /** Called after a create, with the chapter the picker chose (if any), so the
   *  page can tag it and re-fetch whatever decides membership of `eventIds`. */
  onEventCreated?: (event: WriterEvent, chapterId?: string) => void | Promise<void>
}

function ChapterLine({ appearances }: { appearances: BookEventAppearance[] }) {
  if (appearances.length === 0) return null
  // Numbers where there are numbers, titles where there are not — an
  // unnumbered chapter has no canon address but is still a real appearance,
  // and dropping it would under-report the spread.
  const shown = appearances.slice(0, 3)
  const label = shown
    .map(a => (a.chapterNumber === null ? a.chapterTitle : `Ch. ${a.chapterNumber}`))
    .join(', ')
  const rest = appearances.length - shown.length
  return (
    <span className="text-[10px] text-ink-faint">
      {label}
      {rest > 0 && ` +${rest}`}
    </span>
  )
}

function EventListCard({
  event,
  selected,
  onSelect,
  nameOf,
  appearances,
}: {
  event: WriterEvent
  selected: boolean
  onSelect: () => void
  nameOf: (id: string) => string
  appearances: BookEventAppearance[]
}) {
  const when = formatEventWhen(event)
  return (
    <button
      type="button"
      onClick={onSelect}
      className={`flex w-full items-center gap-3 rounded-lg border px-4 py-3 text-left transition ${
        selected
          ? 'border-accent bg-accent/5'
          : 'border-accent/10 bg-surface-overlay/40 hover:border-accent/60'
      }`}
    >
      <div className="min-w-0 flex-1">
        <p className="truncate text-[13px] font-semibold text-ink">
          {event.title || <span className="italic text-ink-faint">Untitled event</span>}
        </p>
        {event.characters.length > 0 && (
          <p className="truncate text-[11px] text-ink-muted">
            {event.characters.map(nameOf).join(', ')}
          </p>
        )}
      </div>

      <div className="shrink-0 space-y-0.5 text-right">
        {event.location && (
          <p className="flex items-center justify-end gap-1 text-[10px] text-ink-faint">
            <LuMapPin size={11} /> {event.location}
          </p>
        )}
        {when && <p className="text-[10px] text-ink-faint">{when}</p>}
        <ChapterLine appearances={appearances} />
      </div>
    </button>
  )
}

export default function TimelineSection({
  id,
  eventIds = null,
  appearances = {},
  emptyTitle,
  emptyBody,
  chapterChoices,
  onEventCreated,
}: TimelineSectionProps) {
  const { events, locations, characterPool, characterPhotos, loading, unreachable, refresh } =
    useTimelineData()
  const actionSlot = useSectionActionSlot()

  const [view, setView] = useState<'list' | 'chart'>('list')
  const [query, setQuery] = useState('')
  // null = closed; { event: undefined } = creating.
  const [editorFor, setEditorFor] = useState<{ event?: WriterEvent } | null>(null)

  // Read in an effect rather than during render: the server has no
  // localStorage, and seeding state from it directly is a hydration mismatch.
  // Same habit as SectionTabs and the dock's tab width.
  useEffect(() => {
    try {
      const saved = localStorage.getItem(`loom-timeline-view-${id}`)
      if (saved === 'list' || saved === 'chart') setView(saved)
    } catch {
      /* private mode, or storage disabled — list wins */
    }
  }, [id])

  function selectView(next: 'list' | 'chart') {
    setView(next)
    try {
      localStorage.setItem(`loom-timeline-view-${id}`, next)
    } catch {
      /* ignore */
    }
  }

  // Cast entries are stored as `wc-` ids (LOOM-45). One resolver for the whole
  // section — rendering AND searching — so a name can never be shown in one
  // place and searched as an id in the other.
  const nameById = useMemo(
    () => new Map(characterPool.map(c => [c.id, c.name])),
    [characterPool],
  )
  const nameOf = useCallback((cid: string) => nameById.get(cid) ?? 'Unknown character', [nameById])

  /** The tab's scope, before search: every event, or just the tagged ones. */
  const inScope = useMemo(
    () => (eventIds ? events.filter(e => eventIds.has(e.id)) : events),
    [events, eventIds],
  )

  // Oldest first, matching WriteAI. Undated events sort last in both
  // directions — an undated event is unplaced, not "the oldest".
  const sorted = useMemo(() => sortEvents(inScope, 'asc'), [inScope])

  // Search is LIST-ONLY, as in WriteAI: the chart reads as a continuous
  // sequence, and filtering it produces a sequence with holes in it.
  const visible = useMemo(() => {
    const q = query.trim()
    if (!q) return sorted
    return sorted.filter(e => matchesQuery(e, q, nameOf))
  }, [sorted, query, nameOf])

  // Prefills the date when creating, so a run of same-day events doesn't mean
  // re-picking the date every time. Derived from `updated_at` rather than
  // in-story order so it survives a reload — it tracks when an event was last
  // touched, not where it falls in the narrative.
  const lastUpdatedDate = useMemo(() => {
    let latest: WriterEvent | null = null
    let latestAt = -Infinity
    for (const event of events) {
      const at = event.updated_at ? Date.parse(event.updated_at) : NaN
      if (!Number.isNaN(at) && at > latestAt) {
        latestAt = at
        latest = event
      }
    }
    return latest?.date ?? null
  }, [events])

  const listBody = () => {
    if (unreachable) {
      return (
        <PanelEmptyState icon={<LuCalendarDays size={26} />} title="WriteAI isn’t running">
          Events live in WriteAI, so the timeline can’t be shown until it’s up. Your chapter tags are
          safe — they’re stored in Loom.{' '}
          <button onClick={() => void refresh()} className="text-accent underline underline-offset-2">
            Try again
          </button>
        </PanelEmptyState>
      )
    }
    // Four different nothings, and conflating them is how a working tab gets
    // read as a broken one.
    if (visible.length === 0) {
      if (query.trim()) {
        return (
          <PanelEmptyState icon={<LuCalendarDays size={26} />} title="No events match">
            Nothing matches “{query.trim()}”. Search runs over event titles and character names.
          </PanelEmptyState>
        )
      }
      if (events.length > 0 && eventIds) {
        return (
          <PanelEmptyState
            icon={<LuCalendarDays size={26} />}
            title={emptyTitle ?? 'No events here yet'}
          >
            {emptyBody ?? 'Tag events to this book’s chapters and they’ll appear here.'}
          </PanelEmptyState>
        )
      }
      return (
        <PanelEmptyState icon={<LuCalendarDays size={26} />} title="No events yet">
          Add your first event to start your timeline.
        </PanelEmptyState>
      )
    }

    return (
      <div className="flex flex-col gap-3">
        {visible.map(event => (
          <EventListCard
            key={event.id}
            event={event}
            selected={editorFor?.event?.id === event.id}
            onSelect={() => setEditorFor({ event })}
            nameOf={nameOf}
            appearances={appearances[event.id] ?? []}
          />
        ))}
      </div>
    )
  }

  return (
    <div className="flex flex-col">
      {/* View controls live in the tab BODY, not the strip's header. They are
          state of the view, not actions on the section — putting them beside
          "Add Event" would make the header mean two different things. */}
      <div className="mb-4 flex items-center gap-2">
        <div className="flex items-center overflow-hidden rounded border border-accent/20">
          {(['list', 'chart'] as const).map(v => (
            <button
              key={v}
              type="button"
              onClick={() => selectView(v)}
              aria-pressed={view === v}
              className={`px-3 py-1 text-[11px] font-medium capitalize transition ${
                view === v
                  ? 'bg-accent/20 text-accent'
                  : 'bg-surface-overlay/40 text-ink-faint hover:text-ink'
              }`}
            >
              {v}
            </button>
          ))}
        </div>

        {/* Kept mounted and faded rather than unmounted in chart view: the row
            would otherwise reflow every time the view is toggled. */}
        <div
          className={`relative transition-opacity duration-200 ${
            view === 'list' ? 'opacity-100' : 'pointer-events-none opacity-0'
          }`}
        >
          <LuSearch
            size={12}
            className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-ink-faint"
          />
          <input
            value={query}
            onChange={e => setQuery(e.target.value)}
            placeholder="Search events…"
            aria-label="Search events"
            aria-hidden={view !== 'list'}
            tabIndex={view === 'list' ? 0 : -1}
            disabled={sorted.length === 0}
            className="w-56 rounded border border-accent/20 bg-surface-overlay/40 py-1 pl-7 pr-6 text-[11px] text-ink outline-none transition placeholder:text-ink-faint focus:border-accent disabled:cursor-not-allowed disabled:opacity-40"
          />
          {query && (
            <button
              type="button"
              onClick={() => setQuery('')}
              aria-label="Clear search"
              className="absolute right-1.5 top-1/2 -translate-y-1/2 text-ink-faint transition hover:text-ink"
            >
              <LuX size={12} />
            </button>
          )}
        </div>
      </div>

      {loading ? (
        view === 'chart' ? (
          <TimelineChartSkeleton />
        ) : (
          <div className="flex animate-pulse flex-col gap-3">
            {[...Array(6)].map((_, i) => (
              <div key={i} className="h-[62px] rounded-lg bg-surface-overlay/40" />
            ))}
          </div>
        )
      ) : view === 'chart' ? (
        sorted.length === 0 ? (
          <div style={{ height: 340 }}>{listBody()}</div>
        ) : (
          <TimelineChart
            events={sorted}
            selectedId={editorFor?.event?.id ?? null}
            onSelect={event => setEditorFor({ event })}
          />
        )
      ) : (
        <div className="min-h-[300px]">{listBody()}</div>
      )}

      {actionSlot &&
        createPortal(
          <button
            type="button"
            onClick={() => setEditorFor({})}
            className="flex items-center gap-1.5 rounded bg-accent px-3 py-1.5 text-xs font-medium text-white transition hover:opacity-90"
          >
            <LuPlus size={12} /> Add Event
          </button>,
          actionSlot,
        )}

      {editorFor && (
        <EventModal
          event={editorFor.event}
          characterPool={characterPool}
          locationPool={locations}
          defaultDate={lastUpdatedDate}
          chapterChoices={chapterChoices}
          // Clicking a card here is how you READ an event — this surface has
          // no expand-in-place the way the dock's list does, so without a view
          // mode the only way to look at one is to open its editor. Creating
          // still goes straight to the form.
          initialMode="view"
          appearances={editorFor.event ? (appearances[editorFor.event.id] ?? []) : []}
          characterPhotos={characterPhotos}
          onSaved={async (saved, chapterId) => {
            // The page tags FIRST, then both sides refresh — otherwise the
            // event list updates while the tagged-id set is still stale, and
            // the new event flickers in and back out of a filtered view.
            if (!editorFor.event) await onEventCreated?.(saved, chapterId)
            await refresh()
          }}
          onDeleted={refresh}
          onClose={() => setEditorFor(null)}
        />
      )}
    </div>
  )
}
