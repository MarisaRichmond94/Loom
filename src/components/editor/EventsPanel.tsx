'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import { LuArrowUpDown, LuCalendarDays, LuMapPin, LuPencil, LuPlus, LuTag, LuX } from 'react-icons/lu'
import { PanelEmpty, PanelEmptyState } from './PanelEmptyState'
import EventModal from './EventModal'
import { formatEventWhen, matchesQuery, sortEvents, type WriterEvent } from '@/lib/eventSearch'
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
  onToggle,
  onEdit,
}: {
  event: WriterEvent
  tagged: boolean
  spread?: string
  onToggle?: () => void
  onEdit?: () => void
}) {
  const when = formatEventWhen(event)
  const interactive = Boolean(onToggle)

  return (
    <div className="group/event flex items-start gap-1">
      <button
        type="button"
        onClick={onToggle}
        disabled={!interactive}
        aria-pressed={interactive ? tagged : undefined}
        className={`flex-1 min-w-0 rounded-lg border px-3 py-2.5 text-left transition ${
          tagged ? 'border-accent bg-accent/5' : 'border-accent/10 bg-surface-overlay/40'
        } ${interactive ? 'hover:border-accent/60 cursor-pointer' : 'cursor-default'}`}
      >
        <div className="flex items-baseline gap-2">
          <span className="flex-1 truncate text-[13px] font-semibold text-ink">{event.title}</span>
          {event.location && (
            <span className="flex shrink-0 items-center gap-1 text-[10px] text-ink-faint">
              <LuMapPin size={10} />
              <span className="max-w-[12ch] truncate">{event.location}</span>
            </span>
          )}
        </div>
        <div className="mt-0.5 flex items-baseline gap-2">
          <span className="flex-1 truncate text-[11px] text-ink-muted">
            {event.characters.join(', ')}
          </span>
          {when && <span className="shrink-0 text-[10px] text-ink-faint">{when}</span>}
        </div>
        {/* The cross-chapter spread — the one thing this tab shows that nothing
            else can, and the reason the epic exists. Quieter than the lines
            above so it informs without competing. */}
        {spread && (
          <div className="mt-1 truncate text-[10px] italic text-ink-faint/80">Also in {spread}</div>
        )}
      </button>

      {/* Revealed on hover, outside the card so they never overlap the text. */}
      {(onToggle || onEdit) && (
        <div className="flex shrink-0 flex-col gap-1 pt-1 opacity-0 transition group-hover/event:opacity-100 focus-within:opacity-100">
          {onToggle && tagged && (
            <button
              type="button"
              onClick={onToggle}
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
  onRetry,
  bookId,
  locations,
  characterPool,
  loadCharacterPool,
  onRefresh,
}: {
  events: WriterEvent[]
  tagged: TaggedEvent[]
  taggedIds: Set<string>
  loading: boolean
  unreachable: boolean
  onToggleTag: (writerEventId: string, tagged: boolean) => void
  onRetry: () => void
  bookId?: string
  locations: string[]
  characterPool: string[]
  loadCharacterPool: () => void | Promise<void>
  onRefresh: () => void | Promise<void>
}) {
  const [tagMode, setTagMode] = useState(false)
  const [query, setQuery] = useState('')
  const [direction, setDirection] = useState<'asc' | 'desc'>('asc')
  const searchRef = useRef<HTMLInputElement>(null)
  // null = closed; { event: undefined } = creating.
  const [editorFor, setEditorFor] = useState<{ event?: WriterEvent } | null>(null)

  function openEditor(event?: WriterEvent) {
    // Fetched here rather than on mount because the characters endpoint writes
    // to disk when read — see loadCharacterPool.
    void loadCharacterPool()
    setEditorFor({ event })
  }

  const onCreate = () => openEditor()
  const onEdit = (event: WriterEvent) => openEditor(event)

  // autoFocus is not available here: the input never unmounts, so it would only
  // fire once. Focus is driven by the mode instead, and blurred on close so the
  // caret does not sit invisibly inside a collapsed box.
  useEffect(() => {
    if (tagMode) searchRef.current?.focus()
    else searchRef.current?.blur()
  }, [tagMode])

  const visible = useMemo(() => {
    const pool = tagMode ? events.filter(e => matchesQuery(e, query)) : tagged
    return sortEvents(pool, direction)
  }, [tagMode, events, tagged, query, direction])

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
              onToggle={tagMode || isTagged ? () => onToggleTag(event.id, !isTagged) : undefined}
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
          onSaved={async saved => {
            // A newly created event is tagged here immediately. Creating one
            // from a chapter and then having to go find it would be worse than
            // the timeline this exists to replace.
            if (!editorFor.event && saved?.id) onToggleTag(saved.id, true)
            else await onRefresh()
          }}
          onDeleted={onRefresh}
          onClose={() => setEditorFor(null)}
        />
      )}
    </div>
  )
}
