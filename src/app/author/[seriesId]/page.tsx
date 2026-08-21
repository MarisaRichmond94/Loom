'use client'

import { useEffect, useState, useCallback, useRef } from 'react'
import { createPortal } from 'react-dom'
import { useParams, useRouter, useSearchParams } from 'next/navigation'
import { LuCheck, LuDatabaseBackup, LuEye, LuMenu, LuPencilLine, LuPlus, LuSend, LuSettings, LuX } from 'react-icons/lu'
import dynamic from 'next/dynamic'
import { useAuthor } from '@/lib/authorContext'
import { useDocumentTitle } from '@/lib/useDocumentTitle'
import { bookStats } from '@/lib/bookStats'
import { useClickOutside } from '@/components/editor/AnchoredPopover'
import SectionTabs, { useSectionActionSlot } from '@/components/SectionTabs'
import PublishBadge from '@/components/series/PublishBadge'
import { usePublishStatus } from '@/components/series/usePublishStatus'
import SilentChaptersDialog, { type SilentChapter } from '@/components/series/SilentChaptersDialog'
import SeriesConfigureModal from '@/components/series/SeriesConfigureModal'
import { useRegisterShortcuts, type ShortcutGroup } from '@/lib/shortcuts'

// Both loaded on tab open rather than with the page. Books is the default tab,
// so most visits need neither — and the timeline pulls in the chart's SVG
// machinery, which has no business in the bundle for someone opening a book.
const SeriesCharactersSection = dynamic(
  () => import('@/components/series/SeriesCharactersSection'),
  { ssr: false },
)
const TimelineSection = dynamic(() => import('@/components/timeline/TimelineSection'), {
  ssr: false,
})
// Same treatment, for a sharper reason: the panel pulls in the whole chat
// surface AND issues its scope read on mount. Neither belongs in the payload
// for someone who came to open a book (LOOM-118).
const ExplorePanel = dynamic(() => import('@/components/explore/ExplorePanel'), {
  ssr: false,
  loading: () => <ExplorePanelSkeleton fillHeight />,
})
// Same treatment again: the ledger walks the whole series on mount. Cheap
// (milliseconds, and a pure read) but there is no reason to pay for it on
// behalf of someone who came to open a book.
const ReachabilityLedger = dynamic(() => import('@/components/series/ReachabilityLedger'), {
  ssr: false,
})
import ExplorePanelSkeleton from '@/components/editor/ExplorePanelSkeleton'
import { prefetchScope } from '@/components/explore/scopeCache'
import { prefetchSeriesCharacters } from '@/components/series/seriesCharactersCache'
import { prefetchSeriesEvents, useSeriesEvents } from '@/components/timeline/useBookEvents'
import { prefetchTimelineData } from '@/components/timeline/timelineDataCache'

/**
 * The series Timeline tab.
 *
 * A component rather than inline JSX because it needs a hook, and only the
 * active tab mounts — calling useSeriesEvents in the page body would fetch the
 * series' tags for everyone who came to open a book.
 *
 * It passes `appearances` but NOT `eventIds`: the series timeline shows every
 * event, tagged or not. The tags are here only so branch-only events can be
 * badged and filtered (LOOM-107), which needs series-wide scope to be correct —
 * an event branch-only in book 2 and canon in book 4 is canon here.
 */
function SeriesTimelineTab({ seriesId }: { seriesId: string }) {
  const { appearances, refresh } = useSeriesEvents(seriesId)
  return (
    <TimelineSection
      id="series"
      seriesId={seriesId}
      appearances={appearances}
      onEventCreated={() => refresh()}
    />
  )
}

/**
 * A book's status as ONE value (LOOM-140).
 *
 * Stored as two booleans, which stays true — the collapse is lossless (no book
 * has ever been both) and keeping the columns means no migration and no change
 * to the PATCH endpoint. This type is the vocabulary the UI thinks in.
 */
type BookStatus = 'draft' | 'inProgress' | 'published'

/**
 * IN PROGRESS WINS, matching the chips this replaced exactly.
 *
 * The old card rendered `inProgress ? 'In progress' : !published && 'Draft'`,
 * so a book flagged BOTH showed as In progress. The three states are meant to
 * be exclusive now and the real series has no such book — but the sandbox
 * fixture does, and reading `published` first would silently relabel it. A
 * display rule that changes what an existing row means is not a refactor.
 *
 * Storage self-corrects on the next edit: choosing any option writes both
 * booleans, so a both-set row resolves the moment it is touched.
 */
const statusOf = (book: { published: boolean; inProgress: boolean }): BookStatus =>
  book.inProgress ? 'inProgress' : book.published ? 'published' : 'draft'

/**
 * "Add Book", portalled into the tab strip's action slot (same convention as
 * "Add Event"/"Add card") — moved here from the sidebar's OutlineTree so
 * adding a book lives beside the rest of the Book(s) tab's actions instead of
 * a control fixed to the bottom of the outline.
 */
function AddBookButton({ onAdd }: { onAdd: (title: string) => Promise<void> }) {
  const actionSlot = useSectionActionSlot()
  const [adding, setAdding] = useState(false)
  const [title, setTitle] = useState('')

  function cancel() {
    setAdding(false)
    setTitle('')
  }

  function submit(e: React.FormEvent) {
    e.preventDefault()
    const trimmed = title.trim()
    if (!trimmed) return
    void onAdd(trimmed)
    cancel()
  }

  if (!actionSlot) return null

  return createPortal(
    adding ? (
      <form onSubmit={submit} className="flex items-center gap-1">
        <input
          autoFocus
          value={title}
          onChange={e => setTitle(e.target.value)}
          onKeyDown={e => e.key === 'Escape' && cancel()}
          placeholder="Title…"
          className="bg-surface-base border border-accent/20 rounded px-2 py-1 text-xs text-ink outline-none focus:border-accent"
        />
        <button type="submit" className="text-accent px-1 py-1"><LuCheck size={13} /></button>
        <button type="button" onClick={cancel} className="text-ink-faint px-1 py-1"><LuX size={13} /></button>
      </form>
    ) : (
      <button
        type="button"
        onClick={() => setAdding(true)}
        className="flex items-center gap-1.5 rounded bg-accent px-3 py-1.5 text-xs font-medium text-white transition hover:opacity-90"
      >
        <LuPlus size={12} /> Add Book
      </button>
    ),
    actionSlot,
  )
}

// Published to the header's shortcut menu while this page is mounted. Module
// level so the identity is stable across renders (it's an effect dependency).
const SERIES_SHORTCUTS: ShortcutGroup[] = [
  {
    group: 'Series',
    items: [
      { keys: '⌥⇧U', label: 'Duplicate series in new tab' },
    ],
  },
]

export default function AuthorSeriesPage() {
  const { seriesId } = useParams() as { seriesId: string }
  const router = useRouter()
  // ?tab=<id> opens the page on a named tab. Only set by links that mean it —
  // the chapter banner's "Show all issues" — so the plain series URL keeps
  // opening on Book(s) as LOOM-111 intended.
  const tabParam = useSearchParams()?.get('tab') ?? undefined
  const { series, loadSeries, addBook } = useAuthor()
  useDocumentTitle(series.title)
  const [titleDraft, setTitleDraft] = useState(series.title)
  const [descriptionDraft, setDescriptionDraft] = useState(series.description ?? '')
  const [authorName, setAuthorName] = useState('')
  const [deleteTarget, setDeleteTarget] = useState<{ id: string; title: string } | null>(null)
  // Series actions menu (LOOM-142): the same ☰ pattern as the book page's
  // "Book actions" menu, absorbing what used to be standalone Backup/Preview
  // buttons plus a new Configure entry for genres/keywords.
  const [actionMenuOpen, setActionMenuOpen] = useState(false)
  const actionMenuRef = useRef<HTMLDivElement>(null)
  useClickOutside([actionMenuRef], () => setActionMenuOpen(false), actionMenuOpen)
  const [configureOpen, setConfigureOpen] = useState(false)

  // ⌥⇧U — open the current URL in a new tab.
  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      if (!e.altKey || !e.shiftKey || e.code !== 'KeyU') return
      e.preventDefault()
      window.open(window.location.href, '_blank')
    }
    document.addEventListener('keydown', handleKeyDown)
    return () => document.removeEventListener('keydown', handleKeyDown)
  }, [])

  useRegisterShortcuts('series', SERIES_SHORTCUTS)

  // Reader-tier state, per book (LOOM-129). Lives here rather than in a panel
  // because the controls sit ON the book cards: publishing is a per-book act,
  // and "can my family read this?" is read while looking at the book.
  const publish = usePublishStatus(seriesId)

  // Silent-chapter check (LOOM-136). Runs when Republish is PRESSED, not on
  // page load: it is a question about this action, and the series page should
  // not carry a permanent warning for something the nightly sweep usually
  // fixes on its own.
  const [silent, setSilent] = useState<{ bookId: string; chapters: SilentChapter[] } | null>(null)

  const publishWithCheck = useCallback(async (bookId: string) => {
    try {
      const res = await fetch(`/api/narration/backfill?seriesId=${seriesId}&bookId=${bookId}`)
      const data = res.ok ? await res.json() as { chapters?: SilentChapter[] } : null
      if (data?.chapters?.length) {
        setSilent({ bookId, chapters: data.chapters })
        return
      }
    } catch {
      // The check is a courtesy. If it cannot run, publishing should still
      // work — refusing to publish because a warning failed would be worse
      // than publishing without the warning.
    }
    void publish.publish(bookId)
  }, [seriesId, publish])

  // Unreachable branches per book, for the badge on each book card (LOOM-122).
  //
  // Fetched here rather than lifted out of the Paths tab: the whole point of
  // the badge is to be seen by someone who never opens that tab. It is a pure
  // read and it fails silently — a badge that cannot load is a missing badge,
  // never an error on a page that is mostly about something else.
  const [deadByBook, setDeadByBook] = useState<Record<string, number>>({})
  useEffect(() => {
    let cancelled = false
    fetch(`/api/series/${seriesId}/reachability`)
      .then(r => (r.ok ? r.json() : null))
      .then(d => { if (!cancelled && d?.summary) setDeadByBook(d.summary.deadByBook ?? {}) })
      .catch(() => {})
    return () => { cancelled = true }
  }, [seriesId])
  useEffect(() => { setTitleDraft(series.title) }, [series.title])
  useEffect(() => { setDescriptionDraft(series.description ?? '') }, [series.description])
  useEffect(() => { setAuthorName(localStorage.getItem('loom-author-name') ?? '') }, [])

  // Warms Characters, Timeline, and Explore's own data (and JS chunks) after
  // the page's own load has settled, so opening any of them usually finds
  // its content already there instead of popping in after the tab strip has
  // already animated — see SectionTabs' height-pin/scroll-hold effects,
  // which only cover a switch's SYNCHRONOUS part, not data that lands later.
  // Idle rather than immediate: this page's own fetches above should not
  // compete with three tabs the writer may never open.
  useEffect(() => {
    const idle = window.requestIdleCallback
    const cancel = window.cancelIdleCallback
    const warm = () => {
      void prefetchSeriesCharacters(seriesId)
      void prefetchSeriesEvents(seriesId)
      void prefetchTimelineData()
      void prefetchScope(seriesId, null)
      void import('@/components/series/SeriesCharactersSection')
      void import('@/components/timeline/TimelineSection')
      void import('@/components/explore/ExplorePanel')
    }
    if (idle) {
      const handle = idle(warm)
      return () => cancel?.(handle)
    }
    // Safari has no requestIdleCallback. A short timer is the same intent:
    // after the paint that matters, not during it.
    const handle = window.setTimeout(warm, 200)
    return () => window.clearTimeout(handle)
  }, [seriesId])

  async function handleTitleBlur() {
    const trimmed = titleDraft.trim()
    if (!trimmed || trimmed === series.title) return
    await fetch(`/api/series/${seriesId}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ title: trimmed }),
    })
    loadSeries()
  }

  async function handleDescriptionBlur() {
    if (descriptionDraft === (series.description ?? '')) return
    await fetch(`/api/series/${seriesId}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ description: descriptionDraft }),
    })
    loadSeries()
  }

  async function handleTagsChange(next: { genres?: string[]; keywords?: string[] }) {
    await fetch(`/api/series/${seriesId}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(next),
    })
    loadSeries()
  }

  async function handleDeleteBook(bookId: string) {
    await fetch(`/api/series/${seriesId}/books/${bookId}`, { method: 'DELETE' })
    setDeleteTarget(null)
    loadSeries()
  }

  /**
   * A book's status, as one field (LOOM-140).
   *
   * Storage keeps both booleans — no migration, and the PATCH endpoint already
   * accepts them together and already clears `inProgress` on every other book
   * atomically. Only the CONTROL is collapsed: it was two toggles on two
   * different pages writing one concept, which is why the card had to render
   * two chips with a precedence rule to explain itself.
   *
   * The three states are mutually exclusive by construction here, which is
   * what the data already looked like (no book was ever both).
   */
  async function setBookStatus(bookId: string, status: BookStatus) {
    await fetch(`/api/series/${seriesId}/books/${bookId}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        published: status === 'published',
        inProgress: status === 'inProgress',
      }),
    })
    loadSeries()
  }

  return (
    <>
      {/* Widened to match the book page (LOOM-105). This was the last page
          still on the old narrow shape, and moving between the two read as
          moving between two products — which is what LOOM-5 exists to stop.
          Capped rather than uncapped for the same reason recorded there: an
          ultrawide display would otherwise stretch the description into a
          single unreadable line. */}
      <div className="max-w-[1600px] mx-auto px-8 pt-4 pb-4 h-full flex flex-col">
        {/* Buttons in line with the title rather than a row of their own
            above it: they sit at flex-start, top-aligned with the title's
            own baseline, so the row costs no extra height beyond the title
            itself. On the right, and sized to content (`auto`) rather than
            an equal column, so the title gets the rest of the row — the
            buttons are the smaller thing here and don't need to dictate
            layout width the way a centred-title design would. */}
        <div className="flex-shrink-0 grid grid-cols-[1fr_auto] items-start gap-4 mb-3">
          <div className="flex flex-col items-center">
            <input
              value={titleDraft}
              onChange={e => setTitleDraft(e.target.value)}
              onBlur={handleTitleBlur}
              className="w-full bg-transparent border-none outline-none text-center text-3xl font-bold uppercase text-ink tracking-wide focus:opacity-80 transition-opacity"
            />
            {authorName && (
              <p className="text-sm text-ink-faint mt-1">by {authorName}</p>
            )}
          </div>
          <div ref={actionMenuRef} className="relative shrink-0 pt-1">
            <button
              onClick={() => setActionMenuOpen(o => !o)}
              title="Series actions"
              aria-label="Series actions"
              aria-haspopup="menu"
              aria-expanded={actionMenuOpen}
              className={`flex items-center h-[30px] px-2.5 rounded text-xs font-medium border transition ${
                actionMenuOpen
                  ? 'border-accent/40 text-ink bg-surface-raised'
                  : 'border-accent/20 text-ink-muted hover:text-ink hover:border-accent/40 bg-surface-overlay'
              }`}
            >
              <LuMenu size={14} />
            </button>

            {actionMenuOpen && (
              <div
                role="menu"
                className="absolute right-0 top-full mt-2 z-50 min-w-[190px] overflow-hidden rounded-lg border border-accent/20 bg-surface-raised shadow-xl"
              >
                <a
                  role="menuitem"
                  href={`/author/preview/series/${seriesId}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  onClick={() => setActionMenuOpen(false)}
                  className="flex w-full items-center gap-3 px-4 py-2.5 text-left text-sm text-ink-muted transition hover:bg-surface-overlay hover:text-ink"
                >
                  <span className="flex w-5 items-center justify-center text-accent"><LuEye size={14} /></span>
                  <span className="flex-1">Preview</span>
                </a>
                <a
                  role="menuitem"
                  href={`/api/series/${seriesId}/export`}
                  download
                  onClick={() => setActionMenuOpen(false)}
                  title="Back up the whole series as a .loom.json you can re-import. Covers prose, choices and characters — not chapter notes, narration or cover images. For a readable manuscript, open a book and use Save."
                  className="flex w-full items-center gap-3 px-4 py-2.5 text-left text-sm text-ink-muted transition hover:bg-surface-overlay hover:text-ink"
                >
                  <span className="flex w-5 items-center justify-center text-accent"><LuDatabaseBackup size={14} /></span>
                  <span className="flex-1">Backup</span>
                </a>
                <button
                  role="menuitem"
                  onClick={() => { setActionMenuOpen(false); setConfigureOpen(true) }}
                  className="flex w-full items-center gap-3 px-4 py-2.5 text-left text-sm text-ink-muted transition hover:bg-surface-overlay hover:text-ink"
                >
                  <span className="flex w-5 items-center justify-center text-accent"><LuSettings size={14} /></span>
                  <span className="flex-1">Configure</span>
                </button>
              </div>
            )}
          </div>
        </div>

        <div className="flex-shrink-0 mb-3 flex flex-col">
          <label className="text-xs uppercase tracking-widest text-ink-faint">Description</label>
          {/* Genre(s)/Keyword(s) moved into the Configure modal (LOOM-142),
              so this box gets their old vertical space back — up from rows=2
              to a fixed h-32, still capped rather than growing with the tab
              content below it. */}
          <textarea
            value={descriptionDraft}
            onChange={e => setDescriptionDraft(e.target.value)}
            onBlur={handleDescriptionBlur}
            placeholder="A short pitch readers will see on the series landing page…"
            className="w-full mt-2 h-32 bg-surface-overlay border border-accent/15 rounded-lg px-3 py-2 text-sm text-ink placeholder:text-ink-faint outline-none focus:border-accent/50 resize-y"
          />
        </div>
        {/* Everything above stays put — action row, title, by-author,
            description. That block is the series' IDENTITY, not tab content:
            it answers "what is this", where the tabs answer "what is in it".

            Books leads, and is always the default on load — no persisted
            "last tab" here. It is what the page is for and what every
            existing muscle-memory click expects; the other two are new
            surfaces that nobody has yet formed a habit around. */}
        <SectionTabs
          initialId={tabParam}
          className="flex-1 min-h-0 flex flex-col"
          fillHeight
          sections={[{
            id: 'books',
            label: 'Book(s)',
            content: (
              <>
        <AddBookButton onAdd={addBook} />
        {publish.error && (
          <div className="mb-4 px-3 py-2 rounded bg-choice-kill-bg border border-choice-kill-border text-choice-kill text-xs whitespace-pre-wrap">
            {publish.error}
          </div>
        )}
        {series.books.length === 0 ? (
          <p className="text-ink-faint text-sm text-center mt-16">No books yet. Add one above.</p>
        ) : (
          <div className="flex flex-col gap-4">
            {series.books.map((book, idx) => {
              const stats = bookStats(book)
              return (
                <div
                  key={book.id}
                  onClick={() => router.push(`/author/${seriesId}/book/${book.id}`)}
                  className="flex gap-5 p-5 rounded-lg bg-accent/25 border border-accent/20 hover:border-accent/40 hover:scale-[1.01] transition-all duration-150 cursor-pointer"
                >
                  <div className="w-28 shrink-0 rounded overflow-hidden bg-surface-overlay border border-accent/10 flex items-center justify-center" style={{ minHeight: '9rem' }}>
                    {book.coverPath ? (
                      <img src={book.coverPath} alt="" className="w-full h-full object-cover" />
                    ) : (
                      <span className="text-xs text-ink-faint text-center px-1">No cover</span>
                    )}
                  </div>
                  <div className="flex-1 min-w-0 flex flex-col justify-between">
                    <div>
                      <div className="flex items-center gap-3 mb-4">
                        <span className="text-xs text-ink-faint uppercase tracking-widest shrink-0">Book {idx + 1}</span>
                        <span className="font-semibold text-ink text-lg leading-tight">{book.title}</span>
                        {/* The one status control (LOOM-140), styled as the
                            outlined chip it replaced and kept where that chip
                            was: beside the title, reading as a property of the
                            book. It is a <select>, so this is also where you
                            change it.

                            Three outlines rather than three fills. The action
                            row below already has a solid accent button
                            ("Publish to readers"); a solid chip up here
                            competed with it and made the primary action
                            ambiguous.

                            Green / amber / faint-dashed, all from the guarded
                            palette — teal, blue and purple have no light-mode
                            override and would render near-black on the cream
                            page. */}
                        <select
                          value={statusOf(book)}
                          onChange={e => void setBookStatus(book.id, e.target.value as BookStatus)}
                          // The whole CARD navigates to the book on click. The
                          // action row below guards its buttons with the same
                          // stopPropagation; this chip sits in the title row,
                          // which has no such wrapper, so it carries its own.
                          // mousedown too: a <select> opens on mousedown, and
                          // without it the card reacts underneath the dropdown.
                          onClick={e => e.stopPropagation()}
                          onMouseDown={e => e.stopPropagation()}
                          title="Draft: readers see “Coming Soon”. In progress: the one you’re writing — the outline opens here. Published: eligible to send to readers."
                          className={`appearance-none shrink-0 cursor-pointer rounded border px-1.5 py-0.5
                            text-center text-[10px] uppercase tracking-widest transition
                            focus:outline-none focus-visible:border-accent/70 ${
                            statusOf(book) === 'published'
                              ? 'border-choice-spare-border bg-choice-spare-bg text-choice-spare hover:brightness-110'
                              : statusOf(book) === 'inProgress'
                                ? 'border-accent/50 bg-accent/10 text-accent hover:bg-accent/15'
                                : 'border-ink-faint/40 border-dashed text-ink-faint hover:text-ink-muted hover:border-ink-faint/60'
                          }`}
                        >
                          <option value="draft">Draft</option>
                          <option value="inProgress">In progress</option>
                          <option value="published">Published</option>
                        </select>
                        {/* Sits with the status chips rather than in the stats
                            grid below: those four are all "how much is here",
                            and this is not a size — it is something to fix. */}
                        {(deadByBook[book.id] ?? 0) > 0 && (
                          <span
                            title="Written, but no reader can reach it. See the Path(s) tab."
                            className="text-[10px] uppercase tracking-widest text-choice-kill border border-choice-kill-border bg-choice-kill-bg rounded px-1.5 py-0.5 shrink-0"
                          >
                            {deadByBook[book.id]} unreachable
                          </span>
                        )}
                        {/* Top-right of the card: the reader-facing answer.
                            The chips to its left are about the book's state in
                            Loom; this one is about what the family can see. */}
                        <span className="ml-auto shrink-0">
                          <PublishBadge status={publish.byId(book.id)} />
                        </span>
                      </div>
                      <div className="grid grid-cols-4 gap-3">
                        {[
                          { label: 'Chapter(s)', value: stats.chapterCount },
                          { label: 'Word(s)', value: stats.wordCount.toLocaleString() },
                          { label: 'POV(s)', value: stats.uniquePovs },
                          { label: 'Choice(s)', value: stats.choiceCount },
                        ].map(({ label, value }) => (
                          <div key={label} className="bg-surface-overlay border border-accent/10 rounded-lg px-3 py-4 flex flex-col items-center gap-1">
                            <span className="text-xl font-bold text-ink">{value}</span>
                            <span className="text-xs text-ink-faint uppercase tracking-widest">{label}</span>
                          </div>
                        ))}
                      </div>
                    </div>
                    <div className="flex justify-end gap-2 mt-3" onClick={e => e.stopPropagation()}>
                      {/* Always rendered, including for drafts — disabled with
                          a reason, rather than absent. A control that vanishes
                          leaves "how do I send this?" unanswered; one that is
                          visibly disabled answers it. */}
                      {(() => {
                        const st = publish.byId(book.id)
                        const eligible = st?.eligible ?? false
                        const needs = !!st && (st.changed || !st.inSnapshot)
                        const working = publish.busyBookId === book.id
                        const disabled = !st || !eligible || !!publish.busyBookId
                        // Hover styling is applied ONLY when the button can
                        // actually be pressed. Tailwind's hover: variants fire
                        // regardless of the disabled attribute, so a disabled
                        // button that still lightens on hover reads as
                        // enabled-but-unresponsive rather than as disabled.
                        const look = working
                          ? 'bg-accent text-white border-accent'
                          : disabled
                            ? 'bg-surface-overlay border-accent/20 text-ink-faint opacity-40 cursor-not-allowed'
                            : needs
                              ? 'bg-accent text-white border-accent hover:opacity-90'
                              : 'bg-surface-overlay border-accent/20 text-ink-muted hover:text-ink'
                        return (
                          <button
                            onClick={() => eligible && void publishWithCheck(book.id)}
                            disabled={disabled}
                            title={!eligible
                              ? 'This book is a draft. Mark it as Published first — until then readers only see “Coming Soon”.'
                              : needs
                                ? 'Send this book to readers. Every other book keeps exactly what it has.'
                                : 'Readers already have this version — republishing would change nothing.'}
                            className={`px-3 py-1.5 rounded text-xs transition flex items-center gap-1.5 border ${look}`}
                          >
                            <LuSend size={11} />
                            {working ? 'Publishing…' : needs ? 'Publish to readers' : 'Republish'}
                          </button>
                        )
                      })()}
                      {/* Status is a chip beside the TITLE, not a control in
                          this row — see the card header. It reads as a property
                          of the book rather than an action you take on it, and
                          it keeps this row to things you DO. */}
                      <a
                        href={`/api/series/${seriesId}/books/${book.id}/export`}
                        download
                        title="Back up this book as a .loom.json you can re-import. Covers prose, choices and characters — not chapter notes, narration or cover images. For a readable manuscript, open the book and use Save."
                        className="px-3 py-1.5 rounded text-xs bg-surface-overlay border border-accent/20 text-ink-muted hover:text-ink transition flex items-center gap-1.5"
                      >
                        <LuDatabaseBackup size={11} /> Backup
                      </a>
                      <button
                        onClick={() => setDeleteTarget({ id: book.id, title: book.title })}
                        className="px-3 py-1.5 rounded text-xs bg-surface-overlay border border-choice-kill/40 text-choice-kill hover:opacity-80 transition"
                      >
                        Delete
                      </button>
                    </div>
                  </div>
                </div>
              )
            })}
          </div>
        )}
              </>
            ),
          }, {
            id: 'characters',
            label: 'Character(s)',
            content: <SeriesCharactersSection seriesId={seriesId} />,
          }, {
            // Unfiltered, unlike the book page's — this IS WriteAI's timeline
            // page, in Loom. No chapter picker either: nothing here is filtered
            // by tag, so a new event cannot vanish from the view that made it.
            id: 'timeline',
            label: 'Timeline',
            content: <SeriesTimelineTab seriesId={seriesId} />,
          }, {
            // Last in the strip: it is the only tab that is a conversation
            // rather than a list, and it is the one you go to deliberately.
            // Every book in the series is in scope here — the prefix rule is a
            // book-page constraint, and a series-wide question is the whole
            // reason this exists at series level (LOOM-114).
            id: 'explore',
            label: 'Explore',
            content: <ExplorePanel seriesId={seriesId} bookId={null} fillHeight />,
          }, {
            // Last, and series-scoped by necessity rather than preference: a
            // variable set in book 2 is read in book 4, so there is no honest
            // per-book version of this view (LOOM-122).
            id: 'paths',
            label: 'Path(s)',
            content: <ReachabilityLedger seriesId={seriesId} />,
          }]}
        />
      </div>

      {/* Outside the tab strip on purpose: this is a PAGE-level dialog, and a
          modal owned by a tab dies the moment you switch tabs. */}
      {deleteTarget && (
        <div
          className="fixed inset-0 bg-black/60 flex items-start justify-center z-50"
          style={{ paddingTop: 'calc(60px + 10vh)', paddingLeft: '14rem' }}
          onClick={() => setDeleteTarget(null)}
        >
          <div
            className="bg-surface-raised border border-accent/20 rounded-xl p-8 max-w-2xl w-full mx-8 shadow-2xl relative"
            onClick={e => e.stopPropagation()}
          >
            <button
              onClick={() => setDeleteTarget(null)}
              className="absolute top-4 right-4 text-ink-faint hover:text-ink text-lg leading-none"
            >
              ✕
            </button>
            <h2 className="text-base font-bold text-ink mb-3 pr-6">
              Are you sure you want to delete "{deleteTarget.title}"?
            </h2>
            <p className="text-sm text-ink-muted mb-6 leading-relaxed italic">
              Deleting this book is permanent and cannot be undone. All of its chapters, written content,
              and choices will be removed. Any story branches in later books that depended on choices
              made here will fall back to their default text.
            </p>
            <div className="flex gap-3 justify-end">
              <button
                onClick={() => setDeleteTarget(null)}
                className="px-4 py-2 rounded-lg text-ink-muted text-sm hover:text-ink transition"
              >
                Cancel
              </button>
              <button
                onClick={() => handleDeleteBook(deleteTarget.id)}
                className="px-4 py-2 rounded-lg bg-choice-kill text-white text-sm font-semibold hover:opacity-90 transition"
              >
                Delete
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Only ever mounted because a republish was pressed and would have sent
          chapters out silent. */}
      {silent && (
        <SilentChaptersDialog
          seriesId={seriesId}
          bookId={silent.bookId}
          chapters={silent.chapters}
          onPublishAnyway={() => {
            const { bookId } = silent
            setSilent(null)
            void publish.publish(bookId)
          }}
          onClose={() => setSilent(null)}
        />
      )}

      {configureOpen && (
        <SeriesConfigureModal
          genres={series.genres ?? []}
          keywords={series.keywords ?? []}
          onChange={handleTagsChange}
          onClose={() => setConfigureOpen(false)}
        />
      )}
    </>
  )
}
