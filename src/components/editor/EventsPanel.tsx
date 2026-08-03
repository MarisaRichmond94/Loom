'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { LuArrowUpDown, LuCalendarDays, LuGitBranch, LuMapPin, LuPencil, LuPlus, LuTag, LuX } from 'react-icons/lu'
import { PanelEmpty, PanelEmptyState } from './PanelEmptyState'
import { CharacterAvatar } from './CharacterAvatar'
import EventModal from './EventModal'
import { formatEventWhen, matchesQuery, sortEvents, type WriterEvent } from '@/lib/eventSearch'
import type { CharacterOption } from '@/lib/writerCharacters'
import type { EventAppearance, TaggedEvent } from './useChapterEvents'

// The Events tab: which WriteAI events this chapter references (LOOM-32).
//
// Two modes behind one toggle, rather than a permanently visible search box:
//
//   tag mode OFF — the events tagged to THIS chapter. Opening the tab answers
//                  "what's referenced here?", which is the question a writer
//                  actually has mid-scene.
//   tag mode ON  — every event, searchable, tagged ones outlined. Clicking a
//                  row toggles the tag; the outline IS the state, so there is
//                  no separate checkbox competing with it.
//
// A search field that is always on screen is chrome you need for a few seconds
// at a time. The empty state carries the discovery burden instead.

/** "Also in Ch. 7, Ch. 12" — or with the book named, when the event reaches
 *  into another one. Unnumbered chapters have no canon address, so they are
 *  named rather than numbered rather than being dropped. */
function describeSpread(alsoIn: EventAppearance[], thisBookId: string | undefined): string {
  return alsoIn
    .map(a => {
      const where = a.chapterNumber === null ? a.chapterTitle : `Ch. ${a.chapterNumber}`
      return thisBookId && a.bookId !== thisBookId ? `${a.bookTitle} ${where}` : where
    })
    .join(', ')
}

function EventRow({
  event,
  tagged,
  spread,
  photos,
  nameOf,
  expanded,
  onActivate,
  onUntag,
  nonCanon,
  onToggleNonCanon,
  onEdit,
}: {
  event: WriterEvent
  tagged: boolean
  spread?: string
  photos: Record<string, string | null>
  /** Stored cast entries are `wc-` ids (LOOM-45); this turns one into the name
   *  to display. The photo map is keyed by name, so it is indexed by the
   *  RESOLVED name rather than the raw reference. */
  nameOf: (id: string) => string
  expanded: boolean
  /** Expands in browse mode, toggles the tag in tag mode — the two things a
   *  click can sensibly mean, one per mode. */
  onActivate: () => void
  /** Browse mode only. Untagging is deliberately NOT what a click on the card
   *  does: the card is for reading, and losing a tag by misclicking while
   *  reading is the kind of thing you only notice much later. */
  onUntag?: () => void
  /** Browse mode only, like untag. Absent while tagging, where the flag has no
   *  meaning yet — the tag does not exist. */
  nonCanon?: boolean
  onToggleNonCanon?: () => void
  onEdit?: () => void
}) {
  const when = formatEventWhen(event)

  return (
    <div className="group/event relative">
      <button
        type="button"
        onClick={onActivate}
        aria-pressed={onUntag ? undefined : tagged}
        aria-expanded={onUntag ? expanded : undefined}
        className={`w-full cursor-pointer rounded-lg border px-3 py-2.5 text-left transition hover:border-accent/60 ${
          tagged ? 'border-accent bg-accent/5' : 'border-accent/10 bg-surface-overlay/40'
        }`}
      >
        <div className="flex items-baseline gap-2">
          <span className={`flex-1 text-[13px] font-semibold text-ink ${expanded ? '' : 'truncate'}`}>
            {event.title}
          </span>
          {/* Persistent, unlike the toggle that sets it: the toggle only
              appears on hover, and a tag whose non-canon-ness is only visible
              while pointing at it may as well not be marked. */}
          {nonCanon && (
            <span
              title="Referenced in this chapter only on a non-canon branch — hidden from WriteAI"
              className="shrink-0 rounded-full bg-amber-500/20 px-1.5 py-px text-[9px] font-semibold uppercase tracking-wide text-amber-400"
            >
              Branch
            </span>
          )}
          {event.location && !expanded && (
            <span className="flex shrink-0 items-center gap-1 text-[10px] text-ink-faint">
              <LuMapPin size={10} />
              <span className="max-w-[12ch] truncate">{event.location}</span>
            </span>
          )}
        </div>
        <div className="mt-0.5 flex items-baseline gap-2">
          {!expanded && (
            <span className="flex-1 truncate text-[11px] text-ink-muted">
              {event.characters.map(nameOf).join(', ')}
            </span>
          )}
          {when && (
            <span className={`shrink-0 text-[10px] text-ink-faint ${expanded ? 'flex-1' : ''}`}>
              {when}
            </span>
          )}
        </div>

        {/* Height animates via grid-template-rows 0fr→1fr, the one way to
            transition to CONTENT height without measuring it first. */}
        <div
          className={`grid transition-[grid-template-rows] duration-200 ease-out motion-reduce:transition-none ${
            expanded ? 'grid-rows-[1fr]' : 'grid-rows-[0fr]'
          }`}
        >
          <div className="overflow-hidden">
            <div className="mt-2.5 flex flex-col gap-3 border-t border-accent/10 pt-2.5">
              {event.description && (
                <p className="text-[11px] leading-relaxed text-ink-muted">{event.description}</p>
              )}
              {event.characters.length > 0 && (
                <div>
                  <p className="text-[9px] font-semibold uppercase tracking-widest text-ink-faint">
                    Character(s) ({event.characters.length})
                  </p>
                  <div className="mt-1.5 flex flex-wrap gap-1.5">
                    {event.characters.map(id => {
                      const label = nameOf(id)
                      return (
                      <span
                        key={id}
                        className="flex items-center gap-1.5 rounded-lg border border-accent/15 bg-surface-overlay/60 py-1 pl-1 pr-2.5"
                      >
                        <CharacterAvatar name={label} src={photos[label]} size={28} />
                        <span className="text-[11px] font-medium text-ink">{label}</span>
                      </span>
                      )
                    })}
                  </div>
                </div>
              )}
              {event.location && (
                <div>
                  <p className="text-[9px] font-semibold uppercase tracking-widest text-ink-faint">
                    Location
                  </p>
                  <span className="mt-1 flex items-center gap-1.5 text-[11px] text-ink-muted">
                    <LuMapPin size={11} className="shrink-0 text-ink-faint" />
                    {event.location}
                  </span>
                </div>
              )}
            </div>
          </div>
        </div>

        {/* The cross-chapter spread — the one thing this tab shows that nothing
            else can, and the reason the epic exists. Quieter than the lines
            above so it informs without competing. */}
        {spread && (
          <div className={`mt-1 text-[10px] italic text-ink-faint/80 ${expanded ? '' : 'truncate'}`}>
            Also in {spread}
          </div>
        )}
      </button>

      {/* Overlaid in the corner on hover, rather than sitting in a lane beside
          the card. The lane cost every card its width permanently to show two
          icons that are wanted momentarily. Kept a SIBLING of the card button,
          not a child — a button inside a button is invalid, and the browser
          resolves it by dropping the nesting rather than by telling you.

          The cluster carries its own background so the title, which truncates
          under it, is masked rather than showing through the icons. */}
      {(onUntag || onEdit || onToggleNonCanon) && (
        <div className="absolute right-1.5 top-1.5 flex items-center gap-1.5 rounded-md border border-accent/15 bg-surface-raised px-1.5 py-1 opacity-0 shadow-sm transition group-hover/event:opacity-100 focus-within:opacity-100">
          {onToggleNonCanon && (
            <button
              type="button"
              onClick={onToggleNonCanon}
              title={
                nonCanon
                  ? 'Referenced only on a non-canon branch — click to mark canon'
                  : 'Mark as referenced only on a non-canon branch'
              }
              aria-pressed={nonCanon}
              aria-label={`Mark as non-canon in this chapter: ${event.title}`}
              className={`transition ${
                nonCanon ? 'text-amber-400 hover:text-amber-300' : 'text-ink-faint hover:text-ink'
              }`}
            >
              <LuGitBranch size={12} />
            </button>
          )}
          {onUntag && (
            <button
              type="button"
              onClick={onUntag}
              title="Remove this tag"
              aria-label={`Remove tag: ${event.title}`}
              className="text-ink-faint transition hover:text-ink"
            >
              <LuX size={13} />
            </button>
          )}
          {onEdit && (
            <button
              type="button"
              onClick={onEdit}
              title="Edit this event"
              aria-label={`Edit event: ${event.title}`}
              className="text-ink-faint transition hover:text-ink"
            >
              <LuPencil size={12} />
            </button>
          )}
        </div>
      )}
    </div>
  )
}

export default function EventsPanel({
  events,
  tagged,
  taggedIds,
  loading,
  unreachable,
  onToggleTag,
  onSetNonCanon,
  onRetry,
  bookId,
  locations,
  characterPool,
  characterPhotos,
  onRefresh,
}: {
  events: WriterEvent[]
  tagged: TaggedEvent[]
  taggedIds: Set<string>
  loading: boolean
  unreachable: boolean
  onToggleTag: (writerEventId: string, tagged: boolean) => void | Promise<void>
  onSetNonCanon: (writerEventId: string, nonCanon: boolean) => void | Promise<void>
  onRetry: () => void
  bookId?: string
  locations: string[]
  characterPool: CharacterOption[]
  characterPhotos: Record<string, string | null>
  onRefresh: () => void | Promise<void>
}) {
  const [tagMode, setTagMode] = useState(false)
  const [query, setQuery] = useState('')
  const [direction, setDirection] = useState<'asc' | 'desc'>('asc')
  const searchRef = useRef<HTMLInputElement>(null)
  // null = closed; { event: undefined } = creating.
  const [editorFor, setEditorFor] = useState<{ event?: WriterEvent } | null>(null)
  // Prefills the date field the next time an event is created, so entering a
  // run of same-day events doesn't mean re-picking the date every time.
  // Derived from `updated_at` (not `sortEvents`'s in-story order) so it
  // survives a reload — it tracks when an event was last touched, not where
  // it falls in the narrative.
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
  // One card open at a time — the dock is narrow, and two expanded cards means
  // scrolling to compare things that no longer fit on screen together.
  const [expandedId, setExpandedId] = useState<string | null>(null)

  function openEditor(event?: WriterEvent) {
    setEditorFor({ event })
  }

  const onCreate = () => openEditor()
  const onEdit = (event: WriterEvent) => openEditor(event)

  // Cast entries are stored as `wc-` ids (LOOM-45). One resolver for the whole
  // panel — rendering AND searching — so a name can never be shown in one place
  // and searched as an id in the other.
  const nameById = useMemo(
    () => new Map(characterPool.map(c => [c.id, c.name])),
    [characterPool],
  )
  const nameOf = useCallback(
    (id: string) => nameById.get(id) ?? 'Unknown character',
    [nameById],
  )


  // autoFocus is not available here: the input never unmounts, so it would only
  // fire once. Focus is driven by the mode instead, and blurred on close so the
  // caret does not sit invisibly inside a collapsed box.
  useEffect(() => {
    if (tagMode) searchRef.current?.focus()
    else searchRef.current?.blur()
  }, [tagMode])

  const visible = useMemo(() => {
    const pool = tagMode ? events.filter(e => matchesQuery(e, query, nameOf)) : tagged
    return sortEvents(pool, direction)
  }, [tagMode, events, tagged, query, direction, nameOf])

  const toolbar = (
    <div className="flex items-center gap-2 px-4 py-3 shrink-0">
      {/* One element that grows, not two that swap.
          The search field and the collapsed tag button are the SAME box: it
          claims the row with flex-1 and is clamped back to the icon's width
          when closed, so opening and closing is a width animation rather than
          a hard cut between two different elements.
          The input stays mounted throughout — unmounting it would collapse the
          box instantly and there would be nothing left to animate. */}
      <div
        className={`flex min-w-0 flex-1 items-center overflow-hidden rounded-lg border bg-surface-overlay/40 transition-[max-width,border-color] duration-200 ease-out motion-reduce:transition-none ${
          tagMode
            ? 'max-w-full border-accent/30 focus-within:border-accent'
            : 'max-w-[32px] border-accent/20 hover:border-accent/60'
        }`}
      >
        <button
          type="button"
          onClick={() => {
            setTagMode(open => !open)
            if (tagMode) setQuery('')
          }}
          title={tagMode ? 'Done tagging' : 'Search events to tag'}
          aria-label={tagMode ? 'Done tagging' : 'Search events to tag'}
          aria-expanded={tagMode}
          className={`grid h-[30px] w-[30px] shrink-0 place-items-center transition-colors ${
            tagMode ? 'text-accent' : 'text-ink-faint hover:text-ink'
          }`}
        >
          <LuTag size={14} />
        </button>
        <input
          ref={searchRef}
          value={query}
          onChange={e => setQuery(e.target.value)}
          onKeyDown={e => {
            if (e.key === 'Escape') {
              e.stopPropagation()
              setTagMode(false)
              setQuery('')
            }
          }}
          placeholder="Search events by title or character…"
          aria-label="Search events to tag"
          // Hidden from tab order and screen readers while collapsed: it is
          // still in the DOM purely so the box has something to expand around.
          tabIndex={tagMode ? 0 : -1}
          aria-hidden={!tagMode}
          className={`w-full min-w-0 bg-transparent pr-2.5 text-xs text-ink outline-none transition-opacity duration-150 placeholder:text-ink-faint motion-reduce:transition-none ${
            tagMode ? 'opacity-100 delay-75' : 'opacity-0'
          }`}
        />
      </div>

      <button
        type="button"
        onClick={() => setDirection(d => (d === 'asc' ? 'desc' : 'asc'))}
        title={direction === 'asc' ? 'Oldest first — click for newest' : 'Newest first — click for oldest'}
        aria-label={direction === 'asc' ? 'Sorted oldest first' : 'Sorted newest first'}
        className="shrink-0 text-ink-faint transition hover:text-ink"
      >
        <LuArrowUpDown size={15} />
      </button>

      <button
        type="button"
        onClick={onCreate}
        title="Create an event and tag it here"
        aria-label="Create an event and tag it here"
        className="shrink-0 text-ink-faint transition hover:text-ink"
      >
        <LuPlus size={17} />
      </button>

    </div>
  )

  function body() {
    if (unreachable) {
      return (
        <PanelEmptyState icon={<LuCalendarDays size={26} />} title="WriteAI isn’t running">
          Events live in WriteAI, so this chapter’s tags can’t be shown until it’s up. Your tags are
          safe — they’re stored in Loom.{' '}
          <button onClick={onRetry} className="text-accent underline underline-offset-2">
            Try again
          </button>
        </PanelEmptyState>
      )
    }
    if (loading) {
      return <PanelEmptyState icon={<LuCalendarDays size={26} />} title="Loading events…" />
    }
    if (visible.length === 0) {
      // Three different nothings, and conflating them is how a working tab
      // gets read as a broken one.
      if (tagMode && query.trim()) {
        return (
          <PanelEmptyState icon={<LuCalendarDays size={26} />} title="No events match">
            Nothing matches “{query.trim()}”. Search runs over event titles and character names.
          </PanelEmptyState>
        )
      }
      if (tagMode) {
        return (
          <PanelEmptyState icon={<LuCalendarDays size={26} />} title="No events yet">
            Create one with the + button, or add events from WriteAI’s timeline.
          </PanelEmptyState>
        )
      }
      return (
        <PanelEmptyState icon={<LuCalendarDays size={26} />} title="No events tagged yet">
          Click the tag toggle to search events and tag them to this chapter, or click the + button
          to create a new event and tag it here.
        </PanelEmptyState>
      )
    }

    return (
      <div className="flex flex-col gap-2 px-4 pb-4">
        {visible.map(event => {
          const isTagged = taggedIds.has(event.id)
          const alsoIn = (event as TaggedEvent).alsoIn
          return (
            <EventRow
              key={event.id}
              event={event}
              tagged={isTagged}
              spread={alsoIn?.length ? describeSpread(alsoIn, bookId) : undefined}
              photos={characterPhotos}
              nameOf={nameOf}
              expanded={!tagMode && expandedId === event.id}
              onActivate={
                tagMode
                  ? () => onToggleTag(event.id, !isTagged)
                  : () => setExpandedId(id => (id === event.id ? null : event.id))
              }
              onUntag={tagMode ? undefined : () => onToggleTag(event.id, false)}
              nonCanon={(event as TaggedEvent).nonCanon}
              onToggleNonCanon={
                tagMode
                  ? undefined
                  : () => onSetNonCanon(event.id, !(event as TaggedEvent).nonCanon)
              }
              onEdit={tagMode ? undefined : () => onEdit(event)}
            />
          )
        })}
      </div>
    )
  }

  return (
    <div className="flex flex-1 flex-col min-h-0">
      {toolbar}
      <PanelEmpty>{body()}</PanelEmpty>
      {editorFor && (
        <EventModal
          event={editorFor.event}
          characterPool={characterPool}
          locationPool={locations}
          defaultDate={lastUpdatedDate}
          onSaved={async saved => {
            // A newly created event is tagged here immediately. Creating one
            // from a chapter and then having to go find it would be worse than
            // the timeline this exists to replace.
            if (!editorFor.event && saved?.id) {
              await onToggleTag(saved.id, true)
            }
            // ALWAYS refresh, including after a create. Tagging only records an
            // id in Loom; the row is rendered by looking that id up in the list
            // fetched from WriteAI, so without this the new event is tagged and
            // invisible — present in neither the tagged list nor search.
            await onRefresh()
          }}
          onDeleted={onRefresh}
          onClose={() => setEditorFor(null)}
        />
      )}
    </div>
  )
}
