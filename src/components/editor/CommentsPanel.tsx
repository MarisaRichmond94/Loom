'use client'

import { LuCheck, LuEye, LuEyeOff, LuUnlink } from 'react-icons/lu'

import type { AuthorComment } from './useChapterComments'
import type { CommentsResult } from '@/lib/readerComments'

/**
 * What the family said, where the writing happens (LOOM-135).
 *
 * Two actions, and they are deliberately not the same weight:
 *
 *   Resolve — the author's own bookkeeping. Readers never see it.
 *   Hide    — moderation. It disappears from the reader-facing thread.
 *
 * Hiding is SOFT and stays visible here, marked. Nothing a family member wrote
 * should be destroyable from a panel that sits one click from the manuscript,
 * so there is no delete in this component at all.
 */

const ago = (iso: string): string => {
  const mins = Math.round((Date.now() - new Date(iso).getTime()) / 60000)
  if (mins < 1) return 'just now'
  if (mins < 60) return `${mins} min ago`
  const h = Math.round(mins / 60)
  if (h < 24) return `${h}h ago`
  const d = Math.round(h / 24)
  return d < 30 ? `${d}d ago` : new Date(iso).toLocaleDateString()
}

function CommentRow({
  c,
  onMutate,
  orphan,
}: {
  c: AuthorComment
  onMutate: (id: string, patch: { resolved?: boolean; hidden?: boolean }) => void
  orphan?: boolean
}) {
  return (
    <div
      className={`rounded border px-3 py-2.5 transition-colors ${
        c.hidden
          ? 'bg-surface-overlay border-ink-faint/20 opacity-70'
          : 'bg-surface-raised border-accent/10'
      }`}
    >
      <div className="flex items-center gap-2">
        <span className="text-xs text-ink truncate">{c.authorName}</span>
        <span className="text-[10px] text-ink-faint shrink-0">{ago(c.createdAt)}</span>

        {c.hidden && (
          <span className="text-[9px] uppercase tracking-widest text-ink-faint shrink-0">
            Hidden
          </span>
        )}
        {orphan && (
          <span
            className="flex items-center gap-1 text-[9px] uppercase tracking-widest text-ink-faint shrink-0"
            title="The chapter this was written on is no longer published."
          >
            <LuUnlink size={9} /> Orphaned
          </span>
        )}

        <div className="ml-auto flex items-center gap-0.5 shrink-0">
          <button
            onClick={() => onMutate(c.id, { resolved: !c.resolved })}
            title={c.resolved ? 'Mark unresolved' : 'Mark resolved — only you see this'}
            aria-label={c.resolved ? 'Mark unresolved' : 'Mark resolved'}
            className={`p-1 rounded transition ${
              c.resolved ? 'text-accent' : 'text-ink-faint hover:text-ink'
            }`}
          >
            <LuCheck size={12} />
          </button>
          <button
            onClick={() => onMutate(c.id, { hidden: !c.hidden })}
            title={c.hidden
              ? 'Show to readers again'
              : 'Hide from readers — reversible, nothing is deleted'}
            aria-label={c.hidden ? 'Unhide' : 'Hide from readers'}
            className="p-1 rounded text-ink-faint hover:text-ink transition"
          >
            {c.hidden ? <LuEyeOff size={12} /> : <LuEye size={12} />}
          </button>
        </div>
      </div>

      <p className="mt-1.5 text-xs text-ink leading-relaxed whitespace-pre-wrap">{c.body}</p>

      {c.publishedAt && (
        // Which snapshot they were reading. A comment written before a revision
        // is historical, not wrong, and without this it reads as the latter.
        <p className="mt-1.5 text-[10px] text-ink-faint">
          on the {new Date(c.publishedAt).toLocaleDateString()} version
        </p>
      )}
    </div>
  )
}

export default function CommentsPanel({
  data,
  loading,
  mutate,
}: {
  data: CommentsResult | null
  loading: boolean
  mutate: (id: string, patch: { resolved?: boolean; hidden?: boolean }) => void
}) {
  if (loading && !data) {
    return <p className="p-4 text-xs text-ink-faint italic">Loading…</p>
  }

  // A fresh checkout has never run the reader tier. Saying so beats an empty
  // list, which would read as "nobody has said anything".
  if (!data?.available) {
    return (
      <p className="p-4 text-xs text-ink-faint italic leading-relaxed">
        No reader database yet — comments appear here once the reader tier is set up
        and someone has read a chapter.
      </p>
    )
  }

  const { chapter, orphaned } = data

  if (chapter.length === 0 && orphaned.length === 0) {
    return (
      <p className="p-4 text-xs text-ink-faint italic leading-relaxed">
        Nothing on this chapter yet. Comments arrive when a reader finishes it.
      </p>
    )
  }

  return (
    <div className="p-3 flex flex-col gap-4 overflow-y-auto">
      {chapter.length > 0 && (
        <div className="flex flex-col gap-2">
          {chapter.map(c => <CommentRow key={c.id} c={c} onMutate={mutate} />)}
        </div>
      )}

      {orphaned.length > 0 && (
        <div className="flex flex-col gap-2">
          {/* Surfaced rather than dropped. These belong to chapters readers can
              no longer reach — deleting someone's reaction because a scene was
              revised is the wrong default. */}
          <p className="text-[10px] uppercase tracking-widest text-ink-faint">
            On chapters no longer published ({orphaned.length})
          </p>
          {orphaned.map(c => <CommentRow key={c.id} c={c} onMutate={mutate} orphan />)}
        </div>
      )}
    </div>
  )
}
