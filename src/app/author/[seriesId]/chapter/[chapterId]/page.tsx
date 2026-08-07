'use client'

import React, { useEffect, useState, useCallback, useRef, useMemo } from 'react'
import { useParams, useRouter, useSearchParams } from 'next/navigation'
import { LuPlay, LuPlus, LuMenu, LuScanText, LuSettings, LuCircleHelp, LuX, LuArrowLeft, LuArrowRight, LuArrowUp, LuChevronsDownUp, LuChevronsUpDown, LuSearch, LuReplace, LuCaseSensitive, LuWholeWord, LuRoute, LuCalendarDays, LuUsers, LuLightbulb, LuChartNoAxesColumn, LuSlidersHorizontal } from 'react-icons/lu'
import { computeChapterStats } from '@/lib/chapterStats'
import { PiCopySimpleThin, PiNotebookThin } from 'react-icons/pi'
import BlockEditor from '@/components/editor/BlockEditor'
import SidePanel, { minWidthForTab, type PanelTab } from '@/components/editor/SidePanel'
import { useChapterReview } from '@/components/editor/ReviewPanel'
import { type PinnedText } from '@/components/editor/ReferencePanel'
import { useChapterNotes } from '@/components/editor/useChapterNotes'
import { useChapterEvents } from '@/components/editor/useChapterEvents'
import { useChapterCharacters } from '@/components/editor/useChapterCharacters'
import { useChapterInsights } from '@/components/editor/useChapterInsights'
import { useChapterComments } from '@/components/editor/useChapterComments'
import { useRegisterShortcuts, type ShortcutGroup } from '@/lib/shortcuts'
import ChapterSkeleton from '@/components/editor/ChapterSkeleton'
import { notify, showToast } from '@/lib/notifications'
import { registerProseFlush, subscribeProseReplaced } from '@/lib/proseSync'
import { ConditionRow } from '@/components/editor/conditionUI'
import { useAuthor } from '@/lib/authorContext'
import { ensureMinDuration } from '@/lib/minLoadDuration'
import { useCanonSave } from '@/components/editor/useCanonSave'
import { substituteVarTemplates } from '@/lib/templateVars'
import { matchesCondition, type StoryState, type Condition } from '@/lib/storyEngine'
import { resolveChapter, buildStoryState, varTypeMap } from '@/lib/chapterResolve'
import PathConfigModal from '@/components/editor/PathConfigModal'
import ChapterReachabilityBanner from '@/components/editor/ChapterReachabilityBanner'

type Block = {
  id: string; order: number; type: string
  content?: string | null; prompt?: string | null; displayType?: string | null; baseContent?: string | null; condition?: string | null
  choices: { id: string; order: number; label: string; setsVariables: string; targetChapterId: string | null; condition?: string | null; endingMessage?: string | null; isBadEnding?: boolean; endsChapter?: boolean }[]
  overrides: { id: string; order: number; condition: string; content: string; endingMessage?: string | null; endsChapter?: boolean }[]
}
type Chapter = { id: string; title: string; pov: string | null; date: string | null; condition: string | null; numbered: boolean; blocks: Block[] }
// The tag picker's pool. Loom's snapshot of WriteAI's characters, which is
// now the ONE cast list in the app — the dock's Characters tab and this
// picker draw on the same records (LOOM-88).
type Character = { id: string; name: string; aliases?: string | null; photoUrl?: string | null; age?: number | null }

// How often the chapter-stats panel (word count, reading time, …) recomputes
// from live editor state while this page is mounted (LOOM-123).
const STATS_POLL_MS = 3000

// Published to the header's shortcut menu while this page is mounted. Module
// level so the identity is stable across renders (it's an effect dependency).
// Adding a shortcut below means adding its handler in the keydown switch too.
const CHAPTER_SHORTCUTS: ShortcutGroup[] = [
  {
    group: 'Add Blocks',
    items: [
      { keys: '⌥⇧T', label: 'Text block' },
      { keys: '⌥⇧Q', label: 'Choice block' },
      { keys: '⌥⇧C', label: 'Conditional block' },
      { keys: '⌥⇧S', label: 'Soundtrack block' },
    ],
  },
  {
    group: 'Chapter',
    items: [
      { keys: '⌥⇧N', label: 'Create next chapter' },
      { keys: '⌥⇧E', label: 'Export canon' },
      { keys: '⌥⇧P', label: 'Preview chapter' },
      { keys: '⌥⇧X', label: 'Copy canon text' },
      { keys: '⌥⇧`', label: 'Chapter settings' },
      { keys: '⌥⇧O', label: 'Toggle path config' },
      { keys: '⌥⇧F', label: 'Find in chapter' },
      { keys: '⌥⇧0', label: 'Toggle chapter stats' },
      { keys: '⌥⇧9', label: 'Collapse / expand all blocks' },
      { keys: '⌥⇧→ / ←', label: 'Next / previous match (while searching)' },
      { keys: '⌥⇧← / →', label: 'Previous / next chapter' },
      { keys: '⌥⇧K', label: 'Clear chapter search' },
      { keys: '⌥⇧W', label: 'Clear path lens' },
      { keys: '⌥⇧D', label: 'Delete active block' },
    ],
  },
  {
    group: 'While Writing',
    items: [
      { keys: '⌥⇧J', label: 'Jump to cursor' },
      { keys: '⌥⇧I', label: 'Toggle paragraph indent' },
      { keys: '⌥⇧+ / -', label: 'Enlarge / shrink text' },
      { keys: '⌥⇧R', label: 'Read aloud from cursor' },
      { keys: '⌥⇧B', label: 'Insert scene break' },
    ],
  },
  {
    group: 'Side Panel',
    items: [
      { keys: '⌥⇧2', label: 'Open / close side panel' },
      { keys: '⌥⇧< / >', label: 'Previous / next side panel tab' },
      { keys: '⌥⇧⏎', label: 'Save (in a dialog)' },
      { keys: '⌥⇧⎋', label: 'Cancel (in a dialog)' },
    ],
  },
]

// The dock's tabs in the order they appear in the strip — also the order
// ⌥⇧< / ⌥⇧> step through (LOOM-56).
const PANEL_TAB_ORDER: PanelTab[] = ['review', 'events', 'characters', 'insights', 'notes', 'refs']

function safeCondition(raw: string | null | undefined): Condition | null {
  if (!raw) return null
  try {
    const parsed = JSON.parse(raw)
    return parsed && typeof parsed === 'object' ? (parsed as Condition) : null
  } catch { return null }
}

export default function ChapterEditorPage() {
  const { seriesId, chapterId } = useParams() as { seriesId: string; chapterId: string }
  const router = useRouter()
  const { series, loadSeries, loadChoices } = useAuthor()
  const [chapter, setChapter] = useState<Chapter | null>(null)
  const [characters, setCharacters] = useState<Character[]>([])
  const [titleDraft, setTitleDraft] = useState('')
  // The chapter header's ☰ action menu (Review / Preview / Copy / Path /
  // Notes / Settings). It replaced the floating + add-block button, which was
  // dead weight — blocks are added with ⌥⇧T/Q/C/S (KAN-30).
  const [actionMenuOpen, setActionMenuOpen] = useState(false)
  // Chapter stats panel (LOOM-109) — toggled by its header button or ⌥⇧0.
  const [statsOpen, setStatsOpen] = useState(false)
  // Ticks every STATS_POLL_MS so chapterStats (below) recomputes on a timer
  // instead of only when some unrelated state change happens to re-render
  // this component. currentBlocksRef is a ref BlockEditor mutates on every
  // keystroke (LOOM-123) — mutating a ref doesn't itself trigger a re-render
  // of this parent, so without this tick the panel shows whatever word count
  // was current the last time something else (opening the panel, moving focus
  // to a different block) happened to re-render it.
  const [statsTick, setStatsTick] = useState(0)
  // Below 576px the search bar's case/word/replace toggles move into this
  // popover (opened via a single icon) so the input itself keeps its width.
  const [searchOptionsOpen, setSearchOptionsOpen] = useState(false)
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false)
  const [showChapterSettings, setShowChapterSettings] = useState(false)
  const [copyDone, setCopyDone] = useState(false)
  // Path lens — a configured StoryState that dims off-path blocks in the
  // editor and drives what Copy emits. Null means no lens (normal editing,
  // canon Copy). lensSelections is the raw per-question answer map, kept so
  // the config panel can restore the writer's picks when reopened. Both are
  // persisted per-chapter in localStorage (see effects below).
  const [lensState, setLensState] = useState<StoryState | null>(null)
  const [lensSelections, setLensSelections] = useState<Record<string, string | null>>({})
  const [showPathConfig, setShowPathConfig] = useState(false)
  const [showIfTooltip, setShowIfTooltip] = useState(false)
  const [activeBlockId, setActiveBlockId] = useState<string | null>(null)
  // Frozen prose snapshots pinned to the right-hand reference panel. In-memory
  // only — pinning captures the text as it is now so later edits don't shift it.
  const [pins, setPins] = useState<PinnedText[]>([])
  // Side-panel width, adjustable via its drag handle. Lifted here so the
  // toast layer and the footer can offset by it and stay over the writing column.
  const [panelWidth, setPanelWidth] = useState(360)
  // The right-hand dock. Open state is explicit (and persisted) rather than
  // derived from the pin count, because notes live here too and always exist —
  // an empty pin list no longer means "nothing to show".
  const [panelOpen, setPanelOpen] = useState(false)
  const [panelTab, setPanelTab] = useState<PanelTab>('notes')
  // Live values for the hotkey handler, whose effect closes over mount-time state.
  const panelOpenRef = useRef(panelOpen)
  panelOpenRef.current = panelOpen
  const panelTabRef = useRef(panelTab)
  panelTabRef.current = panelTab

  // Restore the writer's last-used tab, width, and open state (LOOM-56) so
  // reopening the dock doesn't drop them back to Notes at 360px, and so a
  // reload doesn't force the dock closed. Read on mount rather than as a
  // lazy useState initializer — localStorage isn't available during SSR.
  useEffect(() => {
    try {
      const savedTab = localStorage.getItem('loom-panel-tab') as PanelTab | null
      if (savedTab && PANEL_TAB_ORDER.includes(savedTab)) setPanelTab(savedTab)
      const savedWidth = Number(localStorage.getItem('loom-panel-width'))
      if (Number.isFinite(savedWidth) && savedWidth > 0) setPanelWidth(savedWidth)
      if (localStorage.getItem('loom-panel-open') === 'true') setPanelOpen(true)
    } catch { /* ignore */ }
  }, [])

  const { notes, setNotes, saving: notesSaving, hasNotes } = useChapterNotes(chapterId)
  const chapterEvents = useChapterEvents(chapterId)
  const chapterCharacters = useChapterCharacters(chapterId)
  // The same book lookup as `currentBook` further down, but that one sits
  // after `if (!chapter) return <ChapterSkeleton />` — a hook cannot live past
  // an early return. Optional-chained so it is simply undefined until the
  // series loads, which useChapterReview treats as "nothing to fetch yet".
  const reviewBookId = series?.books.find(b => b.chapters.some(c => c.id === chapterId))?.id
  const {
    data: reviewData,
    loading: reviewLoading,
    hasReview,
    setData: setReviewData,
    refetch: refetchReview,
  } = useChapterReview(seriesId, reviewBookId, chapterId)
  // Fetched only while the tab is actually open. Not a side-effect worry — the
  // endpoint behind it is a pure read, unlike the character pool — but it is a
  // WriteAI round trip per chapter, and the answer changes about once a day.
  const chapterInsights = useChapterInsights(
    seriesId,
    reviewBookId,
    chapterId,
    panelOpen && panelTab === 'insights',
  )

  // Reader comments (LOOM-135). Same shape as Insights — an outside store,
  // fetched only while its tab is open — except the badge needs a count even
  // when the tab is closed, which is what makes it discoverable at all.
  const chapterComments = useChapterComments(
    reviewBookId,
    chapterId,
    panelOpen && panelTab === 'comments',
  )
  useRegisterShortcuts('chapter', CHAPTER_SHORTCUTS)

  // Both setters persist (LOOM-56) — plain wrappers around setPanelTab /
  // setPanelWidth so every caller below gets the write for free.
  function setPanelTabPersisted(tab: PanelTab) {
    setPanelTab(tab)
    try { localStorage.setItem('loom-panel-tab', tab) } catch { /* ignore */ }
  }
  function openPanel(tab: PanelTab) {
    setPanelTabPersisted(tab)
    setPanelOpen(true)
    try { localStorage.setItem('loom-panel-open', 'true') } catch { /* ignore */ }
    // Review needs a third of the viewport to be readable, and the panel
    // remembers whatever width notes last used. Widen on the way in rather
    // than leaving the writer to drag it open every time (KAN-22). Never
    // narrows — a deliberately wide panel stays wide switching back.
    setPanelWidth(w => {
      const next = Math.max(w, minWidthForTab(tab, window.innerWidth))
      try { localStorage.setItem('loom-panel-width', String(next)) } catch { /* ignore */ }
      return next
    })
  }
  function closePanel() {
    setPanelOpen(false)
    try { localStorage.setItem('loom-panel-open', 'false') } catch { /* ignore */ }
  }
  // One rule for every side-panel menu item: closed → open on my tab; open on
  // another tab → switch to mine; open on my tab → close. Used to also back
  // the ⌥⇧2–6 hotkeys; those collapsed into ⌥⇧2 (open/close) and ⌥⇧< / ⌥⇧>
  // (step tabs) once the per-tab hotkeys got out of hand (LOOM-56).
  function togglePanelTab(tab: PanelTab) {
    if (!panelOpenRef.current) { openPanel(tab); return }
    if (panelTabRef.current !== tab) { setPanelTabPersisted(tab); return }
    closePanel()
  }
  const togglePanelTabRef = useRef(togglePanelTab)
  togglePanelTabRef.current = togglePanelTab
  // ⌥⇧2 — open the dock (restoring the last tab) or close it if already open.
  function toggleDock() {
    if (panelOpenRef.current) { closePanel(); return }
    openPanel(panelTabRef.current)
  }
  const toggleDockRef = useRef(toggleDock)
  toggleDockRef.current = toggleDock
  // ⌥⇧< / ⌥⇧> — step to the previous/next tab in PANEL_TAB_ORDER. A no-op
  // past either end rather than wrapping, and only while the dock is open
  // (checked by the caller, which also owns whether to open it first).
  function cyclePanelTab(direction: 1 | -1) {
    const idx = PANEL_TAB_ORDER.indexOf(panelTabRef.current)
    const next = idx + direction
    if (next < 0 || next >= PANEL_TAB_ORDER.length) return
    setPanelTabPersisted(PANEL_TAB_ORDER[next])
  }
  const cyclePanelTabRef = useRef(cyclePanelTab)
  cyclePanelTabRef.current = cyclePanelTab

  // Pins is a permanent tab with its own empty state now, so clearing every pin
  // leaves you looking at that rather than at a tab which no longer exists.
  // There was an effect here forcing the panel back to notes whenever the pins
  // ran out — with the tab now always present that would fight the writer,
  // ejecting her the moment she opened an empty Pins tab.
  // Lifted from BlockEditor so the date-row toggle can flip every block at
  // once. Resets to empty on chapter switch (chapterId is in the dep list
  // below), matching the "all uncollapsed on initial load" rule.
  const [collapsedIds, setCollapsedIds] = useState<Set<string>>(new Set())
  useEffect(() => { setCollapsedIds(new Set()) }, [chapterId])
  // ⌥⇧9 — mirrors the collapse-all button: collapse everything, or expand
  // everything if any block is already collapsed.
  function toggleCollapseAll() {
    if (!chapter) return
    const anyCollapsed = chapter.blocks.some(b => collapsedIds.has(b.id))
    setCollapsedIds(anyCollapsed ? new Set() : new Set(chapter.blocks.map(b => b.id)))
  }
  const toggleCollapseAllRef = useRef(toggleCollapseAll)
  toggleCollapseAllRef.current = toggleCollapseAll

  // Restore this chapter's saved path lens on navigation; reset when the
  // chapter has none so a path from a previous chapter never carries over.
  useEffect(() => {
    try {
      const raw = localStorage.getItem(`loom-path-lens:${chapterId}`)
      if (raw) {
        const parsed = JSON.parse(raw) as { state?: StoryState | null; selections?: Record<string, string | null> }
        setLensState(parsed.state ?? null)
        setLensSelections(parsed.selections ?? {})
        return
      }
    } catch { /* malformed — fall through to a clean slate */ }
    setLensState(null)
    setLensSelections({})
  }, [chapterId])

  // Set (or clear, with state=null) the path lens and persist it per chapter.
  function applyLens(state: StoryState | null, selections: Record<string, string | null>) {
    setLensState(state)
    setLensSelections(selections)
    try {
      if (state) localStorage.setItem(`loom-path-lens:${chapterId}`, JSON.stringify({ state, selections }))
      else localStorage.removeItem(`loom-path-lens:${chapterId}`)
    } catch { /* quota / disabled storage — the in-memory lens still works */ }
  }
  // Latest clearer for the ⌥⇧W hotkey, whose listener closes over mount state.
  const clearLensRef = useRef<() => void>(() => {})
  clearLensRef.current = () => applyLens(null, {})
  // The layout's <main> scroller stays mounted across chapter navigation,
  // so the old scroll position (e.g. the footer, after clicking next
  // chapter) would otherwise carry over to the new chapter. Keyed on the
  // LOADED chapter's id — firing after the new content has rendered means
  // it wins over both late layout shifts and Chrome's scroll restoration
  // of the inner scroller on a full page reload.
  useEffect(() => { document.querySelector('main')?.scrollTo(0, 0) }, [chapter?.id])
  const [localSearchQuery, setLocalSearchQuery] = useState('')
  // Highlighting and match-counting run against this debounced copy: each
  // keystroke in the find bar otherwise forces every TipTap editor in the
  // chapter to rescan its whole document. The input itself stays instant;
  // clearing un-highlights immediately.
  const [debouncedSearchQuery, setDebouncedSearchQuery] = useState('')
  useEffect(() => {
    if (!localSearchQuery.trim()) { setDebouncedSearchQuery(localSearchQuery); return }
    const t = setTimeout(() => setDebouncedSearchQuery(localSearchQuery), 250)
    return () => clearTimeout(t)
  }, [localSearchQuery])
  const [localSearchReplace, setLocalSearchReplace] = useState('')
  const [localSearchReplaceMode, setLocalSearchReplaceMode] = useState(false)
  // Match-case / whole-word toggles, shared (via localStorage) with the
  // series search bar so the preference is one setting across both.
  const [matchCase, setMatchCase] = useState(false)
  const [matchWord, setMatchWord] = useState(false)
  useEffect(() => {
    setMatchCase(localStorage.getItem('loom-search-case') === 'true')
    setMatchWord(localStorage.getItem('loom-search-word') === 'true')
  }, [])
  function toggleMatchCase() { setMatchCase(v => { const n = !v; localStorage.setItem('loom-search-case', String(n)); return n }) }
  function toggleMatchWord() { setMatchWord(v => { const n = !v; localStorage.setItem('loom-search-word', String(n)); return n }) }
  const localSearchInputRef = useRef<HTMLInputElement>(null)
  // Live query for the empty-dep global hotkey handler (⌥⇧→ / ⌥⇧←).
  const localSearchQueryRef = useRef(localSearchQuery)
  localSearchQueryRef.current = localSearchQuery
  const replaceAllRef = useRef<((search: string, replacement: string) => number) | null>(null)
  const jumpToFirstMatchRef = useRef<((query: string) => void) | null>(null)
  const jumpToMatchRef = useRef<((query: string, dir: 'next' | 'prev') => void) | null>(null)
  const scrollToCursorRef = useRef<(() => void) | null>(null)
  const savesRef = useRef<{
    flushAll: () => Promise<void>
    discardAll: () => number
    armDiscardOnUnmount: () => void
  } | null>(null)
  const currentBlocksRef = useRef<{ id: string; order: number; type: string; content?: string | null; baseContent?: string | null; condition?: string | null; choices?: { id: string; order: number; label: string; setsVariables: string; targetChapterId: string | null; condition?: string | null; endingMessage?: string | null; isBadEnding?: boolean; endsChapter?: boolean }[]; overrides?: { id: string; order: number; condition: string; content: string; endingMessage?: string | null; endsChapter?: boolean }[] }[] | null>(null)
  const actionMenuRef = useRef<HTMLDivElement>(null)
  const statsMenuRef = useRef<HTMLDivElement>(null)
  const searchOptionsRef = useRef<HTMLDivElement>(null)
  const titleInputRef = useRef<HTMLInputElement>(null)
  const povInputRef = useRef<HTMLInputElement>(null)
  const focusedPovRef = useRef<string | null>(null)
  const searchParams = useSearchParams()
  // POV draft + autocomplete bookkeeping.
  //   povDraft        — what the input currently shows (typed + any suggested suffix)
  //   typedPrefixRef  — the portion the writer has actually typed; the rest is
  //                     the auto-suggestion that gets selection-highlighted.
  //   rejectedPrefixRef — when the writer presses Backspace on a selected
  //                       suggestion, we lock in their typed prefix as
  //                       "don't re-suggest this exact string" so they can
  //                       commit a partial match like "N" or "No" without
  //                       fighting the autocomplete.
  const [povDraft, setPovDraft] = useState('')
  const typedPrefixRef = useRef('')
  const rejectedPrefixRef = useRef<string | null>(null)
  const povSyncedChapterRef = useRef<string | null>(null)
  const autosaveEnabledRef = useRef(true)
  const currentBookIdRef = useRef<string | undefined>(undefined)
  const autosaveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const footerRef = useRef<HTMLElement>(null)
  const headerRef = useRef<HTMLDivElement>(null)

  // Publish the sticky chapter header's height as --loom-chapter-header-h.
  // Every scrollIntoView in the editor (new block, deep link, jump to match,
  // jump to cursor) would otherwise be free to park a block underneath it;
  // globals.css turns this into a scroll-margin-top on each block row.
  useEffect(() => {
    const el = headerRef.current
    if (!el) return
    const publish = () => document.documentElement.style.setProperty('--loom-chapter-header-h', `${el.offsetHeight}px`)
    publish()
    const ro = new ResizeObserver(publish)
    ro.observe(el)
    return () => {
      ro.disconnect()
      document.documentElement.style.removeProperty('--loom-chapter-header-h')
    }
  // The header isn't in the DOM until the chapter loads past the skeleton.
  }, [chapter?.id])

  // Below 576px of header width, the search bar's case/word/replace toggles
  // move into a popover (behind one icon) so the input keeps a usable width.
  // Tracks the header's own width, not the viewport's, so it lines up with
  // the @container/@max-[576px] rules applied to the same element.
  const [compactSearch, setCompactSearch] = useState(false)
  useEffect(() => {
    const el = headerRef.current
    if (!el) return
    const check = () => setCompactSearch(el.offsetWidth < 576)
    check()
    const ro = new ResizeObserver(check)
    ro.observe(el)
    return () => ro.disconnect()
  }, [chapter?.id])

  // Publish the footer's height as --loom-footer-h so the reference panel can
  // stop exactly at the footer's top (the full-width footer sits beneath it).
  useEffect(() => {
    const el = footerRef.current
    if (!el) return
    const publish = () => document.documentElement.style.setProperty('--loom-footer-h', `${el.offsetHeight}px`)
    publish()
    const ro = new ResizeObserver(publish)
    ro.observe(el)
    return () => ro.disconnect()
  // Re-bind when the chapter mounts (the footer isn't in the DOM until then);
  // the observer handles size changes after that.
  }, [chapter?.id])

  // Visual text-block zoom (⌥⇧+ / ⌥⇧-). Drives --loom-prose-scale on <html>,
  // which every TextBlock's font size reads; persisted so it survives reloads.
  const proseScaleRef = useRef(1)
  useEffect(() => {
    const saved = parseFloat(localStorage.getItem('loom-prose-scale') ?? '1')
    proseScaleRef.current = Number.isFinite(saved) ? Math.min(2, Math.max(0.8, saved)) : 1
    document.documentElement.style.setProperty('--loom-prose-scale', String(proseScaleRef.current))
  }, [])
  function adjustProseScale(delta: number) {
    const next = Math.min(2, Math.max(0.8, Math.round((proseScaleRef.current + delta) * 100) / 100))
    proseScaleRef.current = next
    document.documentElement.style.setProperty('--loom-prose-scale', String(next))
    localStorage.setItem('loom-prose-scale', String(next))
  }

  // Focus the POV field once after navigation from chapter creation.
  // The router uses `?focus=pov` to signal it; we only fire on the
  // first render where the input is mounted for that chapterId, so
  // a manual refresh of the URL doesn't keep yanking focus back.
  // Depending on `chapter?.id` (not just chapterId) keeps the effect
  // alive past the skeleton render — without that, the first run
  // happens while povInputRef is still null and the focus is lost.
  useEffect(() => {
    if (searchParams?.get('focus') !== 'pov') return
    if (focusedPovRef.current === chapterId) return
    const el = povInputRef.current
    if (!el) return
    el.focus()
    el.select()
    focusedPovRef.current = chapterId
  }, [searchParams, chapterId, chapter?.id])

  // Stamp this chapter as the series' "last touched" so jump-in surfaces
  // (WriteAI's Write link, future resume flows) can land here. Opening the
  // editor is the touch — you can't edit without opening.
  useEffect(() => {
    fetch(`/api/series/${seriesId}/last-touched`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ chapterId }),
    }).catch(() => { /* non-fatal */ })
  }, [seriesId, chapterId])

  useEffect(() => {
    function handleClick(e: MouseEvent) {
      if (actionMenuRef.current && !actionMenuRef.current.contains(e.target as Node)) {
        setActionMenuOpen(false)
      }
      if (statsMenuRef.current && !statsMenuRef.current.contains(e.target as Node)) {
        setStatsOpen(false)
      }
      if (searchOptionsRef.current && !searchOptionsRef.current.contains(e.target as Node)) {
        setSearchOptionsOpen(false)
      }
    }
    document.addEventListener('mousedown', handleClick)
    return () => document.removeEventListener('mousedown', handleClick)
  }, [])

  // Load autosave preference once on mount.
  useEffect(() => {
    fetch('/api/settings/canon-export')
      .then(r => r.ok ? r.json() : null)
      .then((s: { autosave?: boolean } | null) => {
        autosaveEnabledRef.current = s?.autosave !== false
      })
      .catch(() => {})
  }, [])

  // Keep currentBookIdRef updated via effect (not during render) so the
  // navigation-away cleanup below sees the old chapter's book ID, not the
  // new one, when chapterId changes.
  useEffect(() => {
    const book = series?.books?.find(b => b.chapters?.some(c => c.id === chapterId))
    currentBookIdRef.current = book?.id
  })

  // On chapter switch or page unmount, flush any pending debounce and fire
  // one final silent export if autosave is enabled.
  useEffect(() => {
    return () => {
      if (autosaveTimerRef.current) clearTimeout(autosaveTimerRef.current)
      if (autosaveEnabledRef.current) saveCanon(currentBookIdRef.current, true)
    }
  // saveCanon is stable (closes only over seriesId from URL params)
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [chapterId])

  function handleTextBlockBlur() {
    if (!autosaveEnabledRef.current) return
    if (autosaveTimerRef.current) clearTimeout(autosaveTimerRef.current)
    autosaveTimerRef.current = setTimeout(() => {
      saveCanon(currentBookIdRef.current, true)
    }, 1500)
  }

  async function patchChapter(data: Record<string, string | boolean | null>) {
    await fetch(`/api/chapters/${chapterId}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data),
    })
  }

  function handleMetaChange(field: 'pov' | 'date', value: string) {
    setChapter(prev => prev ? { ...prev, [field]: value } : null)
    patchChapter({ [field]: value || null })
  }

  // Distinct POV values used in the same book, frequency-sorted.
  // Excludes the current chapter so a freshly inherited POV doesn't
  // shadow other valid completions.
  const pastPOVs = useMemo(() => {
    if (!series) return []
    const book = series.books.find(b => b.chapters.some(c => c.id === chapterId))
    if (!book) return []
    const counts = new Map<string, number>()
    for (const c of book.chapters) {
      if (c.id === chapterId) continue
      const pov = c.pov?.trim()
      if (pov) counts.set(pov, (counts.get(pov) ?? 0) + 1)
    }
    return Array.from(counts.entries()).sort((a, b) => b[1] - a[1]).map(([name]) => name)
  }, [series, chapterId])

  function findPovSuggestion(typed: string): string | null {
    if (!typed) return null
    if (rejectedPrefixRef.current && typed.toLowerCase() === rejectedPrefixRef.current.toLowerCase()) return null
    const lower = typed.toLowerCase()
    return pastPOVs.find(p => p.toLowerCase().startsWith(lower) && p.length > typed.length) ?? null
  }

  function handlePovChange(e: React.ChangeEvent<HTMLInputElement>) {
    const next = e.target.value
    // Any keystroke that changes the typed prefix invalidates the prior
    // rejection — the writer is exploring a different stem now.
    if (rejectedPrefixRef.current && next !== rejectedPrefixRef.current) {
      rejectedPrefixRef.current = null
    }
    typedPrefixRef.current = next
    const suggestion = findPovSuggestion(next)
    setPovDraft(suggestion ?? next)
  }

  function handlePovKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    // Backspace while the suggestion's tail is highlighted means "I don't
    // want this completion" — keep just the typed prefix and remember to
    // not re-suggest it on the next render.
    if (e.key === 'Backspace') {
      const input = e.currentTarget
      const hasSelection = input.selectionStart !== input.selectionEnd
      if (hasSelection && typedPrefixRef.current.length < povDraft.length) {
        e.preventDefault()
        rejectedPrefixRef.current = typedPrefixRef.current
        setPovDraft(typedPrefixRef.current)
        return
      }
    }
    // Enter commits + drops focus, same as blur. Useful when the writer
    // wants to keep both hands on the keyboard after typing a brand-new
    // POV (no autocomplete suggestion to Tab onto).
    if (e.key === 'Enter') {
      e.preventDefault()
      e.currentTarget.blur()
    }
  }

  // After every render where the draft contains an unaccepted suggestion,
  // highlight just the suggested tail. Selection-based highlight lets Tab
  // accept naturally (focus moves → blur commits the draft as-is) and
  // lets any other keystroke replace the suggestion as if it weren't
  // there.
  useEffect(() => {
    const input = povInputRef.current
    if (!input || document.activeElement !== input) return
    const typed = typedPrefixRef.current
    if (typed.length < povDraft.length) {
      input.setSelectionRange(typed.length, povDraft.length)
    }
  }, [povDraft])

  function handleConditionChange(next: string | null) {
    setChapter(prev => prev ? { ...prev, condition: next } : null)
    patchChapter({ condition: next })
  }

  // Both of these renumber the manuscript, and neither is followed by a
  // keystroke that the blur autosave could ride out on (LOOM-99).
  //
  // `numbered` decides whether a chapter takes a canon number at all — the
  // manifest reads `ch.numbered ? Number(ch.label) : …` — so toggling it
  // shifts every chapter after this one. A title rename is how a chapter is
  // canonised: "Bonus Chapter 1" becomes "13", and the server bumps every
  // same-prefix sibling below it.
  //
  // Neither wrote to disk before. The sidebar renumbered instantly and looked
  // right, while the manifest kept describing the old numbering until the
  // writer next happened to type in that book — and WriteAI kept answering
  // about chapter 13 with chapter 12's scene. Worse than stale: enrichment
  // that ran in that window stamped fresh summaries with the identities of the
  // chapters they had displaced (LOOM-98), which no resync could undo.
  function handleNumberedChange(next: boolean) {
    setChapter(prev => prev ? { ...prev, numbered: next } : null)
    void patchChapter({ numbered: next })
      .then(() => saveCanonAfterStructuralChange(currentBookIdRef.current))
  }

  async function handleTitleBlur() {
    const trimmed = titleDraft.trim()
    if (!trimmed || trimmed === chapter?.title) return
    await patchChapter({ title: trimmed })
    setChapter(prev => prev ? { ...prev, title: trimmed } : null)
    loadSeries()
    // After the PATCH, never alongside it: the export walks the book from the
    // database, so it has to read the renumbering rather than race it.
    void saveCanonAfterStructuralChange(currentBookIdRef.current)
  }

  const isInitialChapterLoadRef = useRef(true)
  // Monotonic tag on each in-flight load. Two reloads can overlap (two quick
  // per-hit replaces on this chapter), and responses can arrive out of order —
  // without this the older payload could win and leave the editor rebuilt on
  // prose that's missing the newer replace.
  const chapterLoadSeqRef = useRef(0)
  // 'stale' = a newer load superseded this one and owns whatever happens next.
  const loadChapter = useCallback(async (): Promise<'ok' | 'stale' | 'error'> => {
    const seq = ++chapterLoadSeqRef.current
    const start = Date.now()
    let res: Response
    try {
      res = await fetch(`/api/chapters/${chapterId}`)
    } catch {
      return 'error'
    }
    if (!res.ok) return 'error'
    const data = await res.json()
    if (isInitialChapterLoadRef.current) {
      await ensureMinDuration(start)
      isInitialChapterLoadRef.current = false
    }
    if (seq !== chapterLoadSeqRef.current) return 'stale'
    setChapter(data)
    // Don't stomp a draft the writer is actively editing. A reload can now be
    // triggered by a replace in another tab, at any moment — including with
    // the cursor sitting in one of these inputs, whose value only commits on
    // blur. Mirrors the guard the series-title sync already uses.
    if (document.activeElement !== titleInputRef.current) setTitleDraft(data.title)
    // Reset POV draft + autocomplete bookkeeping every time we land on a
    // new chapter so the previous chapter's typed/rejected state doesn't
    // bleed across navigation.
    if (document.activeElement !== povInputRef.current) {
      setPovDraft(data.pov ?? '')
      typedPrefixRef.current = data.pov ?? ''
      rejectedPrefixRef.current = null
      povSyncedChapterRef.current = data.id
    }
    return 'ok'
  }, [chapterId])

  const reloadBlocks = useCallback(async () => {
    const res = await fetch(`/api/chapters/${chapterId}/blocks`)
    if (res.ok) {
      const blocks = await res.json()
      setChapter(prev => prev ? { ...prev, blocks } : null)
    }
  }, [chapterId])

  useEffect(() => { loadChapter() }, [loadChapter])

  // Find-and-replace writes straight to the database, behind this editor's
  // back. Everything mounted below still holds the pre-replace prose, and the
  // next keystroke in any of those blocks would PATCH that whole stale
  // document back — silently undoing the replacement. So rebuild from the
  // rewritten rows whenever a replace reports touching this chapter.
  //
  // The remount (via the key below) is deliberate: it rebuilds every TipTap
  // document from the new JSON with no per-surface sync guards to get wrong.
  // The writer pays a lost caret and scroll position for an operation they
  // explicitly confirmed.
  //
  // Whose words are at risk depends on where the replace came from. Same tab:
  // none — the search bar flushed this editor's queue before the server read,
  // so the discards below find nothing. Another tab: flushPendingProse is a
  // per-tab registry and cannot reach this editor, so anything still queued
  // here is unflushed typing that the reload is about to overwrite. That's
  // why the discard count is reported rather than swallowed.
  const [editorRevision, setEditorRevision] = useState(0)
  useEffect(() => {
    return subscribeProseReplaced(payload => {
      if (payload.seriesId !== seriesId) return
      if (!payload.chapterIds.includes(chapterId)) return
      // Drop anything still queued before reloading — it holds pre-replace
      // prose that would otherwise be PATCHed back over the replacement.
      let discarded = savesRef.current?.discardAll() ?? 0
      void loadChapter().then(result => {
        // A newer reload for this same chapter is already in flight; let it
        // own the rebuild rather than remounting twice on older prose.
        if (result === 'stale') return
        if (result === 'error') {
          // The rows changed but we couldn't re-read them, so this editor is
          // still showing superseded prose. Say so loudly: 'error' also
          // raises a toast, and the next keystroke here would push the old
          // text back over the replacement.
          notify('error', 'Find & replace changed this chapter, but reloading it failed. Reload the page before editing — the text on screen is out of date.')
          return
        }
        // Again after the fetch, then arm the unmount: a keystroke landing
        // mid-round-trip, or in the gap before React commits the remount,
        // queues a save built on pre-replace prose, and BlockEditor's unmount
        // would otherwise flush exactly that.
        discarded += savesRef.current?.discardAll() ?? 0
        savesRef.current?.armDiscardOnUnmount()
        setEditorRevision(r => r + 1)
        if (discarded > 0) {
          notify('warn', 'Find & replace rewrote this chapter and the editor reloaded. Unsaved edits made here while it ran were discarded — check the last thing you typed.')
        } else {
          notify('ok', 'This chapter was updated by find & replace — the editor reloaded.')
        }
      }).catch(() => {
        notify('error', 'Find & replace changed this chapter, but reloading it failed. Reload the page before editing — the text on screen is out of date.')
      })
    })
  }, [seriesId, chapterId, loadChapter])

  // Let the search bar settle this editor's write-behind queue before it asks
  // the server to read or rewrite prose.
  useEffect(() => registerProseFlush(async () => { await savesRef.current?.flushAll() }), [])

  // The sidebar's insert/delete flow auto-renumbers neighbouring chapters
  // in the DB and refetches `series` for the outline tree, but this page's
  // local chapter state was taken from the initial fetch and never re-synced
  // — so the title at the top of the page kept showing the stale value
  // even after the sidebar updated. When the series view of this chapter's
  // title shifts under us, mirror it into local state, unless the writer
  // is currently editing the title input (in which case their draft wins).
  useEffect(() => {
    if (!series) return
    const fresh = series.books.flatMap(b => b.chapters).find(c => c.id === chapterId)
    if (!fresh) return
    if (document.activeElement === titleInputRef.current) return
    setChapter(prev => (prev && prev.title !== fresh.title) ? { ...prev, title: fresh.title } : prev)
    setTitleDraft(prev => prev !== fresh.title ? fresh.title : prev)
  }, [series, chapterId])
  useEffect(() => {
    // The snapshot, never /api/writeai/characters — that endpoint writes to
    // disk on WriteAI's side and this runs on every chapter open.
    fetch('/api/writeai/characters/snapshot')
      .then(r => r.ok ? r.json() : [])
      .then((pool: { id: string; name: string; aliases: string | null; photo_url: string | null }[]) =>
        setCharacters(pool.map(c => ({ id: c.id, name: c.name, aliases: c.aliases, photoUrl: c.photo_url }))),
      )
      .catch(() => { /* the picker simply shows no characters */ })
  }, [seriesId])

  // Keep --loom-footer-h in sync so ToastLayer can sit above the footer.
  useEffect(() => {
    const el = footerRef.current
    if (!el) return
    const obs = new ResizeObserver(() => {
      document.documentElement.style.setProperty('--loom-footer-h', `${el.offsetHeight}px`)
    })
    obs.observe(el)
    document.documentElement.style.setProperty('--loom-footer-h', `${el.offsetHeight}px`)
    return () => { obs.disconnect(); document.documentElement.style.removeProperty('--loom-footer-h') }
  }, [])

  // Toasts sit in the bottom-right corner of the writing column. They used to
  // be nudged 48px further left to clear the floating add-block button; that
  // button is gone (KAN-30), so the only offset left is the reference panel —
  // without it a toast would land on top of the panel instead of the prose.
  // Bottom sits just above the sticky chapter-nav footer, which is as close to
  // the corner as it can get without being covered by it.
  useEffect(() => {
    document.documentElement.style.setProperty('--loom-toast-right', `${panelOpen ? panelWidth + 12 : 12}px`)
    document.documentElement.style.setProperty('--loom-toast-bottom', 'calc(var(--loom-footer-h, 0px) + 12px)')
    return () => {
      document.documentElement.style.removeProperty('--loom-toast-right')
      document.documentElement.style.removeProperty('--loom-toast-bottom')
    }
  }, [panelOpen, panelWidth])

  // Poll for chapterStats recomputation (LOOM-123). currentBlocksRef updates
  // on every keystroke but is a ref, so it doesn't schedule a re-render on
  // its own — this tick is what keeps the stats panel's word count from
  // going stale until some unrelated re-render (opening the panel, moving
  // focus) happens to pick up the latest text.
  useEffect(() => {
    const id = setInterval(() => setStatsTick(t => t + 1), STATS_POLL_MS)
    return () => clearInterval(id)
  }, [])

  // Keep stable refs so the hotkey listener never goes stale
  const addBlockRef = useRef<(type: string) => Promise<void>>(async () => {})
  const addChoiceBlockRef = useRef<() => Promise<void>>(async () => {})
  const createNextChapterRef = useRef<() => Promise<void>>(async () => {})
  const saveCanonRef = useRef<() => Promise<void>>(async () => {})
  const startPreviewRef = useRef<() => Promise<void>>(async () => {})
  const copyCanonTextRef = useRef<() => Promise<void>>(async () => {})
  // Mirrors the footer's prev/next buttons for the ⌥⇧←/→ hotkey. Null on
  // either end of the book, which is how the handler knows to do nothing.
  const goChapterRef = useRef<{ prev: (() => void) | null; next: (() => void) | null }>({ prev: null, next: null })

  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      if (!e.altKey || !e.shiftKey) return
      // ⌥⇧←/→ means "extend selection by word" inside prose, so chapter
      // navigation only claims it when the writer isn't in a text box.
      const t = e.target as HTMLElement | null
      const inTextBox = !!t?.closest?.('input, textarea, [contenteditable="true"]')
      switch (e.code) {
        case 'KeyT': e.preventDefault(); addBlockRef.current('text'); break
        case 'KeyQ': e.preventDefault(); addChoiceBlockRef.current(); break
        case 'KeyC': e.preventDefault(); addBlockRef.current('conditional_fragment'); break
        case 'KeyS': e.preventDefault(); addBlockRef.current('soundtrack'); break
        case 'KeyN': e.preventDefault(); createNextChapterRef.current(); break
        case 'KeyE': e.preventDefault(); saveCanonRef.current(); break
        case 'KeyP': e.preventDefault(); startPreviewRef.current(); break
        case 'KeyX': e.preventDefault(); copyCanonTextRef.current(); break
        case 'Backquote': e.preventDefault(); setShowChapterSettings(v => !v); break
        case 'KeyO': e.preventDefault(); setShowPathConfig(v => !v); break
        case 'KeyF': e.preventDefault(); setTimeout(() => { localSearchInputRef.current?.focus(); localSearchInputRef.current?.select() }, 0); break
        case 'KeyJ': e.preventDefault(); scrollToCursorRef.current?.(); break
        case 'KeyK': e.preventDefault(); setLocalSearchQuery(''); setLocalSearchReplaceMode(false); break
        case 'KeyW': e.preventDefault(); clearLensRef.current(); break
        case 'Digit0': case 'Numpad0': e.preventDefault(); setStatsOpen(v => !v); break
        case 'Digit9': case 'Numpad9': e.preventDefault(); toggleCollapseAllRef.current(); break
        // An active chapter search owns these keys; with the search bar empty
        // they fall through to the footer's prev/next chapter navigation.
        case 'ArrowRight':
          if (localSearchQueryRef.current.trim()) { e.preventDefault(); jumpToMatchRef.current?.(localSearchQueryRef.current, 'next') }
          else if (!inTextBox && goChapterRef.current.next) { e.preventDefault(); goChapterRef.current.next() }
          break
        case 'ArrowLeft':
          if (localSearchQueryRef.current.trim()) { e.preventDefault(); jumpToMatchRef.current?.(localSearchQueryRef.current, 'prev') }
          else if (!inTextBox && goChapterRef.current.prev) { e.preventDefault(); goChapterRef.current.prev() }
          break
        case 'Equal': case 'NumpadAdd': e.preventDefault(); adjustProseScale(0.1); break
        case 'Minus': case 'NumpadSubtract': e.preventDefault(); adjustProseScale(-0.1); break
        // The dock used to carry one hotkey per tab (⌥⇧2–6), numbered in strip
        // order — that grew unmanageable as tabs kept getting added (Events in
        // LOOM-36, Characters in LOOM-44). LOOM-56 collapsed it to one hotkey
        // to open/close the dock and two to step through its tabs.
        case 'Digit2': case 'Numpad2': e.preventDefault(); toggleDockRef.current(); break
        case 'Comma': if (panelOpenRef.current) { e.preventDefault(); cyclePanelTabRef.current(-1) } break
        case 'Period': if (panelOpenRef.current) { e.preventDefault(); cyclePanelTabRef.current(1) } break
      }
    }
    document.addEventListener('keydown', handleKeyDown)
    return () => document.removeEventListener('keydown', handleKeyDown)
  }, [])

  // ⌥⇧E — render the canon manuscript and save it to the book's folder on
  // disk (Settings → Export configures where).
  const { saveCanon, saveCanonAfterStructuralChange } = useCanonSave(seriesId)
  saveCanonRef.current = async () => {
    await saveCanon(series.books.find(b => b.chapters.some(c => c.id === chapterId))?.id)
  }

  // Match count for the find bar, reported up by BlockEditor from the live
  // TipTap editors. It has to come from there: chapter.blocks is only
  // refetched on structural changes, so counting that snapshot kept
  // searching pre-edit prose — after replacing "cat" with "dog" the bar
  // still reported matches for "cat". Sourcing it from the editors also
  // makes the number agree with the highlights and with what ⌥⇧→ / ⌥⇧←
  // and Replace All actually operate on.
  const [localSearchMatchCount, setLocalSearchMatchCount] = useState(0)

  async function createVariable(name: string, type: string, defaultValue?: unknown) {
    // Caller may specify defaultValue (the choice-block create form lets the
    // writer pick the canon value while creating); otherwise fall back to
    // the type's zero so existing call sites keep working.
    const resolvedDefault: unknown = defaultValue !== undefined
      ? defaultValue
      : type === 'boolean' ? false : type === 'number' ? 0 : ''
    // Stamp the variable's origin with the book this chapter belongs to,
    // so the Context modal's Origin column shows where it came from.
    const originBookId = series.books.find(b => b.chapters.some(c => c.id === chapterId))?.id ?? null
    await fetch(`/api/series/${seriesId}/variables`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name, type, defaultValue: resolvedDefault, originBookId }),
    })
    loadSeries()
  }

  function extractPlainText(jsonStr: string): string {
    try {
      const doc = JSON.parse(jsonStr) as Record<string, unknown>
      const paragraphs: string[] = []
      function walkBlock(node: Record<string, unknown>) {
        if (node.type === 'paragraph') {
          const texts: string[] = []
          function walkInline(n: Record<string, unknown>) {
            if (n.type === 'text') texts.push(String(n.text ?? ''))
            if (Array.isArray(n.content)) (n.content as Record<string, unknown>[]).forEach(walkInline)
          }
          if (Array.isArray(node.content)) (node.content as Record<string, unknown>[]).forEach(walkInline)
          paragraphs.push(texts.join(''))
        } else if (Array.isArray(node.content)) {
          (node.content as Record<string, unknown>[]).forEach(walkBlock)
        }
      }
      walkBlock(doc)
      return paragraphs.filter(p => p.length > 0).join('\n\n')
    } catch { return '' }
  }

  function handlePinText(content: string) {
    // content is already the freshest per-keystroke prose JSON from the
    // originating text/override/choice; freeze it as its own reference card.
    setPins(prev => [...prev, { pinId: crypto.randomUUID(), content }])
    // Pinning is explicit intent to look at the thing, so it always reveals the
    // panel and claims the tab — even over notes the writer was mid-sentence in.
    openPanel('refs')
  }

  /**
   * The chapter's rendered story text for the active path.
   *
   * Extracted so Copy and the review panel emit BYTE-IDENTICAL text (KAN-22).
   * The review is only trustworthy if what the reviewer read is what Copy
   * would have given you; two implementations would drift and the difference
   * would be invisible.
   *
   * Reads `currentBlocksRef` — the LIVE editor state, not the saved chapter.
   * That is what removes the resync step: the reviewer sees what is on screen,
   * with no export, no ingest, and nothing written to disk.
   */
  function buildCanonText(): string {
    if (!chapter) return ''
    const blocks = currentBlocksRef.current ?? chapter.blocks
    const storyState = buildStoryState(series.variables, lensState)
    const resolutions = resolveChapter(blocks, storyState, varTypeMap(series.variables))
    const parts: string[] = []
    for (const block of blocks) {
      const r = resolutions.get(block.id)
      if (!r?.included || !r.source) continue
      const text = substituteVarTemplates(extractPlainText(r.source), storyState, s => s)
      if (text) parts.push(text)
    }
    return parts.join('\n\n')
  }

  async function copyCanonText() {
    if (!chapter) return
    const blocks = currentBlocksRef.current ?? chapter.blocks
    // Resolve the chapter with the exact same walk the path lens uses — so
    // what Copy emits is precisely the text the editor highlights (and what
    // Preview renders) for the active path. With no lens, buildStoryState
    // returns the pure variable defaults, giving the unchanged canon copy.
    const storyState = buildStoryState(series.variables, lensState)
    const resolutions = resolveChapter(blocks, storyState, varTypeMap(series.variables))
    const parts: string[] = []
    for (const block of blocks) {
      // resolveChapter already handles gating, override/branch selection, and
      // chapter-ending truncation (post-ending blocks come back not-included),
      // so here we just emit the resolved source of every included block.
      const r = resolutions.get(block.id)
      if (!r?.included || !r.source) continue
      const text = substituteVarTemplates(extractPlainText(r.source), storyState, s => s)
      if (text) parts.push(text)
    }
    try {
      await navigator.clipboard.writeText(parts.join('\n\n'))
      setCopyDone(true)
      setTimeout(() => setCopyDone(false), 2000)
      showToast({ kind: 'ok', message: 'Copy successful' })
    } catch {
      showToast({ kind: 'error', message: 'Copy failed' })
    }
  }
  // Live ref so the panel always reads current blocks and lens without being
  // re-rendered on every keystroke.
  const buildCanonTextRef = useRef(buildCanonText)
  buildCanonTextRef.current = buildCanonText
  copyCanonTextRef.current = copyCanonText

  async function handleDeleteChapter() {
    const book = series.books.find(b => b.chapters.some(c => c.id === chapterId))
    if (!book) return
    await fetch(`/api/series/${seriesId}/books/${book.id}/chapters/${chapterId}`, { method: 'DELETE' })
    await loadSeries()
    router.push(`/author/${seriesId}/book/${book.id}`)
  }

  // Generalised "<prefix> <number>" bump: "Chapter 14" → "Chapter 15",
  // "Bonus Chapter 1" → "Bonus Chapter 2", "14" → "15". Anything that
  // doesn't fit the pattern gets " (cont.)" appended so the footer still
  // produces something unique.
  function bumpChapterTitle(title: string): string {
    const bare = /^(\d+)$/.exec(title)
    if (bare) return String(Number(bare[1]) + 1)
    const m = /^(.+\s)(\d+)$/.exec(title)
    if (m) return `${m[1]}${Number(m[2]) + 1}`
    return `${title} (cont.)`
  }

  async function createNextChapter() {
    const book = series.books.find(b => b.chapters.some(c => c.id === chapterId))
    const activeMeta = book?.chapters.find(c => c.id === chapterId)
    if (!book || !chapter || !activeMeta) return
    // Insert right after the active chapter (LOOM-52) rather than appending
    // at the end — insertAtOrder tells the route to shift every chapter from
    // there on by one, bumping their titles too when they share this title's
    // numbering prefix. Without it, "Chapter 29" open with a "Chapter 30"
    // already existing produced two "Chapter 30"s instead of a real insert.
    const res = await fetch(`/api/series/${seriesId}/books/${book.id}/chapters`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ title: bumpChapterTitle(chapter.title), insertAtOrder: activeMeta.order + 1 }),
    })
    if (!res.ok) return
    const created = await res.json()
    await loadSeries()
    router.push(`/author/${seriesId}/chapter/${created.id}?focus=pov`)
  }
  createNextChapterRef.current = createNextChapter

  // Open the reader on this chapter, with a return path back to the editor.
  async function startPreview() {
    const res = await fetch('/api/sessions', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ seriesId }) })
    const session = await res.json()
    router.push(`/author/preview/session/${session.id}?returnTo=/author/${seriesId}/chapter/${chapterId}&startChapterId=${chapterId}`)
  }
  startPreviewRef.current = startPreview

  function scrollToTop() {
    // The author layout's <main> is the scroll container; scrollTo it
    // directly so the chapter page glides back to the top.
    document.querySelector('main')?.scrollTo({ top: 0, behavior: 'smooth' })
  }

  async function addChoiceBlock() {
    await addBlock('choice_point')
  }

  async function addBlock(type: string) {
    const activeBlock = activeBlockId ? chapter?.blocks.find(b => b.id === activeBlockId) : null
    const insertAtOrder = activeBlock ? activeBlock.order + 1 : undefined
    await fetch(`/api/chapters/${chapterId}/blocks`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        type,
        insertAtOrder,
        ...(type === 'text' && { content: '{"type":"doc","content":[{"type":"paragraph"}]}' }),
        ...(type === 'choice_point' && { displayType: 'inline' }),
        ...(type === 'conditional_fragment' && { baseContent: '{"type":"doc","content":[{"type":"paragraph"}]}' }),
      }),
    })
    await reloadBlocks()
    // Sidebar's CHOICES list keys off choice_point blocks; refresh on every
    // create path (hotkey, sidebar "+") rather than only addChoiceBlock.
    if (type === 'choice_point') loadChoices()
  }

  // Always point at the latest versions of these functions
  addBlockRef.current = addBlock
  addChoiceBlockRef.current = addChoiceBlock

  // Number of questions the active path answers — shown on the Path chip.
  const lensAnsweredCount = Object.values(lensSelections).filter(Boolean).length
  // Under the active path, does this chapter's own visibility gate fail? If so
  // the reader wouldn't see it at all on this path — surface that up top.
  const chapterHiddenOnPath = useMemo(() => {
    if (!lensState || !chapter?.condition) return false
    const cond = safeCondition(chapter.condition)
    if (!cond) return false
    return !matchesCondition(cond, buildStoryState(series.variables, lensState))
  }, [lensState, chapter?.condition, series.variables])

  if (!chapter) return <ChapterSkeleton />

  // Prev/next within the same book — chapters are already ordered by `order`
  // by the layout's series fetch, so a simple findIndex walk is enough.
  const currentBook = series.books.find(b => b.chapters.some(c => c.id === chapterId))
  const bookChapters = currentBook?.chapters ?? []
  const currentIdx = bookChapters.findIndex(c => c.id === chapterId)
  const prevChapter = currentIdx > 0 ? bookChapters[currentIdx - 1] : null
  const nextChapter = currentIdx >= 0 && currentIdx < bookChapters.length - 1 ? bookChapters[currentIdx + 1] : null

  // "There is something here you can't see" — drives the dot on the collapsed
  // ☰ button. Notes and reviews used to advertise themselves on their own
  // header buttons; folded into a menu, that signal has to surface on the
  // menu itself or it's invisible until you open it.
  const notesUnseen = hasNotes && !(panelOpen && panelTab === 'notes')
  const reviewUnseen = hasReview && !(panelOpen && panelTab === 'review')

  // Hand the same two jumps to the ⌥⇧←/→ handler, so the hotkey and the
  // footer buttons can never disagree about where the ends of the book are.
  goChapterRef.current = {
    prev: prevChapter ? () => router.push(`/author/${seriesId}/chapter/${prevChapter.id}`) : null,
    next: nextChapter ? () => router.push(`/author/${seriesId}/chapter/${nextChapter.id}`) : null,
  }

  // Chapter stats (LOOM-109) — resolved off the same live editor state and
  // path lens as Copy/Review (buildCanonText), so the numbers agree with
  // what those already show for the active path. statsTick is otherwise
  // unused below; it exists purely to force this recompute on a timer
  // (LOOM-123).
  void statsTick
  const chapterStats = computeChapterStats(buildCanonText())

  return (
    // flex row: the writing column fills the layout's <main> scroll container;
    // an optional reference panel docks to its right. min-w-0 on the column
    // lets it shrink (rather than overflow) when the panel takes its width.
    <div className="flex min-h-full">
    <div className="flex-1 min-w-0 px-8 min-h-full flex flex-col">
      <div className="pb-3 flex-1">
        {/* Above the sticky header, so it is the first thing on the page
            rather than something found on the way to the prose (LOOM-122).
            Deliberately NOT inside the sticky box: that block publishes its
            own height as --loom-chapter-header-h for every scroll target on
            the page, and a banner that expands and collapses inside it would
            move all of them. Renders nothing when the chapter is clean. */}
        <ChapterReachabilityBanner seriesId={seriesId} chapterId={chapterId} />

        {/* Chapter header — sticky to the top of <main>'s scroll area so the
            title, POV, date, find bar, collapse-all and ☰ action menu stay
            reachable at any depth in the chapter (KAN-30).
            - -mx-8 px-8 makes the opaque background span the full column so
              prose scrolls under it rather than beside it.
            - bg-surface-base tracks the theme through .light-body, which
              redefines the token (unlike a hardcoded hex — see KAN-6/KAN-17).
            - z-[45] clears the sticky footer (z-40) so the find-bar's replace
              popover and the ☰ menu aren't clipped by it on a short window;
              modals are fixed at z-50 and still win.
            - pb-2 rather than a margin on the last row: a margin would collapse
              out of the sticky box and let prose scroll flush against its edge.
            - If you change this block's structure, update ChapterSkeleton.tsx's
              header placeholder to match — it drifted silently after KAN-30
              until LOOM-49 caught it. */}
        <div ref={headerRef} className="@container sticky top-0 z-[45] -mx-8 px-8 pt-3 pb-2 bg-surface-base">
          {/* Title + POV — centered */}
          <div className="flex flex-col items-center mb-8">
            <input
              ref={titleInputRef}
              value={titleDraft}
              onChange={e => setTitleDraft(e.target.value)}
              onBlur={handleTitleBlur}
              className="w-full bg-transparent border-none outline-none text-center text-3xl font-bold uppercase text-ink tracking-wide focus:opacity-80 transition-opacity"
            />
            <input
              ref={povInputRef}
              value={povDraft}
              onChange={handlePovChange}
              onKeyDown={handlePovKeyDown}
              onBlur={() => {
                const committed = povDraft.trim()
                // If the writer left without rejecting, accept the visible
                // value (which may include the suggestion's tail).
                if (committed !== (chapter.pov ?? '')) handleMetaChange('pov', committed)
                typedPrefixRef.current = committed
              }}
              placeholder="POV"
              className="mt-1 bg-surface-raised border border-accent/20 rounded-lg px-3 py-1 text-sm text-ink placeholder:text-ink-faint outline-none focus:border-accent text-center w-48"
            />
          </div>

          {/* Date · chapter search · collapse-all — all in one row.
              Right padding matches the per-block delete/chevron column
              (15px icon + ml-2 gap) so the toggle's right edge aligns with
              each block's content right edge, not the outer container. */}
          <div className="flex items-center gap-4">
            <input
              value={chapter.date ?? ''}
              onChange={e => handleMetaChange('date', e.target.value)}
              onFocus={e => e.target.setSelectionRange(0, 0)}
              className="bg-surface-raised border border-accent/20 rounded-lg px-3 py-2 text-sm text-ink placeholder:text-ink-faint outline-none focus:border-accent w-60 @max-[820px]:w-40 shrink-0"
            />

            <div className="ml-auto flex items-center gap-4 min-w-0">
              {/* Chapter-local find bar — always visible, styled like the global series search.
                  flex-1 + min-w lets it actually shrink with the row instead of holding a fixed
                  width and forcing the collapse/stats buttons off-screen. */}
              <div className="relative flex items-center flex-1 min-w-32 max-w-72 @max-[820px]:max-w-56">
                <LuSearch size={12} className="absolute left-2 text-ink-faint pointer-events-none" />
                <input
                  ref={localSearchInputRef}
                  value={localSearchQuery}
                  onChange={e => setLocalSearchQuery(e.target.value)}
                  onKeyDown={e => {
                    if (e.key === 'Escape') { setLocalSearchQuery(''); setLocalSearchReplaceMode(false); e.currentTarget.blur() }
                    if (e.key === 'Enter') jumpToFirstMatchRef.current?.(localSearchQuery)
                  }}
                  placeholder={compactSearch ? 'Search…' : 'Find in chapter… (⌥⇧F)'}
                  title="Find in chapter (⌥⇧F)"
                  className={`w-full pl-7 py-1.5 text-xs bg-surface-base border border-accent/20 rounded-lg text-ink placeholder:text-ink-faint outline-none focus:border-accent/50 ${compactSearch ? 'pr-14' : 'pr-[104px]'}`}
                />
                <div className="absolute right-1.5 flex items-center gap-0.5">
                  {localSearchQuery && localSearchMatchCount > 0 && (
                    <span className="text-[10px] text-ink-faint mr-0.5 tabular-nums">{localSearchMatchCount}</span>
                  )}
                  {localSearchQuery && (
                    <button onClick={() => setLocalSearchQuery('')} className="text-ink-faint hover:text-ink p-0.5" title="Clear">
                      <LuX size={12} />
                    </button>
                  )}
                  {compactSearch ? (
                    <div ref={searchOptionsRef} className="relative">
                      <button
                        onClick={() => setSearchOptionsOpen(o => !o)}
                        title="Search options"
                        aria-haspopup="menu"
                        aria-expanded={searchOptionsOpen}
                        className={`p-0.5 rounded transition ${
                          matchCase || matchWord || localSearchReplaceMode || searchOptionsOpen ? 'text-accent bg-accent/10' : 'text-ink-faint hover:text-ink'
                        }`}
                      >
                        <LuSlidersHorizontal size={12} />
                      </button>
                      {searchOptionsOpen && (
                        <div
                          role="menu"
                          className="absolute top-full right-0 mt-1.5 z-50 w-44 bg-surface-raised border border-accent/20 rounded-xl shadow-xl p-1 flex flex-col"
                        >
                          <button
                            onClick={toggleMatchCase}
                            aria-pressed={matchCase}
                            className={`flex items-center gap-2 px-2 py-1.5 rounded-lg text-xs text-left transition ${matchCase ? 'text-accent bg-accent/10' : 'text-ink-muted hover:text-ink hover:bg-surface-base'}`}
                          >
                            <LuCaseSensitive size={13} className="shrink-0" />
                            Match case
                          </button>
                          <button
                            onClick={toggleMatchWord}
                            aria-pressed={matchWord}
                            className={`flex items-center gap-2 px-2 py-1.5 rounded-lg text-xs text-left transition ${matchWord ? 'text-accent bg-accent/10' : 'text-ink-muted hover:text-ink hover:bg-surface-base'}`}
                          >
                            <LuWholeWord size={13} className="shrink-0" />
                            Match whole word
                          </button>
                          <button
                            onClick={() => { setLocalSearchReplaceMode(m => !m); setSearchOptionsOpen(false) }}
                            aria-pressed={localSearchReplaceMode}
                            className={`flex items-center gap-2 px-2 py-1.5 rounded-lg text-xs text-left transition ${localSearchReplaceMode ? 'text-accent bg-accent/10' : 'text-ink-muted hover:text-ink hover:bg-surface-base'}`}
                          >
                            <LuReplace size={12} className="shrink-0" />
                            Find and replace
                          </button>
                        </div>
                      )}
                    </div>
                  ) : (
                    <>
                      <button
                        onClick={toggleMatchCase}
                        title="Match case"
                        aria-pressed={matchCase}
                        className={`p-0.5 rounded transition ${matchCase ? 'text-accent bg-accent/10' : 'text-ink-faint hover:text-ink'}`}
                      >
                        <LuCaseSensitive size={13} />
                      </button>
                      <button
                        onClick={toggleMatchWord}
                        title="Match whole word"
                        aria-pressed={matchWord}
                        className={`p-0.5 rounded transition ${matchWord ? 'text-accent bg-accent/10' : 'text-ink-faint hover:text-ink'}`}
                      >
                        <LuWholeWord size={13} />
                      </button>
                      <button
                        onClick={() => setLocalSearchReplaceMode(m => !m)}
                        title={localSearchReplaceMode ? 'Hide replace' : 'Find and replace'}
                        className={`p-0.5 transition ${localSearchReplaceMode ? 'text-accent' : 'text-ink-faint hover:text-ink'}`}
                      >
                        <LuReplace size={11} />
                      </button>
                    </>
                  )}
                </div>

                {/* Replace field — popover anchored below the search bar. */}
                {localSearchReplaceMode && (
                  <div className="absolute top-full right-0 mt-1.5 z-50 w-72 bg-surface-raised border border-accent/20 rounded-xl shadow-xl p-2 flex items-center gap-2">
                    <input
                      value={localSearchReplace}
                      onChange={e => setLocalSearchReplace(e.target.value)}
                      onKeyDown={e => { if (e.key === 'Escape') { setLocalSearchReplaceMode(false); localSearchInputRef.current?.focus() } }}
                      placeholder="Replace with…"
                      autoFocus
                      className="flex-1 px-3 py-1.5 text-xs bg-surface-base border border-accent/20 rounded-lg text-ink placeholder:text-ink-faint outline-none focus:border-accent/50"
                    />
                    <button
                      onClick={() => replaceAllRef.current?.(localSearchQuery, localSearchReplace)}
                      disabled={!localSearchQuery}
                      className="shrink-0 px-3 py-1.5 text-xs border border-accent/40 text-accent rounded-lg hover:bg-accent/10 transition disabled:opacity-40"
                    >
                      Replace All
                    </button>
                  </div>
                )}
              </div>

              {chapter.blocks.length > 0 && (() => {
                const anyCollapsed = chapter.blocks.some(b => collapsedIds.has(b.id))
                return (
                  <button
                    onClick={() => {
                      if (anyCollapsed) setCollapsedIds(new Set())
                      else setCollapsedIds(new Set(chapter.blocks.map(b => b.id)))
                    }}
                    title={`${anyCollapsed ? 'Expand' : 'Collapse'} all (⌥⇧9)`}
                    className="flex items-center gap-1.5 text-xs text-ink-muted hover:text-ink transition shrink-0"
                  >
                    {anyCollapsed ? <LuChevronsUpDown size={12} /> : <LuChevronsDownUp size={12} />}
                    <span className="@max-[820px]:hidden">{anyCollapsed ? 'Expand All' : 'Collapse All'}</span>
                  </button>
                )
              })()}

              {/* Chapter stats (LOOM-109) — word count, reading time, and
                  (heuristic) dialogue % / filter-word count for the resolved
                  chapter text. Word count always shows on the collapsed
                  button so it's readable without opening the panel. */}
              <div ref={statsMenuRef} className="relative shrink-0">
                <button
                  onClick={() => setStatsOpen(o => !o)}
                  title="Chapter stats (⌥⇧0)"
                  aria-label="Chapter stats"
                  aria-haspopup="menu"
                  aria-expanded={statsOpen}
                  className={`flex items-center gap-1.5 h-[26px] px-2.5 rounded-lg border text-xs font-medium transition ${
                    statsOpen ? 'border-accent/40 text-ink bg-surface-raised' : 'border-accent/20 text-ink-muted hover:text-ink hover:border-accent/40'
                  }`}
                >
                  <LuChartNoAxesColumn size={13} className="text-accent shrink-0" />
                  <span className="tabular-nums @max-[820px]:hidden">{chapterStats.words.toLocaleString()} words</span>
                </button>

                {statsOpen && (
                  <div
                    role="menu"
                    className="absolute right-0 top-full mt-2 z-50 w-[276px] rounded-xl border border-accent/20 bg-surface-raised shadow-xl p-3.5"
                  >
                    <div className="flex items-center justify-between mb-3 px-0.5">
                      <span className="text-[11px] font-bold uppercase tracking-widest text-ink-faint">Chapter Stats</span>
                      <span className="flex gap-0.5 text-[10px] font-semibold text-ink-faint">
                        <kbd className="rounded border border-b-2 border-accent/10 bg-surface-muted px-1 py-px text-ink-muted">⌥</kbd>
                        <kbd className="rounded border border-b-2 border-accent/10 bg-surface-muted px-1 py-px text-ink-muted">⇧</kbd>
                        <kbd className="rounded border border-b-2 border-accent/10 bg-surface-muted px-1 py-px text-ink-muted">0</kbd>
                      </span>
                    </div>

                    <div className="grid grid-cols-2 gap-2">
                      <div className="flex flex-col gap-0.5 rounded-lg border border-accent/10 bg-surface-base px-3 py-2.5">
                        <span className="text-[17px] font-bold tabular-nums text-ink">{chapterStats.words.toLocaleString()}</span>
                        <span className="text-[10px] font-semibold uppercase tracking-wider text-ink-faint">Words</span>
                      </div>
                      <div className="flex flex-col gap-0.5 rounded-lg border border-accent/10 bg-surface-base px-3 py-2.5">
                        <span className="text-[17px] font-bold tabular-nums text-ink">{chapterStats.readingMinutes} min</span>
                        <span className="text-[10px] font-semibold uppercase tracking-wider text-ink-faint">Reading time</span>
                      </div>
                      <div className="flex flex-col gap-0.5 rounded-lg border border-accent/10 bg-surface-base px-3 py-2.5">
                        <span className="text-[17px] font-bold tabular-nums text-accent">
                          {chapterStats.dialoguePercent === null ? '—' : `${chapterStats.dialoguePercent}%`}
                        </span>
                        <span className="flex items-center gap-1 text-[10px] font-semibold uppercase tracking-wider text-ink-faint">
                          <span aria-hidden className="h-1 w-1 shrink-0 rounded-full bg-accent" />
                          Dialogue
                        </span>
                      </div>
                      <div className="flex flex-col gap-0.5 rounded-lg border border-accent/10 bg-surface-base px-3 py-2.5">
                        <span className="text-[17px] font-bold tabular-nums text-accent">{chapterStats.filterWordCount}</span>
                        <span className="flex items-center gap-1 text-[10px] font-semibold uppercase tracking-wider text-ink-faint">
                          <span aria-hidden className="h-1 w-1 shrink-0 rounded-full bg-accent" />
                          Filter words
                        </span>
                      </div>
                    </div>

                    <p className="mt-2.5 px-0.5 text-[10.5px] leading-relaxed text-ink-faint">
                      <span aria-hidden className="mr-1 inline-block h-1 w-1 -translate-y-px rounded-full bg-accent" />
                      Dialogue and filter-word counts are estimates.
                    </p>
                  </div>
                )}
              </div>

              {/* ☰ chapter actions. Everything that used to be a row of buttons
                  above the title now lives here (KAN-30). The button itself
                  carries the state those buttons used to show at a glance: an
                  accent tint while a path lens is active, and a dot when this
                  chapter has notes or a stored review you can't currently see. */}
              <div ref={actionMenuRef} className="relative shrink-0">
                <button
                  onClick={() => setActionMenuOpen(o => !o)}
                  title="Chapter actions"
                  aria-label="Chapter actions"
                  aria-haspopup="menu"
                  aria-expanded={actionMenuOpen}
                  className={`relative flex items-center rounded p-1 transition ${
                    lensState ? 'text-accent' : actionMenuOpen ? 'text-ink' : 'text-ink-muted hover:text-ink'
                  }`}
                >
                  <LuMenu size={16} />
                  {(notesUnseen || reviewUnseen) && !actionMenuOpen && (
                    <span aria-hidden className="absolute top-0.5 right-0.5 h-1.5 w-1.5 rounded-full bg-accent" />
                  )}
                </button>

                {actionMenuOpen && (
                  <div
                    role="menu"
                    className="absolute right-0 top-full mt-2 z-50 min-w-[210px] overflow-hidden rounded-lg border border-accent/20 bg-surface-raised shadow-xl"
                  >
                    {/* Review opens the dock, it no longer opens WriteAI (KAN-22).
                        The round trip through a second tab was the whole
                        painpoint; the sparkle in the header remains the
                        deliberate way over there. */}
                    <button
                      role="menuitem"
                      onClick={() => { setActionMenuOpen(false); togglePanelTab('review') }}
                      title={hasReview
                        ? 'Shows this chapter’s latest WriteAI review beside the editor, so you can revise against it without leaving Loom.'
                        : 'Opens the review panel. No review is stored for this chapter yet — start one in WriteAI via the sparkle in the header.'}
                      className="flex w-full items-center gap-3 px-4 py-2.5 text-left text-sm text-ink-muted transition hover:bg-surface-overlay hover:text-ink"
                    >
                      <span className="flex w-5 items-center justify-center text-accent"><LuScanText size={14} /></span>
                      <span className="flex-1">Review</span>
                      {hasReview && <span aria-hidden className="h-1.5 w-1.5 rounded-full bg-accent" />}
                      <span className="text-[10px] tabular-nums text-ink-faint">⌥⇧2</span>
                    </button>
                    <button
                      role="menuitem"
                      onClick={() => { setActionMenuOpen(false); startPreview() }}
                      title="Read this chapter in the reader, then come back here. (⌥⇧P)"
                      className="flex w-full items-center gap-3 px-4 py-2.5 text-left text-sm text-ink-muted transition hover:bg-surface-overlay hover:text-ink"
                    >
                      <span className="flex w-5 items-center justify-center text-accent"><LuPlay size={14} /></span>
                      <span className="flex-1">Preview</span>
                      <span className="text-[10px] tabular-nums text-ink-faint">⌥⇧P</span>
                    </button>
                    {/* Left open on click so the label's "Copied!" confirmation
                        is actually visible — every other item closes the menu. */}
                    <button
                      role="menuitem"
                      onClick={copyCanonText}
                      title={lensState
                        ? "Copies this chapter's story text for the active path — the same text Preview renders with that context. (⌥⇧X)"
                        : "Copies this chapter's canon story text to your clipboard — the rendered text as it would appear in the published book. (⌥⇧X)"}
                      className="flex w-full items-center gap-3 px-4 py-2.5 text-left text-sm text-ink-muted transition hover:bg-surface-overlay hover:text-ink"
                    >
                      <span className="flex w-5 items-center justify-center text-accent"><PiCopySimpleThin size={16} /></span>
                      <span className="flex-1">{copyDone ? 'Copied!' : 'Copy'}</span>
                      <span className="text-[10px] tabular-nums text-ink-faint">⌥⇧X</span>
                    </button>
                    {/* Path lens — configure a context and the editor dims
                        off-path text (Copy and Preview follow the same path).
                        When one is active the row shows how many questions it
                        answers and grows an inline ✕ to clear it, exactly as the
                        old header chip did. ⌥⇧W clears it from the keyboard. */}
                    <div className={`flex items-center ${lensState ? 'bg-accent/5' : ''}`}>
                      <button
                        role="menuitem"
                        onClick={() => { setActionMenuOpen(false); setShowPathConfig(true) }}
                        title="Configure a context path — the editor highlights the blocks and branches on that path and dims the rest. Copy and Preview follow the same path. (⌥⇧O)"
                        className={`flex flex-1 items-center gap-3 px-4 py-2.5 text-left text-sm transition hover:bg-surface-overlay hover:text-ink ${lensState ? 'text-accent' : 'text-ink-muted'}`}
                      >
                        <span className="flex w-5 items-center justify-center text-accent"><LuRoute size={14} /></span>
                        <span className="flex-1">{lensState ? `Path · ${lensAnsweredCount}` : 'Path'}</span>
                        <span className="text-[10px] tabular-nums text-ink-faint">⌥⇧O</span>
                      </button>
                      {lensState && (
                        <button
                          onClick={() => { setActionMenuOpen(false); clearLensRef.current() }}
                          title="Clear path (⌥⇧W)"
                          aria-label="Clear path"
                          className="flex items-center px-3 py-2.5 text-accent transition hover:bg-surface-overlay"
                        >
                          <LuX size={13} />
                        </button>
                      )}
                    </div>
                    {/* Sits beside Notes rather than beside Review because both
                        are things the chapter *carries*, not things you run on
                        it. The dot counts resolved tags, so it agrees with what
                        the panel will actually list. */}
                    <button
                      role="menuitem"
                      onClick={() => { setActionMenuOpen(false); togglePanelTab('events') }}
                      title="Events referenced in this chapter (⌥⇧2)"
                      className="flex w-full items-center gap-3 px-4 py-2.5 text-left text-sm text-ink-muted transition hover:bg-surface-overlay hover:text-ink"
                    >
                      <span className="flex w-5 items-center justify-center text-accent"><LuCalendarDays size={14} /></span>
                      <span className="flex-1">Events</span>
                      {chapterEvents.count > 0 && (
                        <span aria-hidden className="h-1.5 w-1.5 rounded-full bg-accent" />
                      )}
                      <span className="text-[10px] tabular-nums text-ink-faint">⌥⇧2</span>
                    </button>
                    <button
                      role="menuitem"
                      onClick={() => { setActionMenuOpen(false); togglePanelTab('characters') }}
                      title="Characters appearing in this chapter (⌥⇧2)"
                      className="flex w-full items-center gap-3 px-4 py-2.5 text-left text-sm text-ink-muted transition hover:bg-surface-overlay hover:text-ink"
                    >
                      <span className="flex w-5 items-center justify-center text-accent"><LuUsers size={14} /></span>
                      <span className="flex-1">Characters</span>
                      {chapterCharacters.count > 0 && (
                        <span aria-hidden className="h-1.5 w-1.5 rounded-full bg-accent" />
                      )}
                      <span className="text-[10px] tabular-nums text-ink-faint">⌥⇧2</span>
                    </button>
                    {/* No unseen-dot here, unlike its neighbours: theirs counts
                        the writer's own tags, and a dot for "WriteAI has read
                        this" would be permanently lit on every ingested
                        chapter, which is no signal at all. */}
                    <button
                      role="menuitem"
                      onClick={() => { setActionMenuOpen(false); togglePanelTab('insights') }}
                      title="What WriteAI extracted from this chapter (⌥⇧2)"
                      className="flex w-full items-center gap-3 px-4 py-2.5 text-left text-sm text-ink-muted transition hover:bg-surface-overlay hover:text-ink"
                    >
                      <span className="flex w-5 items-center justify-center text-accent"><LuLightbulb size={14} /></span>
                      <span className="flex-1">Insights</span>
                      <span className="text-[10px] tabular-nums text-ink-faint">⌥⇧2</span>
                    </button>
                    {/* The dot means this chapter has notes you can't currently
                        see — it clears once the panel is showing them. */}
                    <button
                      role="menuitem"
                      onClick={() => { setActionMenuOpen(false); togglePanelTab('notes') }}
                      title="Chapter notes (⌥⇧2)"
                      className="flex w-full items-center gap-3 px-4 py-2.5 text-left text-sm text-ink-muted transition hover:bg-surface-overlay hover:text-ink"
                    >
                      <span className="flex w-5 items-center justify-center text-accent"><PiNotebookThin size={16} /></span>
                      <span className="flex-1">Notes</span>
                      {hasNotes && <span aria-hidden className="h-1.5 w-1.5 rounded-full bg-accent" />}
                      <span className="text-[10px] tabular-nums text-ink-faint">⌥⇧2</span>
                    </button>
                    <button
                      role="menuitem"
                      onClick={() => { setActionMenuOpen(false); setShowChapterSettings(true) }}
                      title="Chapter settings — numbering, visibility gate, delete (⌥⇧`)"
                      className="flex w-full items-center gap-3 px-4 py-2.5 text-left text-sm text-ink-muted transition hover:bg-surface-overlay hover:text-ink"
                    >
                      <span className="flex w-5 items-center justify-center text-accent"><LuSettings size={14} /></span>
                      <span className="flex-1">Settings</span>
                      <span className="text-[10px] tabular-nums text-ink-faint">⌥⇧`</span>
                    </button>
                  </div>
                )}
              </div>
            </div>
          </div>
        </div>

        {chapterHiddenOnPath && (
          <div className="mb-3 flex items-center gap-2 rounded-lg border border-accent/30 bg-accent/5 px-3 py-2 text-xs text-ink-muted">
            <LuRoute size={13} className="text-accent shrink-0" />
            <span>The reader wouldn&apos;t see this chapter on the active path — its visibility gate doesn&apos;t match.</span>
            <button onClick={clearLensRef.current} className="ml-auto shrink-0 text-accent hover:underline">Clear path</button>
          </div>
        )}

        {/* Each block row reserves a 23px gutter on its right (8px gap + the
            15px delete/collapse column), which made the cards sit 23px further
            from the right edge of the page than the left. Pulling the rows out
            over the column's right padding lands the card edges symmetrically
            inside px-8 — the space the floating add button used to justify. */}
        <div className="-mr-[23px]">
        <BlockEditor
          key={`${chapter.id}:${editorRevision}`}
          chapterId={chapterId}
          blocks={chapter.blocks}
          variables={series.variables}
          lensState={lensState}
          characters={characters}
          onBlocksChange={reloadBlocks}
          onChoicesChanged={loadChoices}
          onCreateVariable={createVariable}
          onActiveBlockChange={setActiveBlockId}
          collapsedIds={collapsedIds}
          onCollapsedIdsChange={setCollapsedIds}
          searchQuery={debouncedSearchQuery || (searchParams?.get('q') ?? '')}
          searchOptions={debouncedSearchQuery
            ? { caseSensitive: matchCase, wholeWord: matchWord }
            : { caseSensitive: searchParams?.get('qc') === '1', wholeWord: searchParams?.get('qw') === '1' }}
          replaceAllRef={replaceAllRef}
          jumpToFirstMatchRef={jumpToFirstMatchRef}
          jumpToMatchRef={jumpToMatchRef}
          onMatchCountChange={setLocalSearchMatchCount}
          savesRef={savesRef}
          scrollToCursorRef={scrollToCursorRef}
          currentBlocksRef={currentBlocksRef}
          onTextBlockBlur={handleTextBlockBlur}
          onPinText={handlePinText}
        />
        </div>
      </div>

      {/* Bottom chapter nav. Mirrors the reader's prev/next footer so the
          writer has a fast hop between chapters at the end of a session.
          - sticky bottom-0 pins it to the bottom of <main>'s scroll area
            (the layout's only scroll container).
          - -mx-8 px-8 stretches the top border edge-to-edge while keeping
            the button column lined up with the rest of the page.
          - .chrome-dark keeps the footer dark in light mode too — matching
            the reader, which gets that for free by living outside the
            light-body wrapper. It used to hardcode the dark hexes inline,
            which pinned the bar to the old palette no matter what
            UNIFIED_CHROME said (KAN-17). */}
      <footer
        ref={footerRef}
        style={{
          // When the reference panel is open, stretch the bar back out to the
          // full width so it looks identical to its closed state — the panel
          // ends at the footer's top, so the buttons never collide with it.
          marginRight: panelOpen ? `calc(-2rem - ${panelWidth}px)` : undefined,
        } as React.CSSProperties}
        className="chrome-dark sticky bottom-0 z-40 -mx-8 px-4 py-4 bg-surface-raised border-t border-accent/10 flex items-center justify-between gap-4"
      >
        {prevChapter ? (
          <button
            onClick={() => router.push(`/author/${seriesId}/chapter/${prevChapter.id}`)}
            className="shrink-0 flex items-center gap-1.5 text-xs text-ink-muted hover:text-ink transition"
          >
            <LuArrowLeft size={13} /> {prevChapter.title}
          </button>
        ) : <div />}

        <button
          onClick={scrollToTop}
          className="flex items-center gap-1.5 text-xs text-ink-muted hover:text-ink transition"
        >
          <LuArrowUp size={13} /> Scroll To The Top
        </button>

        {nextChapter ? (
          <button
            onClick={() => router.push(`/author/${seriesId}/chapter/${nextChapter.id}`)}
            className="shrink-0 flex items-center gap-1.5 text-xs text-ink-muted hover:text-ink transition"
          >
            {nextChapter.title} <LuArrowRight size={13} />
          </button>
        ) : (
          <button
            onClick={createNextChapter}
            title="Create next chapter (⌥⇧N)"
            className="shrink-0 flex items-center gap-1.5 text-xs text-ink-muted hover:text-ink transition"
          >
            Create Next Chapter <LuPlus size={13} />
          </button>
        )}
      </footer>

      {showChapterSettings && (
        <div
          className="fixed inset-0 bg-black/60 flex items-start justify-center z-50"
          style={{ paddingTop: 'calc(60px + 8vh)', paddingLeft: '14rem' }}
          onClick={() => setShowChapterSettings(false)}
        >
          <div
            className="bg-surface-raised border border-accent/20 rounded-xl p-6 max-w-md w-full mx-8 shadow-2xl relative"
            onClick={e => e.stopPropagation()}
          >
            <div className="flex items-center justify-between mb-5">
              <h2 className="text-sm font-semibold text-ink uppercase tracking-widest">Chapter Settings</h2>
              <button onClick={() => setShowChapterSettings(false)} className="text-ink-faint hover:text-ink"><LuX size={16} /></button>
            </div>

            <div className="flex flex-col gap-4">
              <div>
                <label className="flex items-center gap-2 text-sm text-ink-muted cursor-pointer">
                  <input
                    type="checkbox"
                    checked={chapter.numbered}
                    onChange={e => handleNumberedChange(e.target.checked)}
                    className="accent-accent"
                  />
                  <span>Auto-numbered chapter</span>
                </label>
                <p className="text-xs text-ink-faint italic mt-1 ml-6">
                  {chapter.numbered
                    ? 'Reader sees "Chapter N", auto-counted across visible chapters.'
                    : 'Reader sees the title verbatim — Prologue, Epilogue, etc.'}
                </p>
              </div>

              <ConditionRow
                condition={chapter.condition}
                variables={series.variables}
                onChange={handleConditionChange}
                polarityToggle
                labelExtra={
                  <span
                    className="relative inline-flex"
                    onMouseEnter={() => setShowIfTooltip(true)}
                    onMouseLeave={() => setShowIfTooltip(false)}
                  >
                    <LuCircleHelp size={12} className="text-ink-faint hover:text-ink transition cursor-help" />
                    {showIfTooltip && (
                      <span className="absolute left-full top-1/2 -translate-y-1/2 ml-2 z-50 w-60 bg-surface-overlay border border-accent/20 rounded px-3 py-2 text-xs text-ink-muted shadow-lg normal-case tracking-normal font-normal leading-snug">
                        Pick variables and the values they must have. SHOW IF renders the chapter only when the clauses match; HIDE IF renders it unless they match. Leave empty to always show.
                      </span>
                    )}
                  </span>
                }
              />
            </div>

            <div className="mt-4 pt-4 border-t border-choice-kill/20">
              <button
                onClick={() => { setShowChapterSettings(false); setShowDeleteConfirm(true) }}
                className="w-full px-3 py-2 rounded text-xs border border-choice-kill/30 text-choice-kill hover:bg-choice-kill/10 transition"
              >
                Delete Chapter
              </button>
            </div>
          </div>
        </div>
      )}

      {showDeleteConfirm && (
        <div
          className="fixed inset-0 bg-black/60 flex items-start justify-center z-50"
          style={{ paddingTop: 'calc(60px + 10vh)', paddingLeft: '14rem' }}
          onClick={() => setShowDeleteConfirm(false)}
        >
          <div
            className="bg-surface-raised border border-accent/20 rounded-xl p-8 max-w-2xl w-full mx-8 shadow-2xl relative"
            onClick={e => e.stopPropagation()}
          >
            <button onClick={() => setShowDeleteConfirm(false)} className="absolute top-4 right-4 text-ink-faint hover:text-ink text-lg leading-none">✕</button>
            <h2 className="text-base font-bold text-ink mb-3 pr-6">Delete "{chapter.title}"?</h2>
            <p className="text-sm text-ink-muted mb-6 leading-relaxed italic">
              Deleting this chapter is permanent and cannot be undone. All written content, blocks,
              and choices will be removed. Any story branches dependent on choices here will fall back
              to default text. Subsequent chapter numbers will be updated automatically.
            </p>
            <div className="flex gap-3 justify-end">
              <button onClick={() => setShowDeleteConfirm(false)} className="px-4 py-2 rounded-lg text-ink-muted text-sm hover:text-ink transition">Cancel</button>
              <button onClick={handleDeleteChapter} className="px-4 py-2 rounded-lg bg-choice-kill text-white text-sm font-semibold hover:opacity-90 transition">Delete</button>
            </div>
          </div>
        </div>
      )}

      {showPathConfig && (
        <PathConfigModal
          seriesId={seriesId}
          currentChapterId={chapterId}
          variables={series.variables}
          initialSelections={lensSelections}
          onApply={(state, selections) => { applyLens(state, selections); setShowPathConfig(false) }}
          onClose={() => setShowPathConfig(false)}
        />
      )}

    </div>

    {panelOpen && (
      <SidePanel
        tab={panelTab}
        onTabChange={openPanel}
        pins={pins}
        onClearPins={() => setPins([])}
        notes={notes}
        onNotesChange={setNotes}
        notesSaving={notesSaving}
        // The committed value, not povDraft: the draft carries an
        // autocomplete suffix mid-typing, so the badge would flicker onto
        // whichever character the suggestion currently spelled.
        chapterPov={chapter?.pov ?? null}
        events={{
          events: chapterEvents.events,
          tagged: chapterEvents.tagged,
          taggedIds: chapterEvents.taggedIds,
          count: chapterEvents.count,
          loading: chapterEvents.loading,
          unreachable: chapterEvents.unreachable,
          locations: chapterEvents.locations,
          // From the CHARACTERS hook, not the events one: an event's cast is
          // stored as `wc-` ids, and that hook is already the page's single
          // loader of the (write-on-read) character pool.
          characterPool: chapterCharacters.characterPool,
          characterPhotos: chapterCharacters.characterPhotos,
          onToggleTag: chapterEvents.setTagged,
          onSetNonCanon: chapterEvents.setNonCanon,
          onRetry: chapterEvents.refresh,
          onRefresh: chapterEvents.refresh,
        }}
        characters={{
          characters: chapterCharacters.characters,
          tagged: chapterCharacters.tagged,
          taggedIds: chapterCharacters.taggedIds,
          count: chapterCharacters.count,
          loading: chapterCharacters.loading,
          unreachable: chapterCharacters.unreachable,
          onToggleTag: chapterCharacters.setTagged,
          onSetNonCanon: chapterCharacters.setNonCanon,
          onSetCategory: chapterCharacters.setCategory,
          onRetry: chapterCharacters.refresh,
        }}
        insights={chapterInsights}
        comments={chapterComments}
        review={reviewData}
        reviewLoading={reviewLoading}
        reviewCtx={{
          seriesId,
          bookId: reviewBookId,
          chapterId,
          bookTitle: series?.books.find(b => b.id === reviewBookId)?.title,
          getCanonText: () => buildCanonTextRef.current(),
          onSession: s => setReviewData(d => ({ ...(d ?? {}), review: s })),
          onRefetch: refetchReview,
        }}
        width={panelWidth}
        onWidthChange={w => {
          setPanelWidth(w)
          try { localStorage.setItem('loom-panel-width', String(w)) } catch { /* ignore */ }
        }}
        onClose={closePanel}
      />
    )}
    </div>
  )
}
