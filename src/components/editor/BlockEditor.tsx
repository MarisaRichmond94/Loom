'use client'

import { useState, useEffect, useRef } from 'react'
import type { Editor } from '@tiptap/core'
import { useSearchParams } from 'next/navigation'
import { DndContext, closestCenter, PointerSensor, useSensor, useSensors, DragOverlay } from '@dnd-kit/core'
import type { DragEndEvent, DragStartEvent } from '@dnd-kit/core'
import { SortableContext, useSortable, verticalListSortingStrategy, arrayMove } from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import { LuGripVertical, LuX, LuChevronDown, LuChevronRight } from 'react-icons/lu'
import TextBlock from './TextBlock'
import ChoicePointBlock from './ChoicePointBlock'
import ConditionalBlock from './ConditionalBlock'
import SoundtrackBlock from './SoundtrackBlock'
import { extractTextFromTipTap } from '@/lib/tiptapText'
import ConfirmDialog from '@/components/ConfirmDialog'

type Override = { id: string; order: number; condition: string; content: string; endingMessage?: string | null }
type Choice = { id: string; label: string; setsVariables: string; targetChapterId: string | null; endingMessage?: string | null }
type Block = {
  id: string
  order: number
  type: string
  content?: string | null
  prompt?: string | null
  displayType?: string | null
  baseContent?: string | null
  condition?: string | null
  pinStart?: number | null
  pinEnd?: number | null
  hasAlbumArt?: boolean
  choices: Choice[]
  overrides: Override[]
}
type Variable = { id: string; name: string; type: string; defaultValue?: string }
type Character = { id: string; name: string; age?: number | null; hasAvatar?: boolean }

type Props = {
  chapterId: string
  blocks: Block[]
  variables: Variable[]
  characters: Character[]
  onBlocksChange: () => void
  onChoicesChanged?: () => void
  onCreateVariable: (name: string, type: string, defaultValue?: unknown) => Promise<void>
  onActiveBlockChange?: (blockId: string | null) => void
  // Controlled collapsed-block state. Lifted to the chapter page so the
  // page-level "expand all / collapse all" toggle and the per-block
  // chevron operate on the same source of truth.
  collapsedIds: Set<string>
  onCollapsedIdsChange: (next: Set<string>) => void
  // Series-search query from the URL — forwarded into every TipTap
  // surface (prose, conditional override prose, choice branch text) so
  // matches highlight after a search-result navigation.
  searchQuery?: string
  // Ref that receives a replaceAll function once editors mount. The chapter
  // page uses this to drive replace-all from the local chapter search bar.
  replaceAllRef?: React.MutableRefObject<((search: string, replacement: string) => number) | null>
}

const BLOCK_BORDER: Record<string, string> = {
  text: 'border-l-accent/30',
  choice_point: 'border-l-[#cc8888]',
  conditional_fragment: 'border-l-accent',
  soundtrack: 'border-l-accent/60',
}

const BLOCK_TYPE_LABEL: Record<string, string> = {
  text: 'Text',
  choice_point: 'Choose',
  conditional_fragment: 'Conditional',
  soundtrack: 'Music',
}

// One-line preview of a block's content for the collapsed view — picks
// whichever field carries the most distinctive text per block type. Keeps
// the writer oriented without expanding the block. The CSS truncate on
// the rendering span handles overflow, so we return the full first line
// rather than slicing to a fixed character cap (the cap would chop the
// text before the container ever needed to ellipsize).
function collapsedSummary(block: Block): string {
  function firstLine(s: string): string {
    return s.split('\n')[0]?.trim() ?? ''
  }
  if (block.type === 'text') return firstLine(extractTextFromTipTap(block.content ?? null))
  if (block.type === 'choice_point') return block.prompt?.trim() || ''
  if (block.type === 'conditional_fragment') {
    // Conditional blocks usually have an empty baseContent — fall back to
    // the first override's content so the writer can still tell collapsed
    // conditionals apart by their first branch text.
    const base = firstLine(extractTextFromTipTap(block.baseContent ?? null))
    if (base) return base
    const firstOverride = [...block.overrides].sort((a, b) => a.order - b.order)[0]
    return firstOverride ? firstLine(extractTextFromTipTap(firstOverride.content)) : ''
  }
  if (block.type === 'soundtrack') return block.content?.trim() || ''
  return ''
}

function SortableBlock({
  block,
  children,
  onDelete,
  isActive,
  onActivate,
  isCollapsed,
  onToggleCollapse,
}: {
  block: Block
  children: React.ReactNode
  onDelete: () => void
  isActive: boolean
  onActivate: () => void
  isCollapsed: boolean
  onToggleCollapse: () => void
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: block.id })

  const summary = isCollapsed ? collapsedSummary(block) : ''

  // Double-click anywhere outside an editable region toggles the block's
  // collapsed state. The closest-ancestor check covers TipTap's
  // contenteditable surface AND every input/select/textarea inside the
  // block (variable pickers, condition setters, choice labels, etc.) so
  // a normal double-click-to-select-word in those still works.
  function handleDoubleClick(e: React.MouseEvent<HTMLDivElement>) {
    const target = e.target as HTMLElement
    if (target.closest('[contenteditable="true"], input, textarea, select, button')) return
    e.preventDefault()
    onToggleCollapse()
  }

  return (
    <div
      ref={setNodeRef}
      data-block-id={block.id}
      style={{ transform: CSS.Transform.toString(transform), transition, opacity: isDragging ? 0.3 : 1 }}
      className="flex items-start group"
      onClick={onActivate}
      onDoubleClick={handleDoubleClick}
    >
      <div className={`flex-1 min-w-0 bg-surface-raised border border-accent/10 border-l-4 ${BLOCK_BORDER[block.type] ?? ''} rounded-r-lg p-4 relative transition-shadow duration-150 ${isActive ? 'ring-1 ring-inset ring-accent/40' : 'group-hover:ring-1 group-hover:ring-inset group-hover:ring-accent/20'}`}>
        <button
          {...attributes}
          {...listeners}
          className="absolute top-2 left-2 text-ink-faint opacity-0 group-hover:opacity-100 cursor-grab active:cursor-grabbing transition"
          title="Drag to reorder"
        >
          <LuGripVertical size={16} />
        </button>
        <div className="pl-4">
          {isCollapsed ? (
            <div className="flex items-baseline gap-3 min-w-0">
              <span className="shrink-0 text-xs font-bold text-ink uppercase tracking-widest">
                {BLOCK_TYPE_LABEL[block.type] ?? block.type}
              </span>
              {summary && (
                <span className="flex-1 min-w-0 truncate text-xs text-ink-faint italic">{summary}</span>
              )}
            </div>
          ) : (
            children
          )}
        </div>
      </div>
      <div className="shrink-0 flex flex-col gap-1.5 mt-2 ml-2">
        <button
          onClick={e => { e.stopPropagation(); onDelete() }}
          className="text-ink-faint opacity-0 group-hover:opacity-100 hover:text-choice-kill transition-all duration-200"
          title="Delete block"
        >
          <LuX size={15} />
        </button>
        <button
          onClick={e => { e.stopPropagation(); onToggleCollapse() }}
          className="text-ink-faint opacity-0 group-hover:opacity-100 hover:text-ink transition-all duration-200"
          title={isCollapsed ? 'Expand block' : 'Collapse block'}
        >
          {isCollapsed ? <LuChevronRight size={15} /> : <LuChevronDown size={15} />}
        </button>
      </div>
    </div>
  )
}

function escapeRegExp(s: string) { return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') }

export default function BlockEditor({ chapterId, blocks: initialBlocks, variables, characters, onBlocksChange, onChoicesChanged, onCreateVariable, onActiveBlockChange, collapsedIds, onCollapsedIdsChange, searchQuery = '', replaceAllRef }: Props) {
  const [blocks, setBlocks] = useState<Block[]>(initialBlocks)
  const [activeBlockId, setActiveBlockId] = useState<string | null>(null)
  const [newBlockId, setNewBlockId] = useState<string | null>(null)
  const [draggingBlock, setDraggingBlock] = useState<Block | null>(null)
  // Per-block collapsed state is controlled by the parent so the chapter
  // page's expand-all / collapse-all toggle and the per-block chevron
  // operate on the same source of truth.
  function toggleCollapsed(id: string) {
    const next = new Set(collapsedIds)
    if (next.has(id)) next.delete(id)
    else next.add(id)
    onCollapsedIdsChange(next)
  }
  // Pending block-delete confirmation. Storing the whole block (not just
  // the id) keeps the modal's summary text stable even if the underlying
  // list reshuffles during the confirm round-trip.
  const [pendingDelete, setPendingDelete] = useState<Block | null>(null)
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 5 } }))
  const blocksContainerRef = useRef<HTMLDivElement>(null)
  // Written every render so the ⌥⇧D handler never reads a stale value
  const activeBlockIdRef = useRef<string | null>(null)
  const onBlocksChangeRef = useRef(onBlocksChange)
  activeBlockIdRef.current = activeBlockId
  onBlocksChangeRef.current = onBlocksChange

  const textEditorsRef = useRef<Map<string, Editor>>(new Map())
  if (replaceAllRef) {
    replaceAllRef.current = (search: string, replacement: string) => {
      if (!search) return 0
      const regex = new RegExp(escapeRegExp(search), 'gi')
      let total = 0
      textEditorsRef.current.forEach(editor => {
        const { state } = editor
        const { doc, schema } = state
        const matches: Array<{ from: number; to: number }> = []
        doc.descendants((node, pos) => {
          if (!node.isText || !node.text) return
          regex.lastIndex = 0
          let m
          while ((m = regex.exec(node.text)) !== null) {
            matches.push({ from: pos + m.index, to: pos + m.index + m[0].length })
          }
        })
        if (!matches.length) return
        let tr = state.tr
        for (const { from, to } of [...matches].reverse()) {
          tr = replacement
            ? tr.replaceWith(from, to, schema.text(replacement))
            : tr.delete(from, to)
        }
        editor.view.dispatch(tr)
        total += matches.length
      })
      return total
    }
  }


  // Sync when the set of blocks changes structurally (add/delete), but not during drags
  useEffect(() => {
    const incomingIds = initialBlocks.map(b => b.id).join(',')
    const localIds = blocks.map(b => b.id).join(',')
    if (incomingIds !== localIds) {
      if (initialBlocks.length > blocks.length) {
        const added = initialBlocks.find(b => !blocks.some(lb => lb.id === b.id))
        if (added) {
          setNewBlockId(added.id)
          setActiveBlockId(added.id)
        }
      }
      setBlocks(initialBlocks)
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initialBlocks])

  useEffect(() => { onActiveBlockChange?.(activeBlockId) }, [activeBlockId, onActiveBlockChange])

  // Scroll newly added block into view
  useEffect(() => {
    if (!newBlockId || !blocksContainerRef.current) return
    const el = blocksContainerRef.current.querySelector(`[data-block-id="${newBlockId}"]`) as HTMLElement | null
    el?.scrollIntoView({ behavior: 'smooth', block: 'nearest' })
  }, [newBlockId])

  // Deep-link: when the chapter URL carries `?block=<id>` (e.g. from the
  // Context modal's Origin link), scroll that block into view once the
  // editor has rendered it. Skipped entirely when `?q=` is also present
  // — search results just rely on the in-prose highlighting; auto-scroll
  // there was finicky in practice and being dropped mid-page was worse
  // than the writer scrolling to a highlight themselves. Fires once per
  // block id so it doesn't keep yanking the writer's scroll position.
  const searchParams = useSearchParams()
  const targetBlockId = searchParams?.get('block') ?? null
  const hasSearchQuery = !!(searchParams?.get('q') ?? '').trim()
  const scrolledTargetRef = useRef<string | null>(null)
  useEffect(() => {
    if (hasSearchQuery) return
    if (!targetBlockId || !blocksContainerRef.current) return
    if (scrolledTargetRef.current === targetBlockId) return
    if (!blocks.some(b => b.id === targetBlockId)) return
    const el = blocksContainerRef.current.querySelector(`[data-block-id="${targetBlockId}"]`) as HTMLElement | null
    if (!el) return
    el.scrollIntoView({ behavior: 'smooth', block: 'center' })
    setActiveBlockId(targetBlockId)
    scrolledTargetRef.current = targetBlockId
  }, [targetBlockId, hasSearchQuery, blocks])

  // Ctrl+Shift+Up/Down — move active block
  useEffect(() => {
    async function handleKeyDown(e: KeyboardEvent) {
      if (!e.ctrlKey || !e.shiftKey) return
      if (e.code !== 'ArrowUp' && e.code !== 'ArrowDown') return
      e.preventDefault()
      if (!activeBlockId) return
      const idx = blocks.findIndex(b => b.id === activeBlockId)
      if (idx === -1) return
      const isUp = e.code === 'ArrowUp'
      if (isUp && idx === 0) return
      if (!isUp && idx === blocks.length - 1) return
      const newIdx = isUp ? idx - 1 : idx + 1
      const reordered = arrayMove(blocks, idx, newIdx).map((b, i) => ({ ...b, order: i + 1 }))
      setBlocks(reordered)
      await fetch(`/api/chapters/${chapterId}/blocks/reorder`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(reordered.map(b => ({ id: b.id, order: b.order }))),
      })
    }
    document.addEventListener('keydown', handleKeyDown)
    return () => document.removeEventListener('keydown', handleKeyDown)
  }, [activeBlockId, blocks, chapterId])

  // ⌥⇧D — delete active block (refs avoid stale-closure bugs with activeBlockId)
  useEffect(() => {
    async function handleKeyDown(e: KeyboardEvent) {
      if (!e.altKey || !e.shiftKey || e.code !== 'KeyD') return
      const blockId = activeBlockIdRef.current
      if (!blockId) return
      e.preventDefault()
      await fetch(`/api/chapters/${chapterId}/blocks/${blockId}`, { method: 'DELETE' })
      onBlocksChangeRef.current()
    }
    document.addEventListener('keydown', handleKeyDown)
    return () => document.removeEventListener('keydown', handleKeyDown)
  // chapterId never changes within a page session; refs handle the rest
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [chapterId])

  async function updateBlock(blockId: string, data: object) {
    const existing = blocks.find(b => b.id === blockId)
    setBlocks(prev => prev.map(b => b.id === blockId ? { ...b, ...data } : b))
    await fetch(`/api/chapters/${chapterId}/blocks/${blockId}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data),
    })
    // Sidebar choices list keys off choice_point.prompt; nudge a refresh when that
    // (or the block's existence as a choice_point) could have changed.
    if (existing?.type === 'choice_point' && 'prompt' in data) {
      onChoicesChanged?.()
    }
  }

  async function deleteBlock(blockId: string) {
    const existing = blocks.find(b => b.id === blockId)
    await fetch(`/api/chapters/${chapterId}/blocks/${blockId}`, { method: 'DELETE' })
    onBlocksChange()
    if (existing?.type === 'choice_point') onChoicesChanged?.()
  }

  async function updateChoice(choiceId: string, data: object) {
    const block = blocks.find(b => b.choices.some(c => c.id === choiceId))
    if (!block) return
    setBlocks(prev => prev.map(b =>
      b.id !== block.id ? b : {
        ...b,
        choices: b.choices.map(c => c.id === choiceId ? { ...c, ...data } : c),
      }
    ))
    await fetch(`/api/blocks/${block.id}/choices/${choiceId}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data),
    })
    if (!('label' in data)) onBlocksChange()
  }

  async function addOverride(blockId: string, condition: object, content: string) {
    const res = await fetch(`/api/blocks/${blockId}/overrides`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ condition, content }),
    })
    const newOverride = await res.json()
    setBlocks(prev => prev.map(b =>
      b.id !== blockId ? b : { ...b, overrides: [...b.overrides, newOverride] }
    ))
    onBlocksChange()
  }

  async function updateOverride(overrideId: string, data: object) {
    const block = blocks.find(b => b.overrides.some(o => o.id === overrideId))
    if (!block) return
    setBlocks(prev => prev.map(b =>
      b.id !== block.id ? b : {
        ...b,
        overrides: b.overrides.map(o => o.id === overrideId ? { ...o, ...data } : o),
      }
    ))
    await fetch(`/api/blocks/${block.id}/overrides/${overrideId}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data),
    })
  }

  async function deleteOverride(overrideId: string) {
    const block = blocks.find(b => b.overrides.some(o => o.id === overrideId))
    if (!block) return
    setBlocks(prev => prev.map(b =>
      b.id !== block.id ? b : { ...b, overrides: b.overrides.filter(o => o.id !== overrideId) }
    ))
    await fetch(`/api/blocks/${block.id}/overrides/${overrideId}`, { method: 'DELETE' })
    onBlocksChange()
  }

  function handleDragStart(event: DragStartEvent) {
    const block = blocks.find(b => b.id === event.active.id)
    if (block) setDraggingBlock(block)
  }

  async function handleDragEnd(event: DragEndEvent) {
    setDraggingBlock(null)
    const { active, over } = event
    if (!over || active.id === over.id) return

    const oldIndex = blocks.findIndex(b => b.id === active.id)
    const newIndex = blocks.findIndex(b => b.id === over.id)
    const reordered = arrayMove(blocks, oldIndex, newIndex).map((b, i) => ({ ...b, order: i + 1 }))
    setBlocks(reordered)

    await fetch(`/api/chapters/${chapterId}/blocks/reorder`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(reordered.map(b => ({ id: b.id, order: b.order }))),
    })
  }

  return (
    <div>
      <DndContext sensors={sensors} collisionDetection={closestCenter} onDragStart={handleDragStart} onDragEnd={handleDragEnd}>
        <SortableContext items={blocks.map(b => b.id)} strategy={verticalListSortingStrategy}>
          <div ref={blocksContainerRef} className="flex flex-col gap-3">
            {blocks.map(block => (
              <SortableBlock
                key={block.id}
                block={block}
                isActive={activeBlockId === block.id}
                onActivate={() => setActiveBlockId(block.id)}
                onDelete={() => setPendingDelete(block)}
                isCollapsed={collapsedIds.has(block.id)}
                onToggleCollapse={() => toggleCollapsed(block.id)}
              >
                {block.type === 'text' && (
                  <TextBlock
                    content={block.content ?? null}
                    onChange={content => updateBlock(block.id, { content })}
                    autoFocus={block.id === newBlockId}
                    characters={characters}
                    variables={variables}
                    searchQuery={searchQuery}
                    onEditorReady={editor => textEditorsRef.current.set(block.id, editor)}
                  />
                )}

                {block.type === 'choice_point' && (
                  <ChoicePointBlock
                    prompt={block.prompt ?? null}
                    displayType={block.displayType ?? 'inline'}
                    condition={block.condition ?? null}
                    choices={block.choices}
                    variables={variables}
                    characters={characters}
                    searchQuery={searchQuery}
                    onUpdateBlock={data => updateBlock(block.id, data)}
                    onUpdateChoice={updateChoice}
                    onCreateVariable={onCreateVariable}
                  />
                )}

                {block.type === 'conditional_fragment' && (
                  <ConditionalBlock
                    overrides={block.overrides}
                    variables={variables}
                    characters={characters}
                    searchQuery={searchQuery}
                    onAddOverride={(condition, content) => addOverride(block.id, condition, content)}
                    onUpdateOverride={updateOverride}
                    onDeleteOverride={deleteOverride}
                  />
                )}

                {block.type === 'soundtrack' && (
                  <SoundtrackBlock
                    block={block}
                    variables={variables}
                    onUpdateBlock={data => updateBlock(block.id, data)}
                  />
                )}
              </SortableBlock>
            ))}

            {blocks.length === 0 && (
              <p className="text-ink-faint text-sm text-center py-8">Add your first block above to start writing.</p>
            )}
          </div>
        </SortableContext>

        <DragOverlay>
          {draggingBlock && (
            <div className="flex items-start cursor-grabbing" style={{ transform: 'rotate(0.75deg) scale(1.02)' }}>
              <div className={`flex-1 min-w-0 bg-surface-raised border border-accent/20 border-l-4 ${BLOCK_BORDER[draggingBlock.type] ?? ''} rounded-r-lg p-4 shadow-2xl`}>
                <div className="pl-4 flex flex-col gap-3 animate-pulse">
                  {/* skeleton toolbar */}
                  <div className="flex items-center gap-1.5">
                    {[18, 18, 18, 18].map((_, i) => (
                      <div key={i} className="h-5 w-5 rounded bg-ink-faint/20" />
                    ))}
                    <div className="mx-1 w-px h-4 bg-ink-faint/15" />
                    {[18, 18].map((_, i) => (
                      <div key={i} className="h-5 w-5 rounded bg-ink-faint/20" />
                    ))}
                    <div className="mx-1 w-px h-4 bg-ink-faint/15" />
                    <div className="h-5 w-14 rounded bg-ink-faint/20" />
                  </div>
                  {/* skeleton text lines */}
                  <div className="flex flex-col gap-2">
                    <div className="h-2.5 rounded-full bg-ink-faint/20 w-full" />
                    <div className="h-2.5 rounded-full bg-ink-faint/20 w-[91%]" />
                    <div className="h-2.5 rounded-full bg-ink-faint/20 w-[97%]" />
                    <div className="h-2.5 rounded-full bg-ink-faint/20 w-[83%]" />
                    <div className="h-2.5 rounded-full bg-ink-faint/20 w-[52%]" />
                  </div>
                </div>
              </div>
            </div>
          )}
        </DragOverlay>
      </DndContext>

      <ConfirmDialog
        open={pendingDelete !== null}
        title={`Delete this ${pendingDelete ? (BLOCK_TYPE_LABEL[pendingDelete.type] ?? 'block').toLowerCase() : 'block'}?`}
        message="The block and its content will be removed from the chapter."
        onCancel={() => setPendingDelete(null)}
        onConfirm={() => {
          const id = pendingDelete?.id
          setPendingDelete(null)
          if (id) deleteBlock(id)
        }}
      />
    </div>
  )
}
