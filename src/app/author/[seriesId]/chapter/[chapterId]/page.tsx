'use client'

import React, { useEffect, useState, useCallback, useRef, useMemo } from 'react'
import { useParams, useRouter, useSearchParams } from 'next/navigation'
import { LuPlay, LuPlus, LuMenu, LuScanText, LuSettings, LuCircleHelp, LuX, LuArrowLeft, LuArrowRight, LuArrowUp, LuChevronsDownUp, LuChevronsUpDown, LuSearch, LuReplace, LuCaseSensitive, LuWholeWord, LuRoute, LuCalendarDays, LuUsers } from 'react-icons/lu'
import { PiCopySimpleThin, PiNotebookThin } from 'react-icons/pi'
import BlockEditor from '@/components/editor/BlockEditor'
import SidePanel, { minWidthForTab, type PanelTab } from '@/components/editor/SidePanel'
import { useChapterReview } from '@/components/editor/ReviewPanel'
import { type PinnedText } from '@/components/editor/ReferencePanel'
import { useChapterNotes } from '@/components/editor/useChapterNotes'
import { useChapterEvents } from '@/components/editor/useChapterEvents'
import { useChapterCharacters } from '@/components/editor/useChapterCharacters'
import { useRegisterShortcuts, type ShortcutGroup } from '@/lib/shortcuts'
import ChapterSkeleton from '@/components/editor/ChapterSkeleton'
import { notify } from '@/lib/notifications'
import { registerProseFlush, subscribeProseReplaced } from '@/lib/proseSync'
import { ConditionRow } from '@/components/editor/conditionUI'
import { useAuthor } from '@/lib/authorContext'
import { ensureMinDuration } from '@/lib/minLoadDuration'
import { useCanonSave } from '@/components/editor/useCanonSave'
import { substituteVarTemplates } from '@/lib/templateVars'
import { matchesCondition, type StoryState, type Condition } from '@/lib/storyEngine'
import { resolveChapter, buildStoryState, varTypeMap } from '@/lib/chapterResolve'
import PathConfigModal from '@/components/editor/PathConfigModal'

type Block = {
  id: string; order: number; type: string
  content?: string | null; prompt?: string | null; displayType?: string | null; baseContent?: string | null; condition?: string | null
  choices: { id: string; order: number; label: string; setsVariables: string; targetChapterId: string | null; condition?: string | null; endingMessage?: string | null; isBadEnding?: boolean; endsChapter?: boolean }[]
  overrides: { id: string; order: number; condition: string; content: string; endingMessage?: string | null; endsChapter?: boolean }[]
}
type Chapter = { id: string; title: string; pov: string | null; date: string | null; condition: string | null; numbered: boolean; blocks: Block[] }
type Character = { id: string; name: string; age?: number | null; hasAvatar?: boolean }

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
      { keys: '⌥⇧F', label: 'Find in chapter' },
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
      { keys: '⌥⇧2', label: 'Toggle reviews' },
      { keys: '⌥⇧3', label: 'Toggle events' },
      { keys: '⌥⇧4', label: 'Toggle characters' },
      { keys: '⌥⇧5', label: 'Toggle chapter notes' },
      { keys: '⌥⇧6', label: 'Toggle pins' },
      { keys: '⌥⇧⏎', label: 'Save (in a dialog)' },
      { keys: '⌥⇧⎋', label: 'Cancel (in a dialog)' },
    ],
  },
]

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
  useRegisterShortcuts('chapter', CHAPTER_SHORTCUTS)

  function openPanel(tab: PanelTab) {
    setPanelTab(tab)
    setPanelOpen(true)
    // Review needs a third of the viewport to be readable, and the panel
    // remembers whatever width notes last used. Widen on the way in rather
    // than leaving the writer to drag it open every time (KAN-22). Never
    // narrows — a deliberately wide panel stays wide switching back.
    setPanelWidth(w => Math.max(w, minWidthForTab(tab, window.innerWidth)))
  }
  function closePanel() {
    setPanelOpen(false)
  }
  // One rule for every tab hotkey (⌥⇧2–6): closed → open on my tab; open on
  // another tab → switch to mine; open on my tab → close.
  function togglePanelTab(tab: PanelTab) {
    if (!panelOpenRef.current) { openPanel(tab); return }
    if (panelTabRef.current !== tab) { setPanelTab(tab); return }
    closePanel()
  }
  const togglePanelTabRef = useRef(togglePanelTab)
  togglePanelTabRef.current = togglePanelTab

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

  function handleNumberedChange(next: boolean) {
    setChapter(prev => prev ? { ...prev, numbered: next } : null)
    patchChapter({ numbered: next })
  }

  async function handleTitleBlur() {
    const trimmed = titleDraft.trim()
    if (!trimmed || trimmed === chapter?.title) return
    await patchChapter({ title: trimmed })
    setChapter(prev => prev ? { ...prev, title: trimmed } : null)
    loadSeries()
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
    fetch(`/api/series/${seriesId}/characters`).then(r => r.ok ? r.json() : []).then(setCharacters)
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

  // Keep stable refs so the hotkey listener never goes stale
  const addBlockRef = useRef<(type: string) => Promise<void>>(async () => {})
  const addChoiceBlockRef = useRef<() => Promise<void>>(async () => {})
  const createNextChapterRef = useRef<() => Promise<void>>(async () => {})
  const saveCanonRef = useRef<() => Promise<void>>(async () => {})
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
        case 'KeyF': e.preventDefault(); setTimeout(() => { localSearchInputRef.current?.focus(); localSearchInputRef.current?.select() }, 0); break
        case 'KeyJ': e.preventDefault(); scrollToCursorRef.current?.(); break
        case 'KeyK': e.preventDefault(); setLocalSearchQuery(''); setLocalSearchReplaceMode(false); break
        case 'KeyW': e.preventDefault(); clearLensRef.current(); break
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
        // The dock's five tabs, numbered in the order they appear in it. All
        // unconditional: 2 used to be Pins and did nothing unless something was
        // already pinned, which read as a broken key. Events took 3 (LOOM-36)
        // and Characters took 4 (LOOM-44), pushing Notes and Pins along each
        // time — the numbers follow the strip, so they move when it does.
        case 'Digit2': case 'Numpad2': e.preventDefault(); togglePanelTabRef.current('review'); break
        case 'Digit3': case 'Numpad3': e.preventDefault(); togglePanelTabRef.current('events'); break
        case 'Digit4': case 'Numpad4': e.preventDefault(); togglePanelTabRef.current('characters'); break
        case 'Digit5': case 'Numpad5': e.preventDefault(); togglePanelTabRef.current('notes'); break
        case 'Digit6': case 'Numpad6': e.preventDefault(); togglePanelTabRef.current('refs'); break
      }
    }
    document.addEventListener('keydown', handleKeyDown)
    return () => document.removeEventListener('keydown', handleKeyDown)
  }, [])

  // ⌥⇧E — render the canon manuscript and save it to the book's folder on
  // disk (Settings → Export configures where).
  const { saveCanon } = useCanonSave(seriesId)
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
    } catch { /* clipboard denied */ }
  }
  // Live ref so the panel always reads current blocks and lens without being
  // re-rendered on every keystroke.
  const buildCanonTextRef = useRef(buildCanonText)
  buildCanonTextRef.current = buildCanonText

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
    if (!book || !chapter) return
    const res = await fetch(`/api/series/${seriesId}/books/${book.id}/chapters`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ title: bumpChapterTitle(chapter.title) }),
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
    router.push(`/read/${session.id}?returnTo=/author/${seriesId}/chapter/${chapterId}&startChapterId=${chapterId}`)
  }

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

  return (
    // flex row: the writing column fills the layout's <main> scroll container;
    // an optional reference panel docks to its right. min-w-0 on the column
    // lets it shrink (rather than overflow) when the panel takes its width.
    <div className="flex min-h-full">
    <div className="flex-1 min-w-0 px-8 min-h-full flex flex-col">
      <div className="pb-3 flex-1">
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
        <div ref={headerRef} className="sticky top-0 z-[45] -mx-8 px-8 pt-3 pb-2 bg-surface-base">
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
              className="bg-surface-raised border border-accent/20 rounded-lg px-3 py-2 text-sm text-ink placeholder:text-ink-faint outline-none focus:border-accent w-60 shrink-0"
            />

            <div className="ml-auto flex items-center gap-4">
              {/* Chapter-local find bar — always visible, styled like the global series search */}
              <div className="relative flex items-center w-72">
                <LuSearch size={12} className="absolute left-2 text-ink-faint pointer-events-none" />
                <input
                  ref={localSearchInputRef}
                  value={localSearchQuery}
                  onChange={e => setLocalSearchQuery(e.target.value)}
                  onKeyDown={e => {
                    if (e.key === 'Escape') { setLocalSearchQuery(''); setLocalSearchReplaceMode(false); e.currentTarget.blur() }
                    if (e.key === 'Enter') jumpToFirstMatchRef.current?.(localSearchQuery)
                  }}
                  placeholder="Find in chapter… (⌥⇧F)"
                  title="Find in chapter (⌥⇧F)"
                  className="w-full pl-7 pr-[104px] py-1.5 text-xs bg-surface-base border border-accent/20 rounded-lg text-ink placeholder:text-ink-faint outline-none focus:border-accent/50"
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
                    className="flex items-center gap-1.5 text-xs text-ink-muted hover:text-ink transition shrink-0"
                  >
                    {anyCollapsed ? <LuChevronsUpDown size={12} /> : <LuChevronsDownUp size={12} />}
                    {anyCollapsed ? 'Expand All' : 'Collapse All'}
                  </button>
                )
              })()}

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
                    <span aria-hidden className="absolute -top-0.5 -right-0.5 h-1.5 w-1.5 rounded-full bg-accent" />
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
                      title="Read this chapter in the reader, then come back here."
                      className="flex w-full items-center gap-3 px-4 py-2.5 text-left text-sm text-ink-muted transition hover:bg-surface-overlay hover:text-ink"
                    >
                      <span className="flex w-5 items-center justify-center text-accent"><LuPlay size={14} /></span>
                      <span className="flex-1">Preview</span>
                    </button>
                    {/* Left open on click so the label's "Copied!" confirmation
                        is actually visible — every other item closes the menu. */}
                    <button
                      role="menuitem"
                      onClick={copyCanonText}
                      title={lensState
                        ? "Copies this chapter's story text for the active path — the same text Preview renders with that context."
                        : "Copies this chapter's canon story text to your clipboard — the rendered text as it would appear in the published book."}
                      className="flex w-full items-center gap-3 px-4 py-2.5 text-left text-sm text-ink-muted transition hover:bg-surface-overlay hover:text-ink"
                    >
                      <span className="flex w-5 items-center justify-center text-accent"><PiCopySimpleThin size={16} /></span>
                      <span className="flex-1">{copyDone ? 'Copied!' : 'Copy'}</span>
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
                        title="Configure a context path — the editor highlights the blocks and branches on that path and dims the rest. Copy and Preview follow the same path."
                        className={`flex flex-1 items-center gap-3 px-4 py-2.5 text-left text-sm transition hover:bg-surface-overlay hover:text-ink ${lensState ? 'text-accent' : 'text-ink-muted'}`}
                      >
                        <span className="flex w-5 items-center justify-center text-accent"><LuRoute size={14} /></span>
                        <span className="flex-1">{lensState ? `Path · ${lensAnsweredCount}` : 'Path'}</span>
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
                      title="Events referenced in this chapter (⌥⇧3)"
                      className="flex w-full items-center gap-3 px-4 py-2.5 text-left text-sm text-ink-muted transition hover:bg-surface-overlay hover:text-ink"
                    >
                      <span className="flex w-5 items-center justify-center text-accent"><LuCalendarDays size={14} /></span>
                      <span className="flex-1">Events</span>
                      {chapterEvents.count > 0 && (
                        <span aria-hidden className="h-1.5 w-1.5 rounded-full bg-accent" />
                      )}
                      <span className="text-[10px] tabular-nums text-ink-faint">⌥⇧3</span>
                    </button>
                    <button
                      role="menuitem"
                      onClick={() => { setActionMenuOpen(false); togglePanelTab('characters') }}
                      title="Characters appearing in this chapter (⌥⇧4)"
                      className="flex w-full items-center gap-3 px-4 py-2.5 text-left text-sm text-ink-muted transition hover:bg-surface-overlay hover:text-ink"
                    >
                      <span className="flex w-5 items-center justify-center text-accent"><LuUsers size={14} /></span>
                      <span className="flex-1">Characters</span>
                      {chapterCharacters.count > 0 && (
                        <span aria-hidden className="h-1.5 w-1.5 rounded-full bg-accent" />
                      )}
                      <span className="text-[10px] tabular-nums text-ink-faint">⌥⇧4</span>
                    </button>
                    {/* The dot means this chapter has notes you can't currently
                        see — it clears once the panel is showing them. */}
                    <button
                      role="menuitem"
                      onClick={() => { setActionMenuOpen(false); togglePanelTab('notes') }}
                      title="Chapter notes (⌥⇧5)"
                      className="flex w-full items-center gap-3 px-4 py-2.5 text-left text-sm text-ink-muted transition hover:bg-surface-overlay hover:text-ink"
                    >
                      <span className="flex w-5 items-center justify-center text-accent"><PiNotebookThin size={16} /></span>
                      <span className="flex-1">Notes</span>
                      {hasNotes && <span aria-hidden className="h-1.5 w-1.5 rounded-full bg-accent" />}
                      <span className="text-[10px] tabular-nums text-ink-faint">⌥⇧5</span>
                    </button>
                    <button
                      role="menuitem"
                      onClick={() => { setActionMenuOpen(false); setShowChapterSettings(true) }}
                      title="Chapter settings — numbering, visibility gate, delete"
                      className="flex w-full items-center gap-3 px-4 py-2.5 text-left text-sm text-ink-muted transition hover:bg-surface-overlay hover:text-ink"
                    >
                      <span className="flex w-5 items-center justify-center text-accent"><LuSettings size={14} /></span>
                      <span className="flex-1">Settings</span>
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
          characterPool: chapterEvents.characterPool,
          characterPhotos: chapterEvents.characterPhotos,
          loadCharacterPool: chapterEvents.loadCharacterPool,
          onToggleTag: chapterEvents.setTagged,
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
          onSetCategory: chapterCharacters.setCategory,
          onRetry: chapterCharacters.refresh,
        }}
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
        onWidthChange={setPanelWidth}
        onClose={closePanel}
      />
    )}
    </div>
  )
}
