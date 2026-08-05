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

/** "Ch. 3", or "B2 Ch. 3" at series scope where five books each have one. */
export function appearanceLabel(a: BookEventAppearance): string {
  const where = a.chapterNumber === null ? a.chapterTitle : `Ch. ${a.chapterNumber}`
  return a.bookOrder === undefined ? where : `B${a.bookOrder} ${where}`
}

/**
 * Is this event referenced ONLY on non-canon branches, within this scope?
 *
 * The definition that matters, and the one easy to get wrong: an event canon in
 * one chapter and branch-only in another is CANON. The badge answers "does this
 * happen in the real story", and mixed means yes.
 *
 * Scope-dependent by construction — the caller passes the appearances for the
 * tab being rendered. An event branch-only in book 2 but canon in book 4 is
 * correctly badged on book 2's tab and unbadged on the series tab.
 *
 * No appearances at all is NEITHER: the event exists in WriteAI and is
 * referenced nowhere in Loom. Untagged, not branch-only.
 */
export function isBranchOnly(appearances: BookEventAppearance[]): boolean {
  return appearances.length > 0 && appearances.every(a => a.nonCanon)
}

function ChapterLine({ appearances }: { appearances: BookEventAppearance[] }) {
  if (appearances.length === 0) return null
  // Numbers where there are numbers, titles where there are not — an
  // unnumbered chapter has no canon address but is still a real appearance,
  // and dropping it would under-report the spread.
  const shown = appearances.slice(0, 3)
  const label = shown.map(appearanceLabel).join(', ')
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
  untagged,
  branchOnly,
}: {
  event: WriterEvent
  selected: boolean
  onSelect: () => void
  nameOf: (id: string) => string
  appearances: BookEventAppearance[]
  /** Created from this tab but tagged to no chapter, so it is not really part
   *  of this book yet. Shown anyway — see `justCreated`. */
  untagged: boolean
  /** Referenced only on non-canon branches, in this tab's scope. */
  branchOnly: boolean
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
        <div className="flex items-baseline gap-2">
          <p className="truncate text-[13px] font-semibold text-ink">
            {event.title || <span className="italic text-ink-faint">Untitled event</span>}
          </p>
          {/* Dashed, and deliberately NOT amber: amber means non-canon
              (LOOM-78/107), which is a fact about the story. This is a fact
              about the tag — the event simply is not part of this book yet. */}
          {untagged && (
            <span
              title="Created here but tagged to no chapter, so it isn’t part of this book yet — and it won’t be here after a reload. Tag it from a chapter’s Events tab."
              className="shrink-0 rounded-full border border-dashed border-ink-faint/50 px-1.5 py-px text-[9px] font-semibold uppercase tracking-wide text-ink-faint"
            >
              Untagged
            </span>
          )}
          {/* Amber, matching the dock's own branch pill (EventsPanel), so the
              two surfaces do not teach different colours for the same fact. */}
          {branchOnly && (
            <span
              title="Referenced only on non-canon branches — hidden from WriteAI"
              className="shrink-0 rounded-full bg-amber-500/20 px-1.5 py-px text-[9px] font-semibold uppercase tracking-wide text-amber-400"
            >
              Branch
            </span>
          )}
        </div>
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
  const [canonFilter, setCanonFilter] = useState<'all' | 'canon' | 'branch'>('all')
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

  // Events created from THIS tab during this visit, tagged or not.
  //
  // A filtered tab has a hole in it: a new event has no tags, so it fails the
  // filter and the create appears to do nothing at all — the modal closes and
  // the list is unchanged. That reads as a bug even though the event was saved
  // perfectly well, and is the one outcome LOOM-103 rules out.
  //
  // So a just-created event stays visible here, badged, until the page is left.
  // Not persisted: it is a courtesy for the moment after the create, not a
  // second definition of what belongs to this book — that stays the tag.
  const [justCreated, setJustCreated] = useState<Set<string>>(new Set())

  /** The tab's scope, before search: every event, or the tagged ones plus
   *  anything just created here. */
  const inScope = useMemo(
    () =>
      eventIds ? events.filter(e => eventIds.has(e.id) || justCreated.has(e.id)) : events,
    [events, eventIds, justCreated],
  )

  /** In the list only because it was just created — the tag never happened. */
  const isUntagged = useCallback(
    (id: string) => Boolean(eventIds) && !eventIds!.has(id) && justCreated.has(id),
    [eventIds, justCreated],
  )

  // Oldest first, matching WriteAI. Undated events sort last in both
  // directions — an undated event is unplaced, not "the oldest".
  const sorted = useMemo(() => sortEvents(inScope, 'asc'), [inScope])

  /** Branch-only within THIS tab's scope — see isBranchOnly. */
  const branchOnlyIds = useMemo(() => {
    const out = new Set<string>()
    for (const event of inScope) {
      if (isBranchOnly(appearances[event.id] ?? [])) out.add(event.id)
    }
    return out
  }, [inScope, appearances])

  // The canon filter applies to BOTH views, unlike search. Search is a way of
  // finding one event, which the chart cannot usefully express; this is a way
  // of looking at a different story, which it can.
  //
  // "Canon" means "not badged" rather than "provably canon": an untagged event
  // is referenced nowhere in Loom, so it is not branch-only either, and hiding
  // it under a canon filter would make events disappear for a reason nobody
  // asked about.
  const canonVisible = useMemo(() => {
    if (canonFilter === 'all') return sorted
    if (canonFilter === 'branch') return sorted.filter(e => branchOnlyIds.has(e.id))
    return sorted.filter(e => !branchOnlyIds.has(e.id))
  }, [sorted, canonFilter, branchOnlyIds])

  // Search is LIST-ONLY, as in WriteAI: the chart reads as a continuous
  // sequence, and filtering it produces a sequence with holes in it.
  const visible = useMemo(() => {
    const q = query.trim()
    if (!q) return canonVisible
    return canonVisible.filter(e => matchesQuery(e, q, nameOf))
  }, [canonVisible, query, nameOf])

  // Warm the portrait cache once the tab's data has landed.
  //
  // The character POOL is already fetched on mount, beside the events — the
  // pop-in on first card click was never the data, it was the <img> elements,
  // which do not exist until the modal opens. So the first open pays a
  // round-trip per cast member at exactly the moment you are looking at them.
  //
  // Only the portraits this tab can actually show: the cast of the events IN
  // SCOPE, not all 63 characters. On a filtered book tab that is a fraction of
  // the pool, and pulling the rest would trade one visible wait for a pile of
  // invisible ones.
  //
  // Idle-time, so it never competes with the render it is meant to smooth.
  // Note the proxy sets Cache-Control: no-cache deliberately (portraits are
  // overwritten in place under a stable filename), so this does not skip the
  // later request — it makes it a cheap revalidation against bytes already
  // decoded rather than a fresh download.
  useEffect(() => {
    if (loading || unreachable) return
    const names = new Set<string>()
    for (const event of inScope) for (const id of event.characters) names.add(nameOf(id))
    const urls = [...names]
      .map(name => characterPhotos[name])
      .filter((url): url is string => Boolean(url))
    if (urls.length === 0) return

    const idle = window.requestIdleCallback
    const cancel = window.cancelIdleCallback
    const warm = () => {
      for (const url of urls) {
        const img = new window.Image()
        img.src = url
      }
    }
    if (idle) {
      const handle = idle(warm)
      return () => cancel?.(handle)
    }
    // Safari has no requestIdleCallback. A short timer is the same intent:
    // after the paint that matters, not during it.
    const handle = window.setTimeout(warm, 200)
    return () => window.clearTimeout(handle)
  }, [loading, unreachable, inScope, characterPhotos, nameOf])

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
    // Five different nothings, and conflating them is how a working tab gets
    // read as a broken one.
    if (visible.length === 0) {
      // Checked before search: with both active, the filter is the one the
      // writer just clicked, and "no events match your search" would send them
      // hunting through a query that is not the problem.
      if (canonFilter !== 'all' && canonVisible.length === 0) {
        return (
          <PanelEmptyState
            icon={<LuCalendarDays size={26} />}
            title={canonFilter === 'branch' ? 'No branch-only events' : 'No canon events'}
          >
            {canonFilter === 'branch'
              ? 'Nothing here is referenced solely on a non-canon branch.'
              : 'Everything here is referenced only on non-canon branches.'}
          </PanelEmptyState>
        )
      }
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
            untagged={isUntagged(event.id)}
            branchOnly={branchOnlyIds.has(event.id)}
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

        {/* Shown only once something is branch-only. A three-way filter for a
            distinction the story does not currently make is a control that can
            only ever do nothing, and it would sit here on every book. */}
        {branchOnlyIds.size > 0 && (
          <div className="flex items-center overflow-hidden rounded border border-accent/20">
            {(
              [
                ['all', 'All', 'Every event'],
                ['canon', 'Canon', 'Hide events referenced only on non-canon branches'],
                ['branch', 'Branch', 'Only events referenced solely on non-canon branches'],
              ] as const
            ).map(([value, label, hint]) => (
              <button
                key={value}
                type="button"
                onClick={() => setCanonFilter(value)}
                title={hint}
                aria-pressed={canonFilter === value}
                className={`px-3 py-1 text-[11px] font-medium transition ${
                  canonFilter === value
                    ? 'bg-accent/20 text-accent'
                    : 'bg-surface-overlay/40 text-ink-faint hover:text-ink'
                }`}
              >
                {label}
              </button>
            ))}
          </div>
        )}

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
        // canonVisible, not `sorted`: the canon filter applies to both views.
        // Search does not — see `visible`.
        canonVisible.length === 0 ? (
          <div style={{ height: 340 }}>{listBody()}</div>
        ) : (
          <TimelineChart
            events={canonVisible}
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
            if (!editorFor.event) {
              // Tracked whether or not it was tagged: if it WAS, the tag puts
              // it in scope anyway and this is a harmless duplicate; if it was
              // not, this is the only thing keeping it on screen.
              setJustCreated(prev => new Set(prev).add(saved.id))
              await onEventCreated?.(saved, chapterId)
            }
            await refresh()
          }}
          onDeleted={refresh}
          onClose={() => setEditorFor(null)}
        />
      )}
    </div>
  )
}
