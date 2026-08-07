'use client'

import { useEffect, useState } from 'react'
import { LuMessageSquare, LuTrash2, LuChevronDown, LuChevronUp } from 'react-icons/lu'
import { NOT_YET_NOTICE, PACE_NUDGE } from '@/shared/commentGate'
import type { CommentView } from '@/lib/comments'
import { api } from '@/lib/basePath'

/**
 * The chapter's discussion (LOOM-134).
 *
 * Everything here is placement discipline. It sits BELOW the end of the prose,
 * collapsed, so opening it is a deliberate act rather than something the eye
 * catches while reading the last paragraph. Nothing about it appears in the
 * header, the catalog, or the Continue Reading card.
 *
 * When the viewer has not finished the chapter they get one line and no count.
 * "7 comments" is itself a spoiler — it says something happens here — so the
 * gated state is deliberately uninformative.
 */

const ago = (iso: string): string => {
  const mins = Math.round((Date.now() - new Date(iso).getTime()) / 60000)
  if (mins < 1) return 'just now'
  if (mins < 60) return `${mins} min ago`
  const h = Math.round(mins / 60)
  if (h < 24) return `${h} hour${h === 1 ? '' : 's'} ago`
  const d = Math.round(h / 24)
  if (d < 30) return `${d} day${d === 1 ? '' : 's'} ago`
  return new Date(iso).toLocaleDateString()
}

export default function CommentThread({
  bookId,
  chapterId,
  comments: incoming,
}: {
  bookId: string
  chapterId: string
  /** Null means the viewer has not finished this chapter. */
  comments: CommentView[] | null
}) {
  // Owned by the parent, which re-asks the server the moment the chapter is
  // finished; mirrored locally so posting and deleting stay instant.
  const [comments, setComments] = useState<CommentView[] | null>(incoming)
  const [open, setOpen] = useState(false)
  useEffect(() => { setComments(incoming) }, [incoming])
  const [draft, setDraft] = useState('')
  const [busy, setBusy] = useState(false)

  // Gated: one quiet line, no count, no affordance to open.
  if (comments === null) {
    return (
      <div className="mt-16 border-t border-accent/10 pt-6">
        <p className="text-sm text-ink-faint italic text-center">{NOT_YET_NOTICE}</p>
      </div>
    )
  }

  async function submit() {
    const body = draft.trim()
    if (!body || busy) return
    setBusy(true)
    const res = await fetch(api('/api/comments'), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ bookId, chapterId, body }),
    })
    setBusy(false)
    if (!res.ok) return
    const data = await res.json() as { comments: CommentView[] }
    setComments(data.comments)
    setDraft('')
  }

  async function remove(id: string) {
    const res = await fetch(api(`/api/comments?id=${encodeURIComponent(id)}`), { method: 'DELETE' })
    if (res.ok) setComments(cs => (cs ?? []).filter(c => c.id !== id))
  }

  return (
    <div className="mt-16 border-t border-accent/10 pt-6">
      <button
        onClick={() => setOpen(o => !o)}
        className="flex items-center gap-2 text-sm text-ink-muted hover:text-accent transition"
      >
        <LuMessageSquare size={14} />
        {comments.length === 0
          ? 'Leave a comment'
          : `${comments.length} comment${comments.length === 1 ? '' : 's'}`}
        {open ? <LuChevronUp size={14} /> : <LuChevronDown size={14} />}
      </button>

      {open && (
        <div className="mt-5 flex flex-col gap-4">
          {comments.map(c => (
            <div key={c.id} className="rounded-lg bg-surface-raised border border-accent/10 px-4 py-3">
              <div className="flex items-center gap-2">
                <span className="text-sm text-ink">{c.authorName}</span>
                <span className="text-xs text-ink-faint">{ago(c.createdAt)}</span>
                {c.onOlderVersion && (
                  <span
                    className="text-[10px] uppercase tracking-widest text-ink-faint"
                    title="This chapter has been revised since this was written."
                  >
                    earlier draft
                  </span>
                )}
                {c.mine && (
                  <button
                    onClick={() => void remove(c.id)}
                    aria-label="Delete your comment"
                    className="ml-auto p-1 rounded text-ink-faint hover:text-ink transition"
                  >
                    <LuTrash2 size={12} />
                  </button>
                )}
              </div>
              <p className="mt-2 text-sm text-ink leading-relaxed whitespace-pre-wrap">{c.body}</p>
            </div>
          ))}

          <div className="flex flex-col gap-2">
            <textarea
              value={draft}
              onChange={e => setDraft(e.target.value)}
              rows={3}
              placeholder="What did you think?"
              className="w-full px-3 py-2 rounded-lg bg-surface-overlay border border-accent/20 text-sm text-ink resize-y focus:outline-none focus:border-accent/50"
            />
            <div className="flex items-center gap-3">
              {/* Social convention does most of the work in a three-person
                  audience. It just needs saying once, where it applies. */}
              <p className="flex-1 text-xs text-ink-faint italic">{PACE_NUDGE}</p>
              <button
                onClick={() => void submit()}
                disabled={!draft.trim() || busy}
                className="shrink-0 px-4 py-2 rounded bg-accent/15 border border-accent/30 text-accent text-sm font-medium transition hover:bg-accent/25 disabled:opacity-40 disabled:pointer-events-none"
              >
                {busy ? 'Posting…' : 'Post'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
