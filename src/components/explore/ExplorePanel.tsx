'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import { LuGitBranch, LuPlus } from 'react-icons/lu'

import { ReviewMarkdown } from '@/components/editor/reviewMarkdown'
import { useSectionActionSlot } from '@/components/SectionTabs'
import { createPortal } from 'react-dom'

import ExploreChapterViewer from './ExploreChapterViewer'
import ExploreComposer, { type ModelOption } from './ExploreComposer'
import ExploreFilterBar from './ExploreFilterBar'
import ExploreHistory, { type SessionSummary } from './ExploreHistory'
import ExploreSources from './ExploreSources'
import ExploreStalenessBanner from './ExploreStalenessBanner'
import { useExploreChat } from './useExploreChat'
import { getCachedScope, prefetchScope, type ScopePayload } from './scopeCache'
import type { Citation, ExploreMode, ExploreSession } from './types'

// The Explore tab (LOOM-114..119).
//
// Loaded on tab open, never with the page — it pulls in the whole chat surface
// and issues the scope read, and neither belongs in the initial payload for
// someone who came for the cast.
//
// ⚠️ THE TAB MOUNTS INERT. The only request on mount is the scope read (a pure
// sqlite read on WriteAI's side) and the model list. Nothing billable happens
// until the writer presses send — no warm-up, no prefetch, no suggested-question
// generation. `_build_bible` runs once per selected book per message, so the
// series page with five books injects five condensed bibles into every prompt;
// the cost per message is not flat, and a stray auto-fire is not cheap.
//
// The scope read itself IS now started ahead of the tab open — the book/series
// page kicks it off on idle (see prefetchScope in scopeCache.ts) so this
// effect usually finds the cache already warm instead of paying the round
// trip after the tab strip has already animated in.

const citationKey = (c: Citation) => `${c.book}__${c.chapter}__${c.chunk_index}`

export default function ExplorePanel({
  seriesId, bookId, bookTitle, fillHeight = false,
}: {
  seriesId: string
  /** null on the series page. */
  bookId: string | null
  bookTitle?: string
  /**
   * Fills the remaining space in the tab's own scroll container instead of
   * a fixed 750px, so the chat window is exactly as tall as what's left on
   * screen rather than a constant that's sometimes too short and sometimes
   * leaves a gap. Opt-in: it only resolves to a real height when the tab
   * strip mounting this is itself in fillHeight mode — see SectionTabs' own
   * `fillHeight` for the other half of this. Both the series page and the
   * book page pass it; a caller whose tab strip is NOT fillHeight would need
   * the fixed 750px instead, since `flex-1` there has no defined height to
   * flex against.
   */
  fillHeight?: boolean
}) {
  const actionSlot = useSectionActionSlot()
  const router = useRouter()

  // Lazy initializers, not `useState(null)` + effect: if the page's idle
  // prefetch already landed by the time this tab mounts (the common case),
  // this renders WITH the real data on the very first paint — no skeleton
  // stage, no resize once the effect below catches up, no flash for the
  // scroll-hold effect in SectionTabs to react to.
  const [scope, setScope] = useState<ScopePayload | null>(() => getCachedScope(seriesId, bookId)?.data ?? null)
  const [scopeState, setScopeState] = useState<'loading' | 'ready' | 'not-analyzed' | 'offline' | 'error'>(
    () => getCachedScope(seriesId, bookId)?.state ?? 'loading',
  )
  const [laterBooks, setLaterBooks] = useState<{ id: string; title: string }[]>([])

  const [selectedBooks, setSelectedBooks] = useState<Set<string>>(new Set())
  const [selectedPovs, setSelectedPovs] = useState<Set<string>>(new Set())
  const [mode, setMode] = useState<ExploreMode>('general')

  const [models, setModels] = useState<ModelOption[]>([])
  const [model, setModel] = useState<string | null>(null)
  const [thorough, setThorough] = useState(false)

  const [input, setInput] = useState('')
  const [historyOpen, setHistoryOpen] = useState(false)
  const [sessions, setSessions] = useState<SessionSummary[]>([])
  const [sessionsLoading, setSessionsLoading] = useState(true)
  const [activeCitation, setActiveCitation] = useState<Citation | null>(null)
  const [chapterLinks, setChapterLinks] = useState<Record<string, string>>({})
  const [scopeNote, setScopeNote] = useState<string | null>(null)

  const streamRef = useRef<HTMLDivElement>(null)

  const scopeLabel = bookId ? (bookTitle ?? 'This book') : 'Series'

  // ── Session persistence ───────────────────────────────────────────────────
  const persist = useCallback(async (session: ExploreSession) => {
    try {
      const res = await fetch('/api/writeai/chat/sessions', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(session),
      })
      if (!res.ok) return
      setSessions(prev => {
        const summary: SessionSummary = {
          id: session.id,
          question: session.question,
          timestamp: session.timestamp,
          mode: session.mode,
          messageCount: session.messages.length,
          loomScope: session.loomScope,
        }
        const rest = prev.filter(s => s.id !== session.id)
        return [summary, ...rest]
      })
    } catch {
      /* the answer already arrived and was paid for; a failed save is not
         worth destroying it over — it surfaces in the list not updating */
    }
  }, [])

  const chat = useExploreChat(persist)

  // ── Scope (pure read; safe on mount) ──────────────────────────────────────
  useEffect(() => {
    let cancelled = false
    prefetchScope(seriesId, bookId).then(({ state, data }) => {
      if (cancelled) return
      setScopeState(state)
      if (data) setScope(data)
    })
    return () => { cancelled = true }
  }, [seriesId, bookId])

  // The books this page will NOT search — shown disabled with a reason rather
  // than omitted, so the list is never silently shorter than the shelf.
  useEffect(() => {
    if (!bookId) { setLaterBooks([]); return }
    let cancelled = false
    prefetchScope(seriesId, null).then(({ data: all }) => {
      if (cancelled || !all?.books || !scope?.books) return
      const allowed = new Set(scope.books.map(b => b.id))
      setLaterBooks(all.books.filter(b => !allowed.has(b.id)).map(b => ({ id: b.id, title: b.title })))
    })
    return () => { cancelled = true }
  }, [seriesId, bookId, scope])

  // ── Models ────────────────────────────────────────────────────────────────
  useEffect(() => {
    let cancelled = false
    fetch('/api/writeai/chat/models')
      .then(r => (r.ok ? r.json() : null))
      .then((d: { models?: ModelOption[]; default?: string | null } | null) => {
        if (cancelled || !d) return
        setModels(d.models ?? [])
        setModel(prev => prev ?? d.default ?? d.models?.[0]?.id ?? null)
      })
      .catch(() => { /* composer shows "WriteAI is unavailable" */ })
    return () => { cancelled = true }
  }, [])

  // ── History list ──────────────────────────────────────────────────────────
  const loadSessions = useCallback(() => {
    setSessionsLoading(true)
    fetch('/api/writeai/chat/sessions')
      .then(r => (r.ok ? r.json() : { sessions: [] }))
      .then((d: { sessions?: SessionSummary[] }) => setSessions(d.sessions ?? []))
      .catch(() => setSessions([]))
      .finally(() => setSessionsLoading(false))
  }, [])
  useEffect(() => { loadSessions() }, [loadSessions])

  // Drop POVs that no longer exist once the book selection narrows.
  useEffect(() => {
    if (selectedPovs.size === 0 || !scope?.povs) return
    const available = new Set(scope.povs.map(p => p.name))
    const still = [...selectedPovs].filter(p => available.has(p))
    if (still.length !== selectedPovs.size) setSelectedPovs(new Set(still))
  }, [scope, selectedPovs])

  // Has the reader taken the scroller over? Once she has, the answer streams in
  // without the view moving — she is reading something further up, and dragging
  // her back to the bottom on every chunk is the whole problem this avoids.
  // Same behaviour as the chapter page's review pane.
  const readerTookOver = useRef(false)

  // Detected from INPUT events, not from watching scrollTop change: CSS scroll
  // anchoring silently adjusts scrollTop as content grows, and those
  // browser-authored `scroll` events are indistinguishable from a real drag.
  // A wheel, a touch drag, a scrollbar grab or an arrow key only happen
  // because she did something.
  const takeOver = useCallback(() => { readerTookOver.current = true }, [])

  // Returning to the bottom hands following back — the ordinary chat gesture
  // for "catch me up again". Safe to read scrollTop for: content growing below
  // an unmoved viewport only ever moves her further FROM the bottom, so scroll
  // anchoring cannot fake this.
  const onStreamScroll = useCallback(() => {
    const el = streamRef.current
    if (!el) return
    if (el.scrollHeight - el.clientHeight - el.scrollTop <= 48) readerTookOver.current = false
  }, [])

  // A new turn — a send, or a thread opened from history — starts pinned again.
  const userTurns = chat.messages.filter(m => m.role === 'user').length
  useEffect(() => { readerTookOver.current = false }, [userTurns, chat.sessionId])

  // Keep the conversation pinned to the newest message by moving ITS OWN
  // scrollTop — never `scrollIntoView`, which walks every scrollable ancestor
  // and therefore scrolled the whole book page. That was the jump when opening
  // a chat from history: the messages changed, and the page went with them.
  //
  // `smooth` only while streaming, where it reads as the answer arriving.
  // Loading a thread should land already at the bottom, not animate there.
  useEffect(() => {
    const el = streamRef.current
    if (!el || readerTookOver.current) return
    el.scrollTo({
      top: el.scrollHeight,
      behavior: chat.isStreaming ? 'smooth' : 'auto',
    })
  }, [chat.messages, chat.isStreaming])

  // ── Citation → editor links ───────────────────────────────────────────────
  useEffect(() => {
    const cites = chat.messages.flatMap(m => m.citations ?? [])
    if (cites.length === 0) return
    const missing = cites.filter(c => !(`${c.book.toLowerCase()}::${c.chapter}` in chapterLinks))
    if (missing.length === 0) return

    fetch('/api/writeai/chat/chapter-link', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        seriesId,
        citations: missing.map(c => ({ book: c.book, chapter: c.chapter })),
      }),
    })
      .then(r => (r.ok ? r.json() : null))
      .then((d: { links?: Record<string, string> } | null) => {
        if (d?.links) setChapterLinks(prev => ({ ...prev, ...d.links }))
      })
      .catch(() => { /* citations render unlinked, with a reason */ })
  }, [chat.messages, seriesId, chapterLinks])

  const resolveChapterHref = useCallback((c: Citation): string | null => {
    const key = `${c.book.normalize('NFC').replace(/[‘’]/g, "'").trim().toLowerCase()}::${c.chapter}`
    return chapterLinks[key] ?? null
  }, [chapterLinks])

  // Client-side navigation, so leaving for the editor does not tear down and
  // rebuild the whole page (and lose both scroll positions on the way).
  const openChapter = useCallback((c: Citation): (() => void) | null => {
    const href = resolveChapterHref(c)
    return href ? () => router.push(href) : null
  }, [resolveChapterHref, router])

  const bookNumberFor = useCallback((c: Citation): number | null => {
    const norm = (s: string) => s.normalize('NFC').replace(/[‘’]/g, "'").trim().toLowerCase()
    return scope?.books?.find(b => norm(b.title) === norm(c.book))?.writeaiNumber ?? null
  }, [scope])

  // ── Sending ───────────────────────────────────────────────────────────────
  const selectedBookIds = useMemo(() => {
    if (!scope?.books) return []
    const addressable = scope.books.filter(b => b.writeaiNumber !== null)
    return selectedBooks.size === 0
      ? addressable.map(b => b.id)
      : addressable.filter(b => selectedBooks.has(b.id)).map(b => b.id)
  }, [scope, selectedBooks])

  function send() {
    if (!input.trim() || chat.isStreaming) return
    const text = input
    setInput('')
    void chat.send({
      text,
      seriesId,
      bookId,
      bookIds: selectedBookIds,
      povs: [...selectedPovs],
      mode,
      model,
      thorough,
      scopeLabel,
    })
  }

  function newChat() {
    chat.reset()
    setActiveCitation(null)
    setScopeNote(null)
  }

  async function openSession(id: string) {
    setScopeNote(null)
    try {
      const res = await fetch(`/api/writeai/chat/sessions?id=${encodeURIComponent(id)}`)
      if (!res.ok) return
      const { session } = await res.json() as { session: ExploreSession }
      chat.load(session)
      setActiveCitation(null)
      setHistoryOpen(false)

      // Restore the thread's own scope — and clamp it if this page allows less.
      // A thread asked across five books, reopened on the book-3 page, must not
      // silently widen what the next question can see.
      const allowed = new Set((scope?.books ?? []).map(b => b.id))
      const wanted = session.loomScope?.bookIds ?? []
      const kept = wanted.filter(b => allowed.has(b))
      if (wanted.length && kept.length < wanted.length) {
        setScopeNote(
          `This chat was asked across ${wanted.length} books. On this page it is limited to ${kept.length}.`,
        )
      }
      setSelectedBooks(kept.length && kept.length < allowed.size ? new Set(kept) : new Set())
      setSelectedPovs(new Set(session.selectedPovs ?? []))
      setMode(session.mode === 'alternate' ? 'alternate' : 'general')
    } catch {
      /* the list stays; nothing is lost */
    }
  }

  async function deleteSession(id: string) {
    setSessions(prev => prev.filter(s => s.id !== id))
    if (chat.sessionId === id) newChat()
    try {
      await fetch(`/api/writeai/chat/sessions?id=${encodeURIComponent(id)}`, { method: 'DELETE' })
    } catch {
      loadSessions()   // put it back if the delete did not land
    }
  }

  // ── Degraded states ───────────────────────────────────────────────────────
  if (scopeState === 'offline') {
    return (
      <p className="rounded-lg border border-accent/15 bg-surface-raised px-4 py-6 text-center text-sm text-ink-muted">
        WriteAI isn’t running, so there’s nothing to ask yet.
      </p>
    )
  }
  if (scopeState === 'not-analyzed') {
    return (
      <p className="rounded-lg border border-accent/15 bg-surface-raised px-4 py-6 text-center text-sm text-ink-muted">
        WriteAI hasn’t analysed {bookId ? 'this book' : 'this series'} yet. Export
        the canon and run a sync, then come back.
      </p>
    )
  }
  if (scopeState === 'error') {
    return (
      <p className="rounded-lg border border-accent/15 bg-surface-raised px-4 py-6 text-center text-sm text-ink-muted">
        Explore couldn’t load. Try again in a moment.
      </p>
    )
  }
  if (scopeState === 'loading' || !scope?.books) return null   // the tab's skeleton covers this

  const bookNumbers = scope.books.map(b => b.writeaiNumber).filter((n): n is number => n !== null)
  const bookIdsByNumber = new Map(
    scope.books.filter(b => b.writeaiNumber !== null).map(b => [b.writeaiNumber as number, b.id]),
  )

  return (
    <>
      {/* "New chat" lives in the tab strip's action slot — the same slot the
          outline's Add button uses, so nothing new is introduced to the page. */}
      {actionSlot && createPortal(
        // Styled as the strip's other action buttons ("Add Character", "Add
        // Event") rather than as its own thing — same classes, same LuPlus,
        // same "Add X" wording. A header control that looks different from its
        // neighbours reads as a different KIND of control.
        <button
          type="button"
          onClick={newChat}
          className="flex items-center gap-1.5 px-3 py-1.5 rounded text-xs bg-accent text-white font-medium hover:opacity-90 transition"
        >
          <LuPlus size={12} /> Add Chat
        </button>,
        actionSlot,
      )}

      <ExploreStalenessBanner
        seriesId={seriesId}
        bookIdsInScope={bookIdsByNumber}
        bookNumbersInScope={bookNumbers}
        onSynced={() => { /* the next question uses the fresh index */ }}
      />

      <div
        className={`relative mt-3 flex overflow-hidden rounded-lg border border-accent/15 bg-surface-raised ${
          fillHeight ? 'min-h-0 flex-1' : 'h-[750px]'
        }`}
      >
        <ExploreHistory
          sessions={sessions}
          activeId={chat.sessionId}
          open={historyOpen}
          onToggle={setHistoryOpen}
          onSelect={openSession}
          onDelete={deleteSession}
          loading={sessionsLoading}
        />

        <div className="flex min-w-0 flex-1 flex-col">
          <ExploreFilterBar
            books={scope.books}
            povs={scope.povs ?? []}
            selectedBooks={selectedBooks}
            selectedPovs={selectedPovs}
            mode={mode}
            onBooks={setSelectedBooks}
            onPovs={setSelectedPovs}
            onMode={setMode}
            laterBooks={laterBooks}
          />

          {scopeNote && (
            <p className="border-b border-accent/10 bg-accent/5 px-4 py-1.5 text-[11px] text-ink-muted">
              {scopeNote}
            </p>
          )}

          <div className="flex min-h-0 flex-1">
            {/* reader-selectable opts the transcript out of the app-wide
                `user-select: none`. On the scroller rather than each bubble, so
                a drag can run across turns — a non-selectable wrapper between
                selectable islands makes selection jump siblings in
                Chromium/WebKit. */}
            <div
              ref={streamRef}
              onScroll={onStreamScroll}
              onWheel={takeOver}
              onTouchMove={takeOver}
              onPointerDown={takeOver}
              onKeyDown={takeOver}
              className="flex min-w-0 flex-1 flex-col overflow-y-auto overscroll-contain px-4 py-4 reader-selectable"
            >
              {chat.messages.length === 0 ? (
                <div className="m-auto max-w-md text-center">
                  <p className="text-sm font-semibold text-ink">
                    Ask about {bookId ? bookTitle ?? 'this book' : 'this series'}
                  </p>
                  <p className="mt-1.5 text-xs leading-relaxed text-ink-faint">
                    Grounded in {scope.books.filter(b => b.writeaiNumber !== null).map(b => b.title).join(', ')}
                    {bookId ? ' — nothing later can leak in.' : '.'}
                  </p>
                </div>
              ) : (
                <div className="flex flex-col gap-4">
                  {chat.messages.map(m => (
                    m.role === 'user' ? (
                      <div key={m.id} className="self-end max-w-[75%] rounded-xl rounded-br-sm bg-surface-overlay px-3.5 py-2">
                        <p className="whitespace-pre-wrap text-[15px] text-ink">{m.content}</p>
                      </div>
                    ) : (
                      <div key={m.id} className="max-w-[92%] self-start">
                        {m.mode === 'alternate' && !m.starved && (
                          // Speculation must be unmistakable. A what-if answer
                          // that reads like canon is the one genuinely
                          // dangerous thing this tab can produce.
                          <p className="mb-1 flex items-center gap-1 text-[9px] font-bold uppercase tracking-widest text-accent">
                            <LuGitBranch size={9} /> Speculation — not canon
                          </p>
                        )}
                        <div className={
                          m.mode === 'alternate' && !m.starved
                            ? 'border-l-2 border-accent pl-3 text-[15px] leading-relaxed text-ink-muted italic'
                            : 'text-[15px] leading-relaxed text-ink'
                        }>
                          {m.content
                            ? <ReviewMarkdown text={m.content} />
                            : <span className="text-ink-faint">Thinking…</span>}
                        </div>

                        {!m.isStreaming && m.citations && (
                          <ExploreSources
                            citations={m.citations}
                            answer={m.content}
                            activeKey={activeCitation ? citationKey(activeCitation) : null}
                            onOpen={c => setActiveCitation(prev =>
                              prev && citationKey(prev) === citationKey(c) ? null : c)}
                            onOpenChapterHref={openChapter}
                          />
                        )}

                        {(m.costUsd != null || m.model) && (
                          <p className="mt-2 flex gap-3 text-[10px] tabular-nums text-ink-faint">
                            {m.model && <span>{m.model}</span>}
                            {m.costUsd != null && <span>${m.costUsd.toFixed(3)}</span>}
                          </p>
                        )}
                      </div>
                    )
                  ))}
                </div>
              )}

              {chat.error && (
                <p className="mt-3 rounded-md border border-choice-kill-border bg-choice-kill-bg px-3 py-2 text-xs text-choice-kill">
                  {chat.error}
                </p>
              )}
            </div>

            {activeCitation && (
              <div className="w-[38%] shrink-0">
                <ExploreChapterViewer
                  citation={activeCitation}
                  bookNumber={bookNumberFor(activeCitation)}
                  editorHref={resolveChapterHref(activeCitation)}
                  onClose={() => setActiveCitation(null)}
                />
              </div>
            )}
          </div>

          <ExploreComposer
            value={input}
            onChange={setInput}
            onSend={send}
            onStop={chat.stop}
            isStreaming={chat.isStreaming}
            disabled={false}
            models={models}
            model={model}
            onModel={setModel}
            thorough={thorough}
            onThorough={setThorough}
            placeholder={bookId
              ? `Ask about ${bookTitle ?? 'this book'} and what came before…`
              : 'Ask about the series…'}
          />
        </div>
      </div>
    </>
  )
}
