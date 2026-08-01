'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import { LuArrowUpDown, LuGitBranch, LuPencil, LuPlus, LuTag, LuUnlink, LuUsers } from 'react-icons/lu'
import { PanelEmpty, PanelEmptyState } from './PanelEmptyState'
import { CharacterAvatar, characterPhotoHref } from './CharacterAvatar'
import { RelationshipList } from './RelationshipList'
import CharacterModal from './CharacterModal'
import {
  CATEGORIES,
  aliasList,
  isPovCharacter,
  matchesQuery,
  sortCharacters,
  type WriterCharacter,
} from '@/lib/characterSearch'
import type { ChapterAppearance } from '@/lib/chapterTags'
import type { TaggedCharacter } from './useChapterCharacters'

// The Characters tab: who appears in this chapter (LOOM-33).
//
// Deliberately the same two-mode shape as the Events tab — one tag toggle,
// browse by default, search-and-tag behind it — because they answer the same
// kind of question about a chapter and there is no reason for them to be
// learned twice.
//
// What differs is the row: a portrait, aliases (how a writer actually reaches
// for a character mid-scene), and a category control that WRITES, which the
// event row has no equivalent of.

/** "Also in Ch. 7, 9" — book-qualified when it reaches another one. */
function describeSpread(alsoIn: ChapterAppearance[], thisBookId: string | undefined): string {
  return alsoIn
    .map(a => {
      const where = a.chapterNumber === null ? a.chapterTitle : `Ch. ${a.chapterNumber}`
      return thisBookId && a.bookId !== thisBookId ? `${a.bookTitle} ${where}` : where
    })
    .join(', ')
}

function CharacterRow({
  character,
  pool,
  isPov,
  tagged,
  spread,
  expanded,
  onActivate,
  onUntag,
  nonCanon,
  onToggleNonCanon,
  onEdit,
  onCategory,
}: {
  character: WriterCharacter
  /** For relationship portraits, which reference characters by name. */
  pool: WriterCharacter[]
  /** True when this character is the chapter's POV — matched by name, since
   *  nothing joins Loom's chapter.pov to a WriteAI id. */
  isPov: boolean
  tagged: boolean
  spread?: string
  expanded: boolean
  onActivate: () => void
  onUntag?: () => void
  /** Browse mode only, like untag. Absent while tagging, where the flag has no
   *  meaning yet — the tag does not exist. */
  nonCanon?: boolean
  onToggleNonCanon?: () => void
  onEdit?: () => void
  onCategory: (category: string) => void
}) {
  const aliases = aliasList(character.aliases)

  return (
    <div className="flex items-start">
      {/* The card is a div, not a button: it contains the category control,
          and nesting a button inside a button is invalid and makes the inner
          one unreachable in some browsers. The clickable region is explicit
          instead. */}
      <div
        className={`group/char min-w-0 flex-1 rounded-lg border px-3 py-2.5 transition ${
          tagged ? 'border-accent bg-accent/5' : 'border-accent/10 bg-surface-overlay/40'
        } hover:border-accent/60`}
      >
        <div className="flex items-center gap-2">
          <div
            role="button"
            tabIndex={0}
            onClick={onActivate}
            onKeyDown={e => {
              if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onActivate() }
            }}
            aria-expanded={onUntag ? expanded : undefined}
            className="flex min-w-0 flex-1 cursor-pointer items-center gap-2.5 text-left"
          >
            <CharacterAvatar name={character.name} src={characterPhotoHref(character.photo_url)} />
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-1.5">
                <span className="truncate text-[13px] font-semibold text-ink">{character.name}</span>
                {isPov && (
                  <span
                    title="This chapter is written from their point of view"
                    className="shrink-0 rounded-full bg-accent px-1.5 py-px text-[9px] font-semibold uppercase tracking-wide text-white"
                  >
                    POV
                  </span>
                )}
                {/* Persistent, unlike the toggle that sets it: the toggle only
                    appears on hover, and a tag whose non-canon-ness is only
                    visible while pointing at it may as well not be marked. */}
                {nonCanon && (
                  <span
                    title="Appears in this chapter only on a non-canon branch — hidden from WriteAI"
                    className="shrink-0 rounded-full bg-amber-500/20 px-1.5 py-px text-[9px] font-semibold uppercase tracking-wide text-amber-400"
                  >
                    Branch
                  </span>
                )}
              </div>
              {aliases.length > 0 && (
                <div className="truncate text-[11px] text-ink-muted">{aliases.join(', ')}</div>
              )}
            </div>
          </div>

          {/* Revealed on hover, but the space is reserved INSIDE the card at
              all times, so nothing reflows when the pointer arrives. The
              earlier version put this lane OUTSIDE the card, which made every
              card sit short of the panel's right edge to hold room for
              controls that were usually invisible.

              Untag is an UNLINK: it severs this chapter's tag and leaves the
              character alone. Deleting a character deliberately does NOT live
              here — it removes them from WriteAI everywhere, and putting that
              a pixel from a trivially reversible untag is how it gets done by
              accident. It lives in the edit modal, which you have to open.

              focus-within so the buttons are reachable by keyboard, where
              there is no hover to depend on. */}
          <div className="flex shrink-0 self-start items-center gap-0.5 opacity-0 transition-opacity duration-150 group-hover/char:opacity-100 focus-within:opacity-100 motion-reduce:transition-none">
            {onToggleNonCanon && (
              <button
                type="button"
                onClick={e => { e.stopPropagation(); onToggleNonCanon() }}
                title={
                  nonCanon
                    ? 'Appears only on a non-canon branch — click to mark canon'
                    : 'Mark as appearing only on a non-canon branch'
                }
                aria-pressed={nonCanon}
                aria-label={`Mark ${character.name} as non-canon in this chapter`}
                className={`rounded p-1 transition hover:bg-accent/10 ${
                  nonCanon ? 'text-amber-400 hover:text-amber-300' : 'text-ink-faint hover:text-ink'
                }`}
              >
                <LuGitBranch size={12} />
              </button>
            )}
            {onEdit && (
              <button
                type="button"
                onClick={e => { e.stopPropagation(); onEdit() }}
                title="Edit this character"
                aria-label={`Edit character: ${character.name}`}
                className="rounded p-1 text-ink-faint transition hover:bg-accent/10 hover:text-ink"
              >
                <LuPencil size={12} />
              </button>
            )}
            {onUntag && (
              <button
                type="button"
                onClick={e => { e.stopPropagation(); onUntag() }}
                title="Remove this character from this chapter"
                aria-label={`Untag ${character.name} from this chapter`}
                className="rounded p-1 text-ink-faint transition hover:bg-accent/10 hover:text-ink"
              >
                <LuUnlink size={13} />
              </button>
            )}
          </div>
        </div>

        {/* Editable in place. A category is the one field a writer revises
            while reading a chapter — "she's actually secondary here" — and
            sending them to a modal for a three-way choice is friction. It
            writes the WHOLE character, because WriteAI stores the body
            verbatim; see useChapterCharacters.setCategory. */}
        <div className="mt-2 flex flex-wrap gap-1">
          {CATEGORIES.map(c => {
            const active = character.category === c
            return (
              <button
                key={c}
                type="button"
                onClick={e => { e.stopPropagation(); onCategory(c) }}
                aria-pressed={active}
                title={`Mark ${character.name} as ${c}`}
                className={`rounded-full border px-2.5 py-0.5 text-[10px] capitalize transition ${
                  active
                    ? 'border-accent bg-accent/15 text-accent'
                    : 'border-accent/15 text-ink-faint hover:border-accent/40 hover:text-ink'
                }`}
              >
                {c}
              </button>
            )
          })}
        </div>

        {/* Height animates via grid-template-rows 0fr→1fr — the one way to
            transition to CONTENT height without measuring it first. */}
        <div
          className={`grid transition-[grid-template-rows] duration-200 ease-out motion-reduce:transition-none ${
            expanded ? 'grid-rows-[1fr]' : 'grid-rows-[0fr]'
          }`}
        >
          <div className="overflow-hidden">
            <div className="mt-2.5 flex flex-col gap-2.5 border-t border-accent/10 pt-2.5">
              {character.role && (
                <p className="text-[11px] text-ink-muted">{character.role}</p>
              )}
              {character.goals && (
                <div>
                  <p className="text-[9px] font-semibold uppercase tracking-widest text-ink-faint">Goals</p>
                  <p className="mt-0.5 text-[11px] leading-relaxed text-ink-muted">{character.goals}</p>
                </div>
              )}
              {character.traits.length > 0 && (
                <div className="flex flex-wrap gap-1">
                  {character.traits.map(t => (
                    <span key={t} className="rounded-full bg-surface-overlay px-2 py-0.5 text-[10px] text-ink-muted">
                      {t}
                    </span>
                  ))}
                </div>
              )}
              {character.relationships.length > 0 && (
                <RelationshipList relationships={character.relationships} pool={pool} />
              )}
              {/* The cross-chapter spread lives here rather than on the resting
                  row: a main character appears in dozens of chapters, and the
                  card already carries a portrait, aliases and three pills. */}
              {spread && (
                <p className="text-[10px] italic text-ink-faint/80">Also in {spread}</p>
              )}
            </div>
          </div>
        </div>
      </div>

    </div>
  )
}

export default function CharactersPanel({
  characters,
  tagged,
  onSetNonCanon,
  taggedIds,
  loading,
  unreachable,
  onToggleTag,
  onSetCategory,
  onRetry,
  bookId,
  pov,
}: {
  characters: WriterCharacter[]
  tagged: TaggedCharacter[]
  taggedIds: Set<string>
  loading: boolean
  unreachable: boolean
  onToggleTag: (writerCharacterId: string, tagged: boolean) => void | Promise<void>
  onSetNonCanon: (writerCharacterId: string, nonCanon: boolean) => void | Promise<void>
  onSetCategory: (character: WriterCharacter, category: string) => void | Promise<void>
  onRetry: () => void
  bookId?: string
  /** The chapter's POV, as typed on the chapter. */
  pov?: string | null
}) {
  const [tagMode, setTagMode] = useState(false)
  const [query, setQuery] = useState('')
  const [direction, setDirection] = useState<'asc' | 'desc'>('asc')
  const [expandedId, setExpandedId] = useState<string | null>(null)
  const searchRef = useRef<HTMLInputElement>(null)
  // null = closed; { character: undefined } = creating.
  const [editorFor, setEditorFor] = useState<{ character?: WriterCharacter } | null>(null)
  const [books, setBooks] = useState<string[]>([])
  // Autosave fires on every edit, so without this a create session would
  // re-tag on each keystroke pause. The POST is idempotent, but each one also
  // re-reads the spread.
  const taggedNewRef = useRef(false)

  // Fetched when the modal first opens, not on mount: the book chips are the
  // only thing that needs it, and the tab is opened far more often than the
  // modal is.
  function openEditor(character?: WriterCharacter) {
    if (books.length === 0) {
      void fetch('/api/writeai/books')
        .then(r => (r.ok ? r.json() : null))
        .then(d => setBooks(d?.books ?? []))
        .catch(() => { /* chips render empty; everything else still saves */ })
    }
    taggedNewRef.current = false
    setEditorFor({ character })
  }

  const onCreate = () => openEditor()
  const onEdit = (character: WriterCharacter) => openEditor(character)

  useEffect(() => {
    if (tagMode) searchRef.current?.focus()
    else searchRef.current?.blur()
  }, [tagMode])

  const visible = useMemo(() => {
    const pool = tagMode ? characters.filter(c => matchesQuery(c, query)) : tagged
    return sortCharacters(pool, direction)
  }, [tagMode, characters, tagged, query, direction])

  const toolbar = (
    <div className="flex items-center gap-2 px-4 py-3 shrink-0">
      {/* One element that grows, not two that swap — same as the Events tab. */}
      <div
        className={`flex min-w-0 flex-1 items-center overflow-hidden rounded-lg border bg-surface-overlay/40 transition-[max-width,border-color] duration-200 ease-out motion-reduce:transition-none ${
          tagMode
            ? 'max-w-full border-accent/30 focus-within:border-accent'
            : 'max-w-[32px] border-accent/20 hover:border-accent/60'
        }`}
      >
        <button
          type="button"
          onClick={() => { setTagMode(open => !open); if (tagMode) setQuery('') }}
          title={tagMode ? 'Done tagging' : 'Search characters to tag'}
          aria-label={tagMode ? 'Done tagging' : 'Search characters to tag'}
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
            if (e.key === 'Escape') { e.stopPropagation(); setTagMode(false); setQuery('') }
            else if (e.key === 'Enter' && tagMode && visible.length > 0) {
              e.preventDefault()
              const top = visible[0]
              if (!taggedIds.has(top.id)) onToggleTag(top.id, true)
              setQuery('')
            }
          }}
          placeholder="Search characters by name or alias…"
          aria-label="Search characters to tag"
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
        title={direction === 'asc' ? 'A–Z — click for Z–A' : 'Z–A — click for A–Z'}
        aria-label={direction === 'asc' ? 'Sorted A to Z' : 'Sorted Z to A'}
        className="shrink-0 text-ink-faint transition hover:text-ink"
      >
        <LuArrowUpDown size={15} />
      </button>

      <button
        type="button"
        onClick={onCreate}
        title="Create a character and tag them here"
        aria-label="Create a character and tag them here"
        className="shrink-0 text-ink-faint transition hover:text-ink"
      >
        <LuPlus size={17} />
      </button>
    </div>
  )

  function body() {
    if (unreachable) {
      return (
        <PanelEmptyState icon={<LuUsers size={26} />} title="WriteAI isn’t running">
          Characters live in WriteAI, so this chapter’s cast can’t be shown until it’s up. Your tags
          are safe — they’re stored in Loom.{' '}
          <button onClick={onRetry} className="text-accent underline underline-offset-2">
            Try again
          </button>
        </PanelEmptyState>
      )
    }
    if (loading) return <PanelEmptyState icon={<LuUsers size={26} />} title="Loading characters…" />

    if (visible.length === 0) {
      if (tagMode && query.trim()) {
        return (
          <PanelEmptyState icon={<LuUsers size={26} />} title="No characters match">
            Nothing matches “{query.trim()}”. Search runs over names and aliases.
          </PanelEmptyState>
        )
      }
      if (tagMode) {
        return (
          <PanelEmptyState icon={<LuUsers size={26} />} title="No characters yet">
            Create one with the + button, or add characters on WriteAI’s Plan page.
          </PanelEmptyState>
        )
      }
      return (
        <PanelEmptyState icon={<LuUsers size={26} />} title="No characters tagged yet">
          Click the tag toggle to search characters and tag them to this chapter, or click the +
          button to create one and tag them here.
        </PanelEmptyState>
      )
    }

    return (
      <div className="flex flex-col gap-2 px-4 pb-4">
        {visible.map(character => {
          const isTagged = taggedIds.has(character.id)
          const alsoIn = (character as TaggedCharacter).alsoIn
          return (
            <CharacterRow
              key={character.id}
              character={character}
              pool={characters}
              isPov={isPovCharacter(character, pov)}
              tagged={isTagged}
              spread={alsoIn?.length ? describeSpread(alsoIn, bookId) : undefined}
              expanded={!tagMode && expandedId === character.id}
              onActivate={
                tagMode
                  ? () => onToggleTag(character.id, !isTagged)
                  : () => setExpandedId(id => (id === character.id ? null : character.id))
              }
              onUntag={tagMode ? undefined : () => onToggleTag(character.id, false)}
              nonCanon={(character as TaggedCharacter).nonCanon}
              onToggleNonCanon={
                tagMode
                  ? undefined
                  : () =>
                      onSetNonCanon(character.id, !(character as TaggedCharacter).nonCanon)
              }
              onEdit={tagMode ? undefined : () => onEdit(character)}
              onCategory={c => onSetCategory(character, c)}
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
        <CharacterModal
          character={editorFor.character}
          pool={characters}
          books={books}
          onSaved={async saved => {
            // A newly created character is tagged here on their FIRST save.
            // Creating one from a chapter and then having to go find them
            // would be worse than not offering create at all.
            if (!editorFor.character && !taggedNewRef.current) {
              taggedNewRef.current = true
              await onToggleTag(saved.id, true)
            }
            await onRetry()
          }}
          onDeleted={onRetry}
          onClose={() => setEditorFor(null)}
        />
      )}
    </div>
  )
}
