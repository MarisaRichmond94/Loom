'use client'

import React, { useEffect, useState, useCallback, useRef } from 'react'
import { useParams, useRouter } from 'next/navigation'
import { LuPlay, LuPencil, LuGitBranch, LuSplit, LuPlus, LuMusic, LuSettings, LuCircleHelp, LuX } from 'react-icons/lu'
import BlockEditor from '@/components/editor/BlockEditor'
import { ConditionRow } from '@/components/editor/conditionUI'
import { useAuthor } from '@/lib/authorContext'
import { ensureMinDuration } from '@/lib/minLoadDuration'

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
  const { series, loadSeries, loadChoices, registerAddChoice } = useAuthor()
  const [chapter, setChapter] = useState<Chapter | null>(null)
  const [characters, setCharacters] = useState<Character[]>([])
  const [titleDraft, setTitleDraft] = useState('')
  const [addMenuOpen, setAddMenuOpen] = useState(false)
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false)
  const [showChapterSettings, setShowChapterSettings] = useState(false)
  const [showIfTooltip, setShowIfTooltip] = useState(false)
  const [activeBlockId, setActiveBlockId] = useState<string | null>(null)
  const addMenuRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    function handleClick(e: MouseEvent) {
      if (addMenuRef.current && !addMenuRef.current.contains(e.target as Node)) {
        setAddMenuOpen(false)
      }
    }
    document.addEventListener('mousedown', handleClick)
    return () => document.removeEventListener('mousedown', handleClick)
  }, [])

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
  }, [chapterId])

  const reloadBlocks = useCallback(async () => {
    const res = await fetch(`/api/chapters/${chapterId}/blocks`)
    if (res.ok) {
      const blocks = await res.json()
      setChapter(prev => prev ? { ...prev, blocks } : null)
    }
  }, [chapterId])

  useEffect(() => { loadChapter() }, [loadChapter])
  useEffect(() => {
    fetch(`/api/series/${seriesId}/characters`).then(r => r.ok ? r.json() : []).then(setCharacters)
  }, [seriesId])

  // Keep stable refs so the hotkey listener never goes stale
  const addBlockRef = useRef<(type: string) => Promise<void>>(async () => {})
  const addChoiceBlockRef = useRef<() => Promise<void>>(async () => {})

  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      if (!e.altKey || !e.shiftKey) return
      switch (e.code) {
        case 'KeyT': e.preventDefault(); addBlockRef.current('text'); break
        case 'KeyQ': e.preventDefault(); addChoiceBlockRef.current(); break
        case 'KeyC': e.preventDefault(); addBlockRef.current('conditional_fragment'); break
        case 'KeyS': e.preventDefault(); addBlockRef.current('soundtrack'); break
      }
    }
    document.addEventListener('keydown', handleKeyDown)
    return () => document.removeEventListener('keydown', handleKeyDown)
  }, [])

  async function createVariable(name: string, type: string) {
    const defaultValue: unknown = type === 'boolean' ? false : type === 'number' ? 0 : ''
    await fetch(`/api/series/${seriesId}/variables`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name, type, defaultValue }),
    })
    loadSeries()
  }

  async function handleDeleteChapter() {
    const book = series.books.find(b => b.chapters.some(c => c.id === chapterId))
    if (!book) return
    await fetch(`/api/series/${seriesId}/books/${book.id}/chapters/${chapterId}`, { method: 'DELETE' })
    await loadSeries()
    router.push(`/author/${seriesId}/book/${book.id}`)
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

  // Bridge addChoiceBlock to the sidebar ChoicesPanel via context
  useEffect(() => {
    registerAddChoice(() => addChoiceBlockRef.current())
    return () => registerAddChoice(null)
  }, [registerAddChoice])

  if (!chapter) return (
    <div className="px-8 animate-pulse">
      {/* Mirrors the real action row so the layout doesn't jump on load. */}
      <div className="sticky top-0 z-10 flex justify-end items-center gap-2 py-3 pr-6">
        <div className="w-5 h-5 rounded bg-surface-muted" />
        <div className="h-7 w-16 rounded bg-surface-muted" />
        <div className="h-7 w-20 rounded bg-accent/30" />
      </div>
      <div className="pb-8">
        {/* Title + POV — centered */}
        <div className="flex flex-col items-center mb-8">
          <div className="h-9 w-72 bg-surface-muted rounded mb-3" />
          <div className="h-7 w-48 bg-surface-raised border border-accent/20 rounded-lg" />
        </div>
        {/* Date */}
        <div className="h-9 w-44 bg-surface-raised border border-accent/20 rounded-lg mb-2" />
        {/* Block placeholders — varied widths to feel less mechanical. */}
        <div className="flex flex-col gap-3">
          {[
            ['w-11/12', 'w-full', 'w-10/12', 'w-9/12'],
            ['w-full', 'w-5/6', 'w-11/12', 'w-2/3'],
            ['w-10/12', 'w-full', 'w-3/4'],
          ].map((widths, i) => (
            <div key={i} className="flex items-start">
              <div className="flex-1 min-w-0 bg-surface-raised border border-accent/10 border-l-4 border-l-accent/30 rounded-r-lg p-4">
                <div className="pl-4 space-y-2">
                  {widths.map((w, j) => (
                    <div key={j} className={`h-3 ${w} bg-surface-muted rounded`} />
                  ))}
                </div>
              </div>
              {/* Reserves the same 24px column the real block row keeps for the
                  hover-delete X so the card right edge aligns with the action row. */}
              <div className="shrink-0" style={{ width: '24px' }} />
            </div>
          ))}
        </div>
      </div>
    </div>
  )

  return (
    <div className="px-8">
      {/* Sticky action row — pr-6 matches the invisible hover-delete column
          on block rows so the rightmost button aligns with the block card edge. */}
      <div className="sticky top-0 z-10 flex justify-end items-center gap-2 py-3 pr-6">
        <button
          onClick={() => setShowChapterSettings(true)}
          title="Chapter settings"
          className="text-ink-faint hover:text-ink transition flex items-center"
        >
          <LuSettings size={20} />
        </button>
        <button
          onClick={() => setShowDeleteConfirm(true)}
          className="px-3 py-1.5 rounded text-xs border border-choice-kill/40 text-choice-kill font-medium hover:bg-choice-kill/10 transition"
        >
          Delete
        </button>
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

      {/* Floating add-block button — bottom-right of viewport, always on top */}
      <div ref={addMenuRef} className="fixed bottom-6 right-3 z-50">
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
      <div className="pb-8">
        {/* Title + POV — centered */}
        <div className="flex flex-col items-center mb-8">
          <input
            value={titleDraft}
            onChange={e => setTitleDraft(e.target.value)}
            onBlur={handleTitleBlur}
            className="w-full bg-transparent border-none outline-none text-center text-3xl font-bold uppercase text-ink tracking-wide focus:opacity-80 transition-opacity"
          />
          <input
            value={chapter.pov ?? ''}
            onChange={e => handleMetaChange('pov', e.target.value)}
            onFocus={e => e.target.setSelectionRange(0, 0)}
            className="mt-1 bg-surface-raised border border-accent/20 rounded-lg px-3 py-1 text-sm text-ink placeholder:text-ink-faint outline-none focus:border-accent text-center w-48"
          />
        </div>

        {/* Date — left-justified, 8px above first block */}
        <input
          value={chapter.date ?? ''}
          onChange={e => handleMetaChange('date', e.target.value)}
          onFocus={e => e.target.setSelectionRange(0, 0)}
          className="bg-surface-raised border border-accent/20 rounded-lg px-3 py-2 text-sm text-ink placeholder:text-ink-faint outline-none focus:border-accent w-44 mb-2"
        />

        <BlockEditor
          chapterId={chapterId}
          blocks={chapter.blocks}
          variables={series.variables}
          characters={characters}
          onBlocksChange={reloadBlocks}
          onChoicesChanged={loadChoices}
          onCreateVariable={createVariable}
          onActiveBlockChange={setActiveBlockId}
        />
      </div>

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
                labelExtra={
                  <span
                    className="relative inline-flex"
                    onMouseEnter={() => setShowIfTooltip(true)}
                    onMouseLeave={() => setShowIfTooltip(false)}
                  >
                    <LuCircleHelp size={12} className="text-ink-faint hover:text-ink transition cursor-help" />
                    {showIfTooltip && (
                      <span className="absolute left-full top-1/2 -translate-y-1/2 ml-2 z-50 w-60 bg-surface-overlay border border-accent/20 rounded px-3 py-2 text-xs text-ink-muted shadow-lg normal-case tracking-normal font-normal leading-snug">
                        Pick variables and the values they must have for this chapter to render to the reader. All listed variables must match. Leave empty to always show.
                      </span>
                    )}
                  </span>
                }
              />
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
