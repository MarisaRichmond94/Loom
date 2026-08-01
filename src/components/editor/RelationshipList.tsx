'use client'

import { LuX } from 'react-icons/lu'
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
  onRemove,
}: {
  relationships: WriterCharacterRelationship[]
  pool: WriterCharacter[]
  /** Absent in read-only contexts, like the expanded card in the panel. */
  onRemove?: (index: number) => void
}) {
  // Relationships point at a character by `wc-` id (LOOM-45), so both the name
  // and the portrait are derived here. That is what makes a rename reach every
  // relationship pointing at that character instead of orphaning them.
  const byId = new Map(pool.map(c => [c.id, c]))
  const labelOf = (target: string) => byId.get(target)?.name ?? 'Unknown character'

  return (
    <div>
      <p className="text-[9px] font-semibold uppercase tracking-widest text-ink-faint">
        Relationships{relationships.length > 0 && ` (${relationships.length})`}
      </p>

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
              className={`group/rel flex items-center gap-2.5 px-2.5 ${
                i > 0 ? 'border-t border-accent/10' : ''
              }`}
            >
              <CharacterAvatar
                name={labelOf(r.target)}
                src={characterPhotoHref(byId.get(r.target)?.photo_url ?? null)}
                size={26}
              />
              <div className="min-w-0 flex-1">
                <div className="truncate text-[11px] font-medium text-ink">{labelOf(r.target)}</div>
                {r.nature && (
                  <div className="truncate text-[10px] italic text-ink-faint">{r.nature}</div>
                )}
              </div>
              {onRemove && (
                <button
                  type="button"
                  onClick={() => onRemove(i)}
                  title={`Remove ${labelOf(r.target)}`}
                  aria-label={`Remove relationship with ${labelOf(r.target)}`}
                  className="shrink-0 rounded p-1 text-ink-faint opacity-0 transition group-hover/rel:opacity-100 focus:opacity-100 hover:text-red-500"
                >
                  <LuX size={12} />
                </button>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
