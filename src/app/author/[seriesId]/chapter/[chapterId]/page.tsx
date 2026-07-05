'use client'

import React, { useEffect, useState, useCallback, useRef, useMemo } from 'react'
import { useParams, useRouter, useSearchParams } from 'next/navigation'
import { LuPlay, LuPencil, LuGitBranch, LuSplit, LuPlus, LuMusic, LuScanText, LuSettings, LuCircleHelp, LuX, LuArrowLeft, LuArrowRight, LuArrowUp, LuChevronsDownUp, LuChevronsUpDown, LuSearch, LuReplace } from 'react-icons/lu'
import { PiCopySimpleThin, PiNotebookThin } from 'react-icons/pi'
import BlockEditor from '@/components/editor/BlockEditor'
import { extractTextFromTipTap } from '@/lib/tiptapText'
import ChapterSkeleton from '@/components/editor/ChapterSkeleton'
import { ConditionRow } from '@/components/editor/conditionUI'
import { useAuthor } from '@/lib/authorContext'
import { ensureMinDuration } from '@/lib/minLoadDuration'
import { useCanonSave } from '@/components/editor/useCanonSave'
import { substituteVarTemplates } from '@/lib/templateVars'
import { useWriteAiReview } from '@/components/editor/useWriteAiReview'

type Block = {
  id: string; order: number; type: string
  content?: string | null; prompt?: string | null; displayType?: string | null; baseContent?: string | null
  choices: { id: string; label: string; setsVariables: string; targetChapterId: string | null }[]
  overrides: { id: string; order: number; condition: string; content: string }[]
}
type Chapter = { id: string; title: string; pov: string | null; date: string | null; condition: string | null; numbered: boolean; blocks: Block[] }
type Character = { id: string; name: string; age?: number | null; hasAvatar?: boolean }

export default function ChapterEditorPage() {
  const { seriesId, chapterId } = useParams() as { seriesId: string; chapterId: string }
  const router = useRouter()
  const { series, loadSeries, loadChoices } = useAuthor()
  const [chapter, setChapter] = useState<Chapter | null>(null)
  const [characters, setCharacters] = useState<Character[]>([])
  const [titleDraft, setTitleDraft] = useState('')
  const [addMenuOpen, setAddMenuOpen] = useState(false)
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false)
  const [showChapterSettings, setShowChapterSettings] = useState(false)
  const [copyDone, setCopyDone] = useState(false)
  const [showShortcuts, setShowShortcuts] = useState(false)
  const [showIfTooltip, setShowIfTooltip] = useState(false)
  const [activeBlockId, setActiveBlockId] = useState<string | null>(null)
  // Lifted from BlockEditor so the date-row toggle can flip every block at
  // once. Resets to empty on chapter switch (chapterId is in the dep list
  // below), matching the "all uncollapsed on initial load" rule.
  const [collapsedIds, setCollapsedIds] = useState<Set<string>>(new Set())
  useEffect(() => { setCollapsedIds(new Set()) }, [chapterId])
  const [localSearchQuery, setLocalSearchQuery] = useState('')
  const [localSearchReplace, setLocalSearchReplace] = useState('')
  const [localSearchReplaceMode, setLocalSearchReplaceMode] = useState(false)
  const localSearchInputRef = useRef<HTMLInputElement>(null)
  const replaceAllRef = useRef<((search: string, replacement: string) => number) | null>(null)
  const jumpToFirstMatchRef = useRef<((query: string) => void) | null>(null)
  const scrollToCursorRef = useRef<(() => void) | null>(null)
  const currentBlocksRef = useRef<{ id: string; type: string; content?: string | null; baseContent?: string | null }[] | null>(null)
  const addMenuRef = useRef<HTMLDivElement>(null)
  const shortcutsRef = useRef<HTMLDivElement>(null)
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
      if (addMenuRef.current && !addMenuRef.current.contains(e.target as Node)) {
        setAddMenuOpen(false)
      }
      if (shortcutsRef.current && !shortcutsRef.current.contains(e.target as Node)) {
        setShowShortcuts(false)
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
  const loadChapter = useCallback(async () => {
    const start = Date.now()
    const res = await fetch(`/api/chapters/${chapterId}`)
    if (!res.ok) return
    const data = await res.json()
    if (isInitialChapterLoadRef.current) {
      await ensureMinDuration(start)
      isInitialChapterLoadRef.current = false
    }
    setChapter(data)
    setTitleDraft(data.title)
    // Reset POV draft + autocomplete bookkeeping every time we land on a
    // new chapter so the previous chapter's typed/rejected state doesn't
    // bleed across navigation.
    setPovDraft(data.pov ?? '')
    typedPrefixRef.current = data.pov ?? ''
    rejectedPrefixRef.current = null
    povSyncedChapterRef.current = data.id
  }, [chapterId])

  const reloadBlocks = useCallback(async () => {
    const res = await fetch(`/api/chapters/${chapterId}/blocks`)
    if (res.ok) {
      const blocks = await res.json()
      setChapter(prev => prev ? { ...prev, blocks } : null)
    }
  }, [chapterId])

  useEffect(() => { loadChapter() }, [loadChapter])

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

  // Keep stable refs so the hotkey listener never goes stale
  const addBlockRef = useRef<(type: string) => Promise<void>>(async () => {})
  const addChoiceBlockRef = useRef<() => Promise<void>>(async () => {})
  const createNextChapterRef = useRef<() => Promise<void>>(async () => {})
  const saveCanonRef = useRef<() => Promise<void>>(async () => {})

  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      if (!e.altKey || !e.shiftKey) return
      switch (e.code) {
        case 'KeyT': e.preventDefault(); addBlockRef.current('text'); break
        case 'KeyQ': e.preventDefault(); addChoiceBlockRef.current(); break
        case 'KeyC': e.preventDefault(); addBlockRef.current('conditional_fragment'); break
        case 'KeyS': e.preventDefault(); addBlockRef.current('soundtrack'); break
        case 'KeyN': e.preventDefault(); createNextChapterRef.current(); break
        case 'KeyE': e.preventDefault(); saveCanonRef.current(); break
        case 'KeyF': e.preventDefault(); setTimeout(() => { localSearchInputRef.current?.focus(); localSearchInputRef.current?.select() }, 0); break
        case 'KeyJ': e.preventDefault(); scrollToCursorRef.current?.(); break
      }
    }
    document.addEventListener('keydown', handleKeyDown)
    return () => document.removeEventListener('keydown', handleKeyDown)
  }, [])

  // ⌥⇧E — render the canon manuscript and save it to the book's folder on
  // disk (Settings → Export configures where).
  const { saveCanon } = useCanonSave(seriesId)
  const { reviewInWriteAi, reviewing } = useWriteAiReview(seriesId)
  saveCanonRef.current = async () => {
    await saveCanon(series.books.find(b => b.chapters.some(c => c.id === chapterId))?.id)
  }

  const localSearchMatchCount = useMemo(() => {
    if (!localSearchQuery.trim() || !chapter) return 0
    const esc = localSearchQuery.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
    const regex = new RegExp(esc, 'gi')
    return chapter.blocks.reduce((n, b) => {
      const text = extractTextFromTipTap(b.content ?? null)
      return n + (text.match(regex)?.length ?? 0)
    }, 0)
  }, [localSearchQuery, chapter])

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

  async function copyCanonText() {
    if (!chapter) return
    const storyState: Record<string, unknown> = {}
    for (const v of series.variables) {
      if (v.type === 'boolean') storyState[v.name] = String(v.defaultValue).toLowerCase() === 'true'
      else if (v.type === 'number') storyState[v.name] = Number(v.defaultValue ?? 0)
      else storyState[v.name] = v.defaultValue ?? ''
    }
    const parts: string[] = []
    for (const block of (currentBlocksRef.current ?? chapter.blocks)) {
      const src = block.type === 'text' ? block.content
        : block.type === 'conditional_fragment' ? block.baseContent
        : null
      if (!src) continue
      const text = substituteVarTemplates(extractPlainText(src), storyState, s => s)
      if (text) parts.push(text)
    }
    try {
      await navigator.clipboard.writeText(parts.join('\n\n'))
      setCopyDone(true)
      setTimeout(() => setCopyDone(false), 2000)
    } catch { /* clipboard denied */ }
  }

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

  function scrollToTop() {
    // The author layout's <main> is the scroll container; scrollTo it
    // directly so the chapter page glides back to the top.
    document.querySelector('main')?.scrollTo({ top: 0, behavior: 'smooth' })
  }

  async function addChoiceBlock() {
    await addBlock('choice_point')
  }

  async function addBlock(type: string) {
    setAddMenuOpen(false)
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
    // create path (FAB, hotkey, sidebar "+") rather than only addChoiceBlock.
    if (type === 'choice_point') loadChoices()
  }

  // Always point at the latest versions of these functions
  addBlockRef.current = addBlock
  addChoiceBlockRef.current = addChoiceBlock

  if (!chapter) return <ChapterSkeleton />

  // Prev/next within the same book — chapters are already ordered by `order`
  // by the layout's series fetch, so a simple findIndex walk is enough.
  const currentBook = series.books.find(b => b.chapters.some(c => c.id === chapterId))
  const bookChapters = currentBook?.chapters ?? []
  const currentIdx = bookChapters.findIndex(c => c.id === chapterId)
  const prevChapter = currentIdx > 0 ? bookChapters[currentIdx - 1] : null
  const nextChapter = currentIdx >= 0 && currentIdx < bookChapters.length - 1 ? bookChapters[currentIdx + 1] : null

  return (
    // flex column that fills the layout's <main> scroll container so the
    // sticky footer always lands at the viewport bottom — even when the
    // chapter content is shorter than the viewport (e.g. a freshly-created
    // chapter). pb-8 / mt-auto pair pushes the footer to the bottom edge.
    <div className="px-8 min-h-full flex flex-col">
      {/* Sticky action row — pr-6 matches the invisible hover-delete column
          on block rows so the rightmost button aligns with the block card edge. */}
      <div className="flex justify-end items-center gap-2 py-3 pr-6">
        <button
          onClick={() => setShowChapterSettings(true)}
          title="Chapter settings"
          className="text-ink-faint hover:text-ink transition flex items-center"
        >
          <LuSettings size={20} />
        </button>
        <div ref={shortcutsRef} className="relative">
          <button
            onClick={() => setShowShortcuts(o => !o)}
            title="Keyboard shortcuts"
            className="text-ink-faint hover:text-ink transition flex items-center"
          >
            <PiNotebookThin size={20} />
          </button>
          {showShortcuts && (
            <div className="absolute right-0 top-full mt-2 z-50 w-72 bg-surface-raised border border-accent/20 rounded-xl shadow-xl p-4">
              <p className="text-[10px] uppercase tracking-widest text-ink-faint font-semibold mb-3">Keyboard Shortcuts</p>
              {([
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
                    { keys: '⌥⇧D', label: 'Delete active block' },
                  ],
                },
                {
                  group: 'While Writing',
                  items: [
                    { keys: '⌥⇧J', label: 'Jump to cursor' },
                    { keys: '⌥⇧R', label: 'Read aloud from cursor' },
                    { keys: '⌥⇧B', label: 'Insert scene break' },
                  ],
                },
                {
                  group: 'Series',
                  items: [
                    { keys: '⌥⇧G', label: 'Find in series (global)' },
                    { keys: '⌥⇧1', label: 'Toggle sidebar' },
                  ],
                },
              ] as { group: string; items: { keys: string; label: string }[] }[]).map(({ group, items }) => (
                <div key={group} className="mb-3 last:mb-0">
                  <p className="text-[9px] uppercase tracking-widest text-ink-faint mb-1.5">{group}</p>
                  <div className="flex flex-col gap-1">
                    {items.map(({ keys, label }) => (
                      <div key={keys} className="flex items-center justify-between gap-3">
                        <span className="text-xs text-ink-muted">{label}</span>
                        <span className="font-mono text-[10px] bg-surface-overlay border border-accent/20 rounded px-1.5 py-0.5 text-ink-muted tracking-wider shrink-0">{keys}</span>
                      </div>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
        <div className="relative group/copybtn">
          <button
            onClick={copyCanonText}
            className="px-3 py-1.5 rounded text-xs border border-accent/20 text-ink-muted font-medium hover:border-accent/40 hover:text-ink transition"
          >
            <span className="flex items-center gap-1.5">
              <PiCopySimpleThin size={14} />{copyDone ? 'Copied!' : 'Copy'}
            </span>
          </button>
          <div className="pointer-events-none absolute right-0 top-full mt-1.5 z-50 w-56 rounded border border-accent/20 bg-surface-overlay px-3 py-2 text-xs leading-snug text-ink-muted shadow-lg opacity-0 transition-opacity group-hover/copybtn:opacity-100">
            Copies this chapter's canon story text to your clipboard — the rendered text as it would appear in the published book.
          </div>
        </div>
        <div className="relative group/reviewbtn">
          <button
            onClick={() => reviewInWriteAi(currentBook, chapterId)}
            disabled={reviewing}
            className="px-3 py-1.5 rounded text-xs border border-accent/40 text-accent font-medium hover:bg-accent/10 transition disabled:opacity-60"
          >
            <span className="flex items-center gap-1.5"><LuScanText size={12} /> {reviewing ? 'Syncing…' : 'Review'}</span>
          </button>
          <div className="pointer-events-none absolute right-0 top-full mt-1.5 z-50 w-64 rounded border border-accent/20 bg-surface-overlay px-3 py-2 text-xs leading-snug text-ink-muted shadow-lg opacity-0 transition-opacity group-hover/reviewbtn:opacity-100">
            Exports this book's canon manuscript, then opens WriteAI to review this chapter. The AI reads the rendered story text — choices and conditions resolved — grounded in the full series canon.
          </div>
        </div>
        <button
          onClick={async () => {
            const res = await fetch('/api/sessions', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ seriesId }) })
            const session = await res.json()
            router.push(`/read/${session.id}?returnTo=/author/${seriesId}/chapter/${chapterId}&startChapterId=${chapterId}`)
          }}
          className="px-3 py-1.5 rounded text-xs bg-accent text-white font-medium hover:opacity-90 transition"
        >
          <span className="flex items-center gap-1.5"><LuPlay size={12} /> Preview</span>
        </button>
      </div>

      {/* Floating add-block button — bottom-right of viewport, lifted above
          the chapter-nav footer (which sits sticky at the bottom). */}
      <div ref={addMenuRef} className="fixed bottom-16 right-3 z-50">
        {addMenuOpen && (
          <div className="absolute right-0 bottom-full mb-2 bg-surface-raised border border-accent/20 rounded-lg shadow-xl overflow-hidden min-w-[180px]">
            {([
              { type: 'text',                icon: <LuPencil size={14} />,    label: 'Add Text' },
              { type: 'choice_point',         icon: <LuGitBranch size={14} />, label: 'Ask A Question' },
              { type: 'conditional_fragment', icon: <LuSplit size={14} />,     label: 'Add Conditional' },
              { type: 'soundtrack',           icon: <LuMusic size={14} />,     label: 'Add Soundtrack' },
            ] as { type: string; icon: React.ReactNode; label: string }[]).map(({ type, icon, label }) => (
              <button
                key={type}
                onClick={() => addBlock(type)}
                className="flex items-center gap-3 w-full px-4 py-2.5 text-sm text-ink-muted hover:text-ink hover:bg-surface-overlay transition text-left"
              >
                <span className="text-accent w-5 flex items-center justify-center">{icon}</span>
                {label}
              </button>
            ))}
          </div>
        )}
        <button
          onClick={() => setAddMenuOpen(o => !o)}
          className="bg-surface-raised border border-accent/20 hover:border-accent/40 text-ink-muted hover:text-ink transition w-9 h-9 flex items-center justify-center rounded-full shadow-lg"
        >
          <LuPlus size={14} strokeWidth={2.5} />
        </button>
      </div>
      <div className="pb-8 flex-1">
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
        <div className="flex items-center gap-4 mb-2 pr-[23px]">
          <input
            value={chapter.date ?? ''}
            onChange={e => handleMetaChange('date', e.target.value)}
            onFocus={e => e.target.setSelectionRange(0, 0)}
            className="bg-surface-raised border border-accent/20 rounded-lg px-3 py-2 text-sm text-ink placeholder:text-ink-faint outline-none focus:border-accent w-60 shrink-0"
          />

          <div className="ml-auto flex items-center gap-4">
            {/* Chapter-local find bar — always visible, styled like the global series search */}
            <div className="relative flex items-center w-62">
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
                className="w-full pl-7 pr-14 py-1.5 text-xs bg-surface-base border border-accent/20 rounded-lg text-ink placeholder:text-ink-faint outline-none focus:border-accent/50"
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
                  onClick={() => setLocalSearchReplaceMode(m => !m)}
                  title={localSearchReplaceMode ? 'Hide replace' : 'Find and replace'}
                  className={`p-0.5 transition ${localSearchReplaceMode ? 'text-accent' : 'text-ink-faint hover:text-ink'}`}
                >
                  <LuReplace size={11} />
                </button>
              </div>
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
          </div>
        </div>

        {localSearchReplaceMode && (
          <div className="flex items-center gap-2 mb-2 pr-[23px]">
            <input
              value={localSearchReplace}
              onChange={e => setLocalSearchReplace(e.target.value)}
              placeholder="Replace with…"
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

        <BlockEditor
          chapterId={chapterId}
          blocks={chapter.blocks}
          variables={series.variables}
          characters={characters}
          onBlocksChange={reloadBlocks}
          onChoicesChanged={loadChoices}
          onCreateVariable={createVariable}
          onActiveBlockChange={setActiveBlockId}
          collapsedIds={collapsedIds}
          onCollapsedIdsChange={setCollapsedIds}
          searchQuery={localSearchQuery || (searchParams?.get('q') ?? '')}
          replaceAllRef={replaceAllRef}
          jumpToFirstMatchRef={jumpToFirstMatchRef}
          scrollToCursorRef={scrollToCursorRef}
          currentBlocksRef={currentBlocksRef}
          onTextBlockBlur={handleTextBlockBlur}
        />
      </div>

      {/* Bottom chapter nav. Mirrors the reader's prev/next footer so the
          writer has a fast hop between chapters at the end of a session.
          - sticky bottom-0 pins it to the bottom of <main>'s scroll area
            (the layout's only scroll container).
          - -mx-8 px-8 stretches the top border edge-to-edge while keeping
            the button column lined up with the rest of the page.
          - The inline style overrides surface/ink CSS variables back to
            the dark theme so the footer stays dark in light mode too —
            matches the reader, which gets that for free by living
            outside the light-body wrapper. */}
      <footer
        ref={footerRef}
        style={{
          '--color-surface-raised': '#12121e',
          '--color-ink': '#e0d9c8',
          '--color-ink-muted': '#aaa',
          '--color-ink-faint': '#666',
        } as React.CSSProperties}
        className="sticky bottom-0 z-20 -mx-8 px-4 py-4 bg-surface-raised border-t border-accent/10 flex items-center justify-between gap-4"
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

    </div>
  )
}
