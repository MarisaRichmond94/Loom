'use client'

import { memo, useState, useEffect, useMemo, useRef } from 'react'
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
import { findBlockMatches, type SearchOptions } from '@/lib/searchMatch'
import { notify } from '@/lib/notifications'
import ConfirmDialog from '@/components/ConfirmDialog'
import { resolveChapter, buildStoryState, varTypeMap } from '@/lib/chapterResolve'
import type { StoryState } from '@/lib/storyEngine'

type Override = { id: string; order: number; condition: string; content: string; endingMessage?: string | null; endsChapter?: boolean }
type Choice = { id: string; order: number; label: string; setsVariables: string; targetChapterId: string | null; endingMessage?: string | null; condition?: string | null; isBadEnding?: boolean; endsChapter?: boolean }
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
  // Match-case / whole-word toggles applied to highlight, jump, and replace.
  searchOptions?: SearchOptions
  // Ref that receives a replaceAll function once editors mount. The chapter
  // page uses this to drive replace-all from the local chapter search bar.
  replaceAllRef?: React.MutableRefObject<((search: string, replacement: string) => number) | null>
  // Ref that receives a jumpToFirstMatch function — places the cursor at the
  // end of the first match in document order and focuses that editor.
  jumpToFirstMatchRef?: React.MutableRefObject<((query: string) => void) | null>
  // Jump to the next/previous search match relative to the caret, wrapping
  // around at the ends. Drives ⌥⇧→ / ⌥⇧← from the chapter search bar.
  jumpToMatchRef?: React.MutableRefObject<((query: string, dir: 'next' | 'prev') => void) | null>
  // Reports how many matches `searchQuery` currently has across the mounted
  // prose editors, so the find bar can show a count that tracks live edits.
  // Owned here (not by the page) because the editors are the only source
  // that reflects an edit the instant it happens.
  onMatchCountChange?: (count: number) => void
  // Ref that receives handles on the write-behind save queue. Find-and-replace
  // needs both: flushAll so the server reads prose the writer has actually
  // finished typing, and discardAll so a post-replace reload can drop queued
  // pre-replace content instead of letting it PATCH back over the result.
  savesRef?: React.MutableRefObject<{ flushAll: () => Promise<void>; discardAll: () => void } | null>
  // Ref that receives a scrollToCursor function — refocuses the active text
  // editor and scrolls the cursor position into the centre of the viewport.
  scrollToCursorRef?: React.MutableRefObject<(() => void) | null>
  // Ref written every render with the current block list. The chapter page
  // reads this in copyCanonText to avoid the stale chapter.blocks state
  // (which only refreshes on structural changes, not on per-keystroke PATCHes).
  currentBlocksRef?: React.MutableRefObject<{ id: string; order: number; type: string; content?: string | null; baseContent?: string | null; condition?: string | null; choices?: { id: string; order: number; label: string; setsVariables: string; targetChapterId: string | null; condition?: string | null; endingMessage?: string | null; isBadEnding?: boolean; endsChapter?: boolean }[]; overrides?: { id: string; order: number; condition: string; content: string; endingMessage?: string | null; endsChapter?: boolean }[] }[] | null>
  onTextBlockBlur?: () => void
  // Pins a snapshot of a single prose unit (text block, conditional override,
  // or choice branch) to the reference panel. The page owns the pinned list;
  // the editor forwards the prose JSON as it is at pin time.
  onPinText?: (content: string) => void
  // The path lens's configured StoryState, or null when no path is active.
  // When set, every block is resolved against it and the off-path ones (plus
  // off-path overrides / choice branches) are dimmed so the writer sees which
  // text is included at a glance. Null leaves the editor in its normal
  // all-branches-visible state.
  lensState?: StoryState | null
}

// How long after the last keystroke a record's coalesced PATCH fires.
const SAVE_DEBOUNCE_MS = 600

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
  dimmed,
}: {
  block: Block
  children: React.ReactNode
  onDelete: () => void
  isActive: boolean
  onActivate: () => void
  isCollapsed: boolean
  onToggleCollapse: () => void
  // True when a path lens is active and this whole block is off-path — the
  // card fades back (but stays fully editable) so on-path blocks stand out.
  dimmed: boolean
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
      style={{ transform: CSS.Transform.toString(transform), transition, opacity: isDragging ? 0.3 : dimmed ? 0.4 : 1 }}
      className="flex items-start group transition-opacity duration-200"
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

// Everything a row needs to call back into the editor, delivered through a
// single ref whose identity never changes. The ref's contents are reassigned
// every BlockEditor render, so rows always invoke the latest closures without
// their own props ever churning.
type BlockRowApi = {
  updateBlock: (blockId: string, data: object) => void
  updateChoice: (choiceId: string, data: object) => void
  addChoice: (blockId: string) => Promise<void>
  deleteChoice: (choiceId: string) => Promise<void>
  updateOverride: (overrideId: string, data: object) => void
  addOverride: (blockId: string, condition: object, content: string) => Promise<void>
  deleteOverride: (overrideId: string) => Promise<void>
  onCreateVariable: (name: string, type: string, defaultValue?: unknown) => Promise<void>
  activate: (blockId: string) => void
  requestDelete: (block: Block) => void
  pinText: (content: string) => void
  toggleCollapsed: (blockId: string) => void
  registerEditor: (key: string, editor: Editor | null) => void
  textBlockBlur: () => void
}

// One editor row. Memoized so a keystroke — which replaces only the edited
// block's object in state — re-renders that row alone instead of the whole
// chapter. All other props are primitives or identity-stable between
// keystrokes.
const BlockRow = memo(function BlockRow({ block, isActive, isCollapsed, autoFocus, variables, characters, searchQuery, searchOptions, api, lensActive, dimmed, activeOverrideId, activeChoiceId }: {
  block: Block
  isActive: boolean
  isCollapsed: boolean
  autoFocus: boolean
  variables: Variable[]
  characters: Character[]
  searchQuery: string
  searchOptions?: SearchOptions
  api: { current: BlockRowApi }
  // Path-lens hints, passed as primitives (not the resolution object) so an
  // unchanged row keeps its memo across keystrokes while a lens is active.
  // lensActive: is any lens on. dimmed: this whole block is off-path. The
  // active ids tell the conditional / choice sub-components which override or
  // branch is on-path so they highlight it and dim the rest.
  lensActive: boolean
  dimmed: boolean
  activeOverrideId: string | null
  activeChoiceId: string | null
}) {
  return (
    <SortableBlock
      block={block}
      isActive={isActive}
      onActivate={() => api.current.activate(block.id)}
      onDelete={() => api.current.requestDelete(block)}
      isCollapsed={isCollapsed}
      onToggleCollapse={() => api.current.toggleCollapsed(block.id)}
      dimmed={dimmed}
    >
      {block.type === 'text' && (
        <TextBlock
          content={block.content ?? null}
          onChange={content => api.current.updateBlock(block.id, { content })}
          autoFocus={autoFocus}
          characters={characters}
          variables={variables}
          searchQuery={searchQuery}
          searchOptions={searchOptions}
          onEditorReady={editor => api.current.registerEditor(block.id, editor)}
          onBlur={() => api.current.textBlockBlur()}
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
          lensActive={lensActive}
          activeChoiceId={activeChoiceId}
          searchQuery={searchQuery}
          searchOptions={searchOptions}
          onEditorReady={(choiceId, editor) => api.current.registerEditor(`ch:${choiceId}`, editor)}
          onPinText={content => api.current.pinText(content)}
          onUpdateBlock={data => api.current.updateBlock(block.id, data)}
          onUpdateChoice={(choiceId, data) => api.current.updateChoice(choiceId, data)}
          onAddChoice={() => api.current.addChoice(block.id)}
          onDeleteChoice={choiceId => api.current.deleteChoice(choiceId)}
          onCreateVariable={(name, type, defaultValue) => api.current.onCreateVariable(name, type, defaultValue)}
        />
      )}

      {block.type === 'conditional_fragment' && (
        <ConditionalBlock
          overrides={block.overrides}
          variables={variables}
          characters={characters}
          lensActive={lensActive}
          activeOverrideId={activeOverrideId}
          searchQuery={searchQuery}
          searchOptions={searchOptions}
          onEditorReady={(overrideId, editor) => api.current.registerEditor(`ov:${overrideId}`, editor)}
          onPinText={content => api.current.pinText(content)}
          onAddOverride={(condition, content) => api.current.addOverride(block.id, condition, content)}
          onUpdateOverride={(overrideId, data) => api.current.updateOverride(overrideId, data)}
          onDeleteOverride={overrideId => api.current.deleteOverride(overrideId)}
        />
      )}

      {block.type === 'soundtrack' && (
        <SoundtrackBlock
          block={block}
          variables={variables}
          onUpdateBlock={data => api.current.updateBlock(block.id, data)}
        />
      )}
    </SortableBlock>
  )
})

export default function BlockEditor({ chapterId, blocks: initialBlocks, variables, characters, onBlocksChange, onChoicesChanged, onCreateVariable, onActiveBlockChange, collapsedIds, onCollapsedIdsChange, searchQuery = '', searchOptions, replaceAllRef, jumpToFirstMatchRef, jumpToMatchRef, scrollToCursorRef, currentBlocksRef, onTextBlockBlur, onPinText, lensState, onMatchCountChange, savesRef }: Props) {
  const searchOpts = searchOptions ?? {}
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
  const blocksRef = useRef<Block[]>(blocks)
  const onChoicesChangedRef = useRef(onChoicesChanged)
  activeBlockIdRef.current = activeBlockId
  blocksRef.current = blocks
  onChoicesChangedRef.current = onChoicesChanged
  if (currentBlocksRef) currentBlocksRef.current = blocks

  const textEditorsRef = useRef<Map<string, Editor>>(new Map())
  // Bumped every time a prose editor registers or unregisters. TipTap's
  // useEditor resolves asynchronously (immediatelyRender: false), so the
  // editors don't exist yet on the render that mounts them — without this
  // signal the match count below would settle on whatever it saw before
  // the first editor was ready.
  const [editorsVersion, setEditorsVersion] = useState(0)
  if (replaceAllRef) {
    replaceAllRef.current = (search: string, replacement: string) => {
      if (!search.trim()) return 0
      let total = 0
      textEditorsRef.current.forEach(editor => {
        const { state } = editor
        // Same matcher as the highlight/jump so Replace All acts on exactly
        // the matches the writer sees (honouring case / whole-word, and
        // matches that straddle a mark boundary).
        const matches = findBlockMatches(state.doc, search, searchOpts)
        if (!matches.length) return
        let tr = state.tr
        for (const { from, to } of [...matches].reverse()) {
          tr = replacement
            ? tr.replaceWith(from, to, state.schema.text(replacement))
            : tr.delete(from, to)
        }
        editor.view.dispatch(tr)
        total += matches.length
      })
      return total
    }
  }

  // Composite keys of a block's editable prose surfaces, in the order they
  // render — must match the keys registered in registerEditor. A text block
  // has one (its content); a conditional block one per override; a choice
  // block one per choice's branch text. Overrides/choices are sorted by
  // `order` so jump follows on-screen order, not array/registration order.
  function editorKeysForBlock(block: Block): string[] {
    if (block.type === 'text') return [block.id]
    if (block.type === 'conditional_fragment') {
      return [...block.overrides].sort((a, b) => a.order - b.order).map(o => `ov:${o.id}`)
    }
    if (block.type === 'choice_point') {
      return [...block.choices].sort((a, b) => a.order - b.order).map(c => `ch:${c.id}`)
    }
    return []
  }

  // Every registered prose editor in document order — walking blocksRef (and
  // each block's sub-surfaces) rather than the editor Map so drag reorders
  // don't scramble the sequence. Collapsed/absent editors are simply skipped.
  function orderedEditors(): Editor[] {
    const list: Editor[] = []
    for (const block of blocksRef.current) {
      for (const key of editorKeysForBlock(block)) {
        const editor = textEditorsRef.current.get(key)
        if (editor) list.push(editor)
      }
    }
    return list
  }

  // All occurrences of the query across every prose surface, in document
  // order. `seq` indexes orderedEditors() so next/prev can anchor to the
  // focused editor even across conditional/choice sub-editors.
  function collectMatches(query: string): { seq: number; editor: Editor; from: number; to: number }[] {
    if (!query.trim()) return []
    const matches: { seq: number; editor: Editor; from: number; to: number }[] = []
    orderedEditors().forEach((editor, seq) => {
      // Shared matcher so jump targets line up exactly with the yellow
      // highlights, including matches that straddle mark boundaries.
      for (const { from, to } of findBlockMatches(editor.state.doc, query, searchOpts)) {
        matches.push({ seq, editor, from, to })
      }
    })
    return matches
  }

  function landOnMatch(m: { editor: Editor; from: number; to: number }) {
    // Order matters. Set the selection first, while the editor is still
    // unfocused, so keepCaretInView bails instead of anchoring the match to
    // the bottom margin. Then centre it with an instant scroll, and finally
    // focus with scrollIntoView:false — TipTap's focus() otherwise queues a
    // RAF that re-scrolls the caret to the nearest edge, undoing the centre.
    // Because the match is already centred (and visible) when focus lands,
    // nothing re-scrolls.
    m.editor.commands.setTextSelection({ from: m.from, to: m.to })
    try {
      const { node } = m.editor.view.domAtPos(m.from)
      const el = node instanceof Element ? node : node.parentElement
      el?.scrollIntoView({ block: 'center' })
    } catch { /* pos out of range */ }
    m.editor.commands.focus(undefined, { scrollIntoView: false })
  }

  if (jumpToFirstMatchRef) {
    jumpToFirstMatchRef.current = (query: string) => {
      const matches = collectMatches(query)
      if (matches.length) landOnMatch(matches[0])
    }
  }

  if (jumpToMatchRef) {
    jumpToMatchRef.current = (query: string, dir: 'next' | 'prev') => {
      const matches = collectMatches(query)
      if (!matches.length) return
      // Anchor navigation to the currently focused editor's selection start;
      // with nothing focused, next→first and prev→last.
      let curIdx = -1, curPos = -1
      orderedEditors().forEach((editor, seq) => {
        if (editor.view.hasFocus()) { curIdx = seq; curPos = editor.state.selection.from }
      })
      let target
      if (dir === 'next') {
        target = matches.find(m => m.seq > curIdx || (m.seq === curIdx && m.from > curPos)) ?? matches[0]
      } else {
        const before = matches.filter(m => m.seq < curIdx || (m.seq === curIdx && m.from < curPos))
        target = before.length ? before[before.length - 1] : matches[matches.length - 1]
      }
      landOnMatch(target)
    }
  }

  // Match count for the chapter find bar, taken from the same registered
  // editors that highlight, jump, and Replace All go through — so the number
  // can never disagree with what the writer sees. It re-runs on every signal
  // that can change the answer: the query/options, a doc edit (each keystroke
  // and each Replace All lands in `blocks` via updateBlock), an editor
  // mounting or unmounting, and collapse/expand.
  //
  // Counting the page's chapter.blocks instead was the old approach and the
  // reason the count went stale: that snapshot is only refetched on
  // structural changes, so replacing "cat" with "dog" left the bar still
  // reporting matches for "cat" against pre-edit prose.
  useEffect(() => {
    onMatchCountChange?.(collectMatches(searchQuery).length)
  // collectMatches reads live refs; these are the inputs that change its result.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchQuery, searchOpts.caseSensitive, searchOpts.wholeWord, blocks, collapsedIds, editorsVersion, onMatchCountChange])

  if (scrollToCursorRef) {
    scrollToCursorRef.current = () => {
      const blockId = activeBlockIdRef.current
      if (!blockId) return
      const editor = textEditorsRef.current.get(blockId)
      if (!editor) return
      editor.commands.focus()
      const { from } = editor.state.selection
      try {
        const { node } = editor.view.domAtPos(from)
        const el = node instanceof Element ? node : node.parentElement
        el?.scrollIntoView({ behavior: 'smooth', block: 'center' })
      } catch { /* pos out of range */ }
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

  // ⌥⇧D — open delete confirmation for the active block. ConfirmDialog
  // autofocuses the Delete button, so Enter immediately confirms and ESC cancels.
  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      if (!e.altKey || !e.shiftKey || e.code !== 'KeyD') return
      const blockId = activeBlockIdRef.current
      if (!blockId) return
      const block = blocksRef.current.find(b => b.id === blockId)
      if (!block) return
      e.preventDefault()
      setPendingDelete(block)
    }
    document.addEventListener('keydown', handleKeyDown)
    return () => document.removeEventListener('keydown', handleKeyDown)
  // chapterId never changes within a page session; refs handle the rest
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [chapterId])

  // Debounced write-behind for the per-keystroke save paths (prose content,
  // override content, choice branch text). Local state still updates on every
  // keystroke; the PATCH for a given record coalesces into one request that
  // fires SAVE_DEBOUNCE_MS after the last edit. Pending saves flush on text
  // blur, unmount, and tab close (keepalive), so nothing is ever left behind.
  // All PATCHes to the same URL are chained through sendSave so a slow early
  // save can never land after (and overwrite) a newer one. Failed saves retry
  // with backoff, then surface an error toast — the prose DB is the source of
  // truth, so its write path must never fail silently.
  const pendingSavesRef = useRef<Map<string, { url: string; data: Record<string, unknown>; timer: ReturnType<typeof setTimeout>; after?: () => void }>>(new Map())
  const saveChainRef = useRef<Map<string, Promise<void>>>(new Map())

  function sendSave(url: string, data: Record<string, unknown>, keepalive = false): Promise<void> {
    const prev = saveChainRef.current.get(url) ?? Promise.resolve()
    const next = prev.catch(() => {}).then(async () => {
      for (let attempt = 0; ; attempt++) {
        let res: Response | null = null
        try {
          res = await fetch(url, {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(data),
            keepalive,
          })
        } catch {
          // Network failure — fall through to retry.
        }
        if (res?.ok) return
        // 404 means the record was deleted while a save was in flight —
        // deleteBlock discards pending saves, so this race is benign.
        if (res?.status === 404) return
        // Other 4xx: the server rejected the payload; retrying won't help.
        if (res && res.status < 500) {
          notify('error', 'Save failed — your latest edits are not stored. Copy them somewhere safe and reload.')
          return
        }
        // Page is closing; no room to retry or notify.
        if (keepalive) return
        if (attempt >= 2) {
          notify('error', 'Save failed after retrying — your latest edits are not stored. Check that Loom’s server is running.')
          return
        }
        await new Promise(resolve => setTimeout(resolve, 1500 * (attempt + 1)))
      }
    })
    saveChainRef.current.set(url, next)
    return next
  }

  function queueSave(key: string, url: string, data: Record<string, unknown>, after?: () => void) {
    const prev = pendingSavesRef.current.get(key)
    if (prev) {
      clearTimeout(prev.timer)
      data = { ...prev.data, ...data }
      after = after ?? prev.after
    }
    pendingSavesRef.current.set(key, {
      url,
      data,
      after,
      timer: setTimeout(() => void flushSave(key), SAVE_DEBOUNCE_MS),
    })
  }

  function flushSave(key: string, keepalive = false): Promise<void> {
    const entry = pendingSavesRef.current.get(key)
    if (!entry) return Promise.resolve()
    pendingSavesRef.current.delete(key)
    clearTimeout(entry.timer)
    const done = sendSave(entry.url, entry.data, keepalive)
    if (entry.after) void done.then(entry.after)
    return done
  }

  // Resolves once every queued PATCH has landed. Callers that just want the
  // queue drained (blur, unmount, tab close) ignore the promise; find-and-
  // replace awaits it so the server can't read prose the writer has already
  // superseded.
  function flushAllSaves(keepalive = false): Promise<void> {
    return Promise.all(
      Array.from(pendingSavesRef.current.keys()).map(key => flushSave(key, keepalive)),
    ).then(() => {}, () => {})
  }

  function discardPendingSave(key: string) {
    const entry = pendingSavesRef.current.get(key)
    if (!entry) return
    clearTimeout(entry.timer)
    pendingSavesRef.current.delete(key)
  }

  // Drop every queued PATCH without sending it. Only safe when the database
  // is known to hold something better than what's queued — after a replace,
  // where the queue holds pre-replace prose and the reload is about to
  // rebuild the editors from the rewritten rows.
  function discardAllSaves() {
    for (const key of Array.from(pendingSavesRef.current.keys())) discardPendingSave(key)
  }

  if (savesRef) savesRef.current = { flushAll: () => flushAllSaves(), discardAll: discardAllSaves }

  useEffect(() => {
    const flush = () => flushAllSaves(true)
    window.addEventListener('pagehide', flush)
    window.addEventListener('beforeunload', flush)
    return () => {
      window.removeEventListener('pagehide', flush)
      window.removeEventListener('beforeunload', flush)
      flushAllSaves()
    }
  // flushAllSaves only touches refs; mount/unmount is the right lifecycle
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  function updateBlock(blockId: string, data: object) {
    const existing = blocks.find(b => b.id === blockId)
    setBlocks(prev => prev.map(b => b.id === blockId ? { ...b, ...data } : b))
    const d = data as Record<string, unknown>
    const url = `/api/chapters/${chapterId}/blocks/${blockId}`
    // Sidebar choices list keys off choice_point.prompt; nudge a refresh when
    // that could have changed — after the save lands, so it reads fresh data.
    const after = existing?.type === 'choice_point' && 'prompt' in d
      ? () => onChoicesChangedRef.current?.()
      : undefined
    if (Object.keys(d).every(k => k === 'content' || k === 'prompt')) {
      queueSave(`block:${blockId}`, url, d, after)
    } else {
      // Structural edits (condition, displayType, pins…) save immediately;
      // flush any pending typing save first so field updates land in order.
      void flushSave(`block:${blockId}`)
      const done = sendSave(url, d)
      if (after) void done.then(after)
    }
  }

  async function deleteBlock(blockId: string) {
    const existing = blocks.find(b => b.id === blockId)
    // Drop pending saves for anything the delete is about to remove —
    // flushing them would just race the DELETE.
    discardPendingSave(`block:${blockId}`)
    existing?.choices.forEach(c => discardPendingSave(`choice:${c.id}`))
    existing?.overrides.forEach(o => discardPendingSave(`override:${o.id}`))
    await fetch(`/api/chapters/${chapterId}/blocks/${blockId}`, { method: 'DELETE' })
    onBlocksChange()
    if (existing?.type === 'choice_point') onChoicesChanged?.()
  }

  function updateChoice(choiceId: string, data: object) {
    const block = blocks.find(b => b.choices.some(c => c.id === choiceId))
    if (!block) return
    setBlocks(prev => prev.map(b =>
      b.id !== block.id ? b : {
        ...b,
        choices: b.choices.map(c => c.id === choiceId ? { ...c, ...data } : c),
      }
    ))
    const d = data as Record<string, unknown>
    const url = `/api/blocks/${block.id}/choices/${choiceId}`
    // No refetch here: the optimistic update above is the whole change (the
    // PATCH writes fields verbatim), and nothing page-side reads choice
    // fields from its own copy — copy/canon flows use currentBlocksRef.
    if (Object.keys(d).every(k => k === 'label' || k === 'endingMessage')) {
      queueSave(`choice:${choiceId}`, url, d)
    } else {
      void flushSave(`choice:${choiceId}`)
      void sendSave(url, d)
    }
  }

  async function addChoice(blockId: string) {
    const res = await fetch(`/api/blocks/${blockId}/choices`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ label: '' }),
    })
    if (!res.ok) return
    const newChoice = await res.json()
    // Server assigns order (max+1) and returns the full row — append locally,
    // no full-list refetch. Sidebar choice list keys off the block prompt, not
    // per-option data, so no onChoicesChanged nudge needed.
    setBlocks(prev => prev.map(b =>
      b.id !== blockId ? b : { ...b, choices: [...b.choices, newChoice] }
    ))
  }

  async function deleteChoice(choiceId: string) {
    const block = blocks.find(b => b.choices.some(c => c.id === choiceId))
    if (!block) return
    discardPendingSave(`choice:${choiceId}`)
    setBlocks(prev => prev.map(b =>
      b.id !== block.id ? b : { ...b, choices: b.choices.filter(c => c.id !== choiceId) }
    ))
    await fetch(`/api/blocks/${block.id}/choices/${choiceId}`, { method: 'DELETE' })
  }

  async function addOverride(blockId: string, condition: object, content: string) {
    const res = await fetch(`/api/blocks/${blockId}/overrides`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ condition, content }),
    })
    const newOverride = await res.json()
    // The server row is appended locally — no full-list refetch needed.
    setBlocks(prev => prev.map(b =>
      b.id !== blockId ? b : { ...b, overrides: [...b.overrides, newOverride] }
    ))
  }

  function updateOverride(overrideId: string, data: object) {
    const block = blocks.find(b => b.overrides.some(o => o.id === overrideId))
    if (!block) return
    setBlocks(prev => prev.map(b =>
      b.id !== block.id ? b : {
        ...b,
        overrides: b.overrides.map(o => o.id === overrideId ? { ...o, ...data } : o),
      }
    ))
    const d = data as Record<string, unknown>
    const url = `/api/blocks/${block.id}/overrides/${overrideId}`
    if (Object.keys(d).every(k => k === 'content' || k === 'endingMessage')) {
      queueSave(`override:${overrideId}`, url, d)
    } else {
      void flushSave(`override:${overrideId}`)
      void sendSave(url, d)
    }
  }

  async function deleteOverride(overrideId: string) {
    const block = blocks.find(b => b.overrides.some(o => o.id === overrideId))
    if (!block) return
    discardPendingSave(`override:${overrideId}`)
    setBlocks(prev => prev.map(b =>
      b.id !== block.id ? b : { ...b, overrides: b.overrides.filter(o => o.id !== overrideId) }
    ))
    await fetch(`/api/blocks/${block.id}/overrides/${overrideId}`, { method: 'DELETE' })
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

  // Reassigned every render so rows always call the freshest closures; the
  // ref object itself never changes identity, keeping BlockRow's memo intact.
  const blockApiRef = useRef<BlockRowApi>(null!)
  blockApiRef.current = {
    updateBlock,
    updateChoice,
    addChoice,
    deleteChoice,
    updateOverride,
    addOverride,
    deleteOverride,
    onCreateVariable,
    activate: id => setActiveBlockId(id),
    requestDelete: b => setPendingDelete(b),
    // Freezes the passed prose JSON (already the freshest per-keystroke value
    // from the block/override/choice in state) into the reference panel.
    pinText: content => onPinText?.(content),
    toggleCollapsed,
    // Register on mount, unregister on unmount (editor === null). Keyed by a
    // composite id — the block id for a text block, `ov:<id>`/`ch:<id>` for
    // conditional overrides and choice branch text — so a block with several
    // prose editors keeps them distinct. Unregistering keeps collapsed and
    // deleted surfaces out of jump/replace instead of leaving stale editors.
    registerEditor: (key, editor) => {
      if (editor) textEditorsRef.current.set(key, editor)
      else textEditorsRef.current.delete(key)
      setEditorsVersion(v => v + 1)
    },
    // Leaving a text editor commits its pending save right away — this also
    // guarantees content is in flight before the blur-driven canon export
    // reads the DB.
    textBlockBlur: () => {
      flushAllSaves()
      onTextBlockBlur?.()
    },
  }

  const sortableIds = useMemo(() => blocks.map(b => b.id), [blocks])

  // Resolve every block against the path lens once per relevant change, so the
  // rows can dim the off-path ones and highlight the active override / branch.
  // Same walk Copy uses, so what's highlighted is exactly what Copy emits.
  const lensActive = !!lensState
  const lensResolution = useMemo(() => {
    if (!lensState) return null
    return resolveChapter(blocks, buildStoryState(variables, lensState), varTypeMap(variables))
  }, [lensState, blocks, variables])

  return (
    <div>
      <DndContext sensors={sensors} collisionDetection={closestCenter} onDragStart={handleDragStart} onDragEnd={handleDragEnd}>
        <SortableContext items={sortableIds} strategy={verticalListSortingStrategy}>
          <div ref={blocksContainerRef} className="flex flex-col gap-3">
            {blocks.map(block => {
              const r = lensResolution?.get(block.id)
              return (
              <BlockRow
                key={block.id}
                block={block}
                isActive={activeBlockId === block.id}
                isCollapsed={collapsedIds.has(block.id)}
                autoFocus={block.id === newBlockId}
                variables={variables}
                characters={characters}
                searchQuery={searchQuery}
                searchOptions={searchOptions}
                api={blockApiRef}
                lensActive={lensActive}
                dimmed={lensActive && !!r && !r.included}
                activeOverrideId={r?.activeOverrideId ?? null}
                activeChoiceId={r?.activeChoiceId ?? null}
              />
              )
            })}

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
