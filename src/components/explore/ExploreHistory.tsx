'use client'

import { useMemo, useState } from 'react'
import { LuMessageSquare, LuTrash2, LuChevronLeft, LuPanelLeft } from 'react-icons/lu'

// Chat history, shared with WriteAI (LOOM-116).
//
// ── Why a rail, not a sidebar ───────────────────────────────────────────────
//
// Loom's sidebar is spoken for, which is what made this a design problem. A
// permanent ~250px history column would cost the conversation a quarter of its
// width to display a list consulted occasionally. So it collapses to a narrow
// rail carrying a count, and expands OVER the message list rather than pushing
// it — reading width never changes.
//
// ── Why every row carries a scope chip ──────────────────────────────────────
//
// This falls straight out of sharing history with WriteAI. The list mixes a
// thread asked on the book-3 page (books 1-3), one asked on the series page
// (all five), and one asked in WriteAI (whatever was selected there). Those are
// NOT the same question, and reopening one without restoring its scope silently
// changes what the model can see — on a book page, possibly widening it past
// the spoiler boundary the whole feature enforces.

export type SessionSummary = {
  id: string
  question: string
  timestamp: string
  mode?: string
  messageCount?: number
  loomScope?: { seriesId: string; bookId: string | null; label: string; bookIds: string[] }
}

function groupOf(iso: string): string {
  const then = new Date(iso)
  if (Number.isNaN(then.getTime())) return 'Earlier'
  const now = new Date()
  const sameDay = then.toDateString() === now.toDateString()
  if (sameDay) return 'Today'
  const yesterday = new Date(now)
  yesterday.setDate(now.getDate() - 1)
  return then.toDateString() === yesterday.toDateString() ? 'Yesterday' : 'Earlier'
}

function shortTime(iso: string): string {
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return ''
  const sameDay = d.toDateString() === new Date().toDateString()
  return sameDay
    ? d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })
    : d.toLocaleDateString([], { month: 'short', day: 'numeric' })
}

function DeleteDialog({
  session, onCancel, onConfirm,
}: {
  session: SessionSummary
  onCancel: () => void
  onConfirm: () => void
}) {
  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center">
      <div className="absolute inset-0 bg-black/60" onClick={onCancel} />
      <div className="relative w-80 rounded-xl border border-accent/20 bg-surface-raised px-6 py-5 shadow-2xl">
        <h3 className="text-sm font-semibold text-ink">Delete chat</h3>
        <p className="mt-2 text-xs leading-relaxed text-ink-muted">
          “{session.question.slice(0, 80)}{session.question.length > 80 ? '…' : ''}”
        </p>
        <p className="mt-2 text-xs leading-relaxed text-ink-faint">
          This deletes it in WriteAI too — the history is shared. It cannot be undone.
        </p>
        <div className="mt-4 flex justify-end gap-2">
          <button type="button" onClick={onCancel}
            className="rounded-md px-3 py-1.5 text-xs text-ink-muted transition-colors hover:bg-surface-overlay">
            Cancel
          </button>
          <button type="button" onClick={onConfirm}
            className="rounded-md bg-choice-kill-bg px-3 py-1.5 text-xs font-medium text-choice-kill ring-1 ring-choice-kill-border transition-colors hover:brightness-125">
            Delete
          </button>
        </div>
      </div>
    </div>
  )
}

export default function ExploreHistory({
  sessions, activeId, open, onToggle, onSelect, onDelete, loading,
}: {
  sessions: SessionSummary[]
  activeId: string | null
  open: boolean
  onToggle: (open: boolean) => void
  onSelect: (id: string) => void
  onDelete: (id: string) => void
  loading: boolean
}) {
  const [pendingDelete, setPendingDelete] = useState<SessionSummary | null>(null)
  const [query, setQuery] = useState('')

  const groups = useMemo(() => {
    const q = query.trim().toLowerCase()
    const filtered = q
      ? sessions.filter(s => s.question.toLowerCase().includes(q))
      : sessions
    const out: { label: string; items: SessionSummary[] }[] = []
    for (const s of filtered) {
      const label = groupOf(s.timestamp)
      const last = out[out.length - 1]
      if (last?.label === label) last.items.push(s)
      else out.push({ label, items: [s] })
    }
    return out
  }, [sessions, query])

  return (
    <>
      {/* Rail — always present, so the drawer has somewhere to come from. */}
      <div className="flex w-11 shrink-0 flex-col items-center gap-2 border-r border-accent/10 bg-surface-base py-2.5">
        <button
          type="button"
          onClick={() => onToggle(!open)}
          title={open ? 'Hide chat history' : 'Chat history'}
          aria-label={`Chat history, ${sessions.length} threads`}
          aria-expanded={open}
          className="relative flex h-8 w-8 items-center justify-center rounded-md text-ink-faint transition-colors hover:bg-surface-overlay hover:text-ink"
        >
          <LuPanelLeft size={15} />
          {sessions.length > 0 && (
            <span className="absolute -right-1 -top-1 grid h-4 min-w-[16px] place-items-center rounded-full bg-accent px-1 text-[9px] font-bold tabular-nums text-white">
              {sessions.length > 99 ? '99+' : sessions.length}
            </span>
          )}
        </button>
      </div>

      {/* Drawer — overlays the message list rather than pushing it, so the
          reading width of an answer never changes as history opens. */}
      {open && (
        <div className="absolute bottom-0 left-11 top-0 z-40 flex w-64 flex-col border-r border-accent/15 bg-surface-base shadow-[10px_0_24px_-12px_rgba(0,0,0,0.3)]">
          <div className="flex items-center justify-between border-b border-accent/10 px-3 py-2.5">
            <p className="text-[10px] font-semibold uppercase tracking-widest text-ink-faint">
              Chat history
            </p>
            <button
              type="button"
              onClick={() => onToggle(false)}
              aria-label="Collapse history"
              className="rounded p-1 text-ink-faint transition-colors hover:bg-surface-overlay hover:text-ink"
            >
              <LuChevronLeft size={13} />
            </button>
          </div>

          <div className="px-2.5 pb-1 pt-2">
            <input
              type="search"
              value={query}
              onChange={e => setQuery(e.target.value)}
              placeholder="Search chats…"
              aria-label="Search chats"
              className="w-full rounded-md border border-accent/20 bg-surface-raised px-2.5 py-1.5 text-xs text-ink placeholder:text-ink-faint focus:border-accent focus:outline-none"
            />
          </div>

          {/* `overscroll-contain` — reaching the end of the thread list must
              not hand the wheel to the page behind the drawer. */}
          <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain pb-3">
            {loading ? (
              <p className="px-3 py-3 text-xs text-ink-faint">Loading…</p>
            ) : groups.length === 0 ? (
              <p className="px-3 py-3 text-xs leading-relaxed text-ink-faint">
                {query ? 'No chats match that.' : 'No chats yet. Ask something to start one.'}
              </p>
            ) : groups.map(group => (
              <div key={group.label}>
                <p className="px-3 pb-1 pt-3 text-[9.5px] font-semibold uppercase tracking-widest text-ink-faint">
                  {group.label}
                </p>
                {group.items.map(s => {
                  const isActive = s.id === activeId
                  return (
                    <div
                      key={s.id}
                      role="button"
                      tabIndex={0}
                      onClick={() => onSelect(s.id)}
                      onKeyDown={e => {
                        if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onSelect(s.id) }
                      }}
                      aria-current={isActive}
                      className={`group relative cursor-pointer border-l-2 px-3 py-2 transition-colors ${
                        isActive
                          ? 'border-accent bg-accent/10'
                          : 'border-transparent hover:bg-surface-overlay'
                      }`}
                    >
                      <p className="line-clamp-2 pr-5 text-xs text-ink" title={s.question}>
                        {s.question}
                      </p>
                      <div className="mt-1 flex flex-wrap items-center gap-1.5">
                        {/* The scope chip. Not decoration — see the header. */}
                        <span className="rounded border border-accent/40 px-1.5 text-[9.5px] text-accent">
                          {s.loomScope?.label ?? 'Series'}
                        </span>
                        {!s.loomScope && (
                          <span
                            className="rounded border border-dashed border-accent/25 px-1.5 text-[9.5px] text-ink-faint"
                            title="Asked in WriteAI — its book selection is not recorded, so this reopens at this page's scope"
                          >
                            WriteAI
                          </span>
                        )}
                        <span className="ml-auto text-[9.5px] tabular-nums text-ink-faint">
                          {shortTime(s.timestamp)}
                        </span>
                      </div>
                      <button
                        type="button"
                        onClick={e => { e.stopPropagation(); setPendingDelete(s) }}
                        aria-label="Delete chat"
                        className="absolute right-1.5 top-1.5 rounded p-1 text-ink-faint opacity-0 transition-opacity hover:text-choice-kill group-hover:opacity-100"
                      >
                        <LuTrash2 size={11} />
                      </button>
                    </div>
                  )
                })}
              </div>
            ))}
          </div>

          <p className="flex items-center gap-1.5 border-t border-accent/10 px-3 py-2 text-[9.5px] leading-relaxed text-ink-faint">
            <LuMessageSquare size={10} className="shrink-0" />
            Shared with WriteAI
          </p>
        </div>
      )}

      {pendingDelete && (
        <DeleteDialog
          session={pendingDelete}
          onCancel={() => setPendingDelete(null)}
          onConfirm={() => { onDelete(pendingDelete.id); setPendingDelete(null) }}
        />
      )}
    </>
  )
}
