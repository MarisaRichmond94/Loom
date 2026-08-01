'use client'

import { CharacterAvatar, characterPhotoHref } from './CharacterAvatar'
import type { WriterCharacter, WriterCharacterRelationship } from '@/lib/characterSearch'

// A character's relationships, as a bordered table (LOOM-33).
//
// Shared by the Characters tab's expanded card and — once LOOM-46 lands — the
// character modal, so the two cannot drift into showing the same nine
// relationships differently.

/** Row height in px. The container shows 5.5 of them: the half row is the
 *  affordance — a clean cut at five looks like the list ENDS at five, while a
 *  sliced sixth says "keep going" without needing a scrollbar to be visible. */
const ROW_PX = 44
export const RELATIONSHIP_VIEWPORT_PX = Math.round(ROW_PX * 5.5)

export function RelationshipList({
  relationships,
  /** The character pool, for portraits. */
  pool,
  onAdd,
}: {
  relationships: WriterCharacterRelationship[]
  pool: WriterCharacter[]
  onAdd?: () => void
}) {
  // Relationships point at a character by NAME, not by id — the thing LOOM-45
  // is migrating. Looking the portrait up by name works today (every target
  // resolves) and degrades to initials when it does not, which is also what
  // will happen for any target that stops resolving after a rename.
  const photoByName = new Map(pool.map(c => [c.name, characterPhotoHref(c.photo_url)]))

  return (
    <div>
      <div className="flex items-baseline justify-between">
        <p className="text-[9px] font-semibold uppercase tracking-widest text-ink-faint">
          Relationships{relationships.length > 0 && ` (${relationships.length})`}
        </p>
        {onAdd && (
          <button
            type="button"
            onClick={onAdd}
            className="text-[10px] text-ink-faint transition hover:text-accent"
          >
            + Add Relationship
          </button>
        )}
      </div>

      {relationships.length === 0 ? (
        <p className="mt-1.5 rounded-lg border border-accent/15 bg-surface-overlay/40 px-3 py-4 text-center text-[11px] italic text-ink-faint">
          No relationships to display
        </p>
      ) : (
        <div
          style={{ maxHeight: RELATIONSHIP_VIEWPORT_PX }}
          className="mt-1.5 overflow-y-auto overscroll-contain rounded-lg border border-accent/15 bg-surface-overlay/40"
        >
          {relationships.map((r, i) => (
            <div
              key={`${r.target}-${r.nature}-${i}`}
              style={{ height: ROW_PX }}
              className={`flex items-center gap-2.5 px-2.5 ${
                i > 0 ? 'border-t border-accent/10' : ''
              }`}
            >
              <CharacterAvatar name={r.target} src={photoByName.get(r.target)} size={26} />
              <div className="min-w-0">
                <div className="truncate text-[11px] font-medium text-ink">{r.target}</div>
                {r.nature && (
                  <div className="truncate text-[10px] italic text-ink-faint">{r.nature}</div>
                )}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
