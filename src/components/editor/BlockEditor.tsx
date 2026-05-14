'use client'

import { useState, useEffect, useRef } from 'react'
import { DndContext, closestCenter, PointerSensor, useSensor, useSensors } from '@dnd-kit/core'
import type { DragEndEvent } from '@dnd-kit/core'
import { SortableContext, useSortable, verticalListSortingStrategy, arrayMove } from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import { LuGripVertical, LuX } from 'react-icons/lu'
import TextBlock from './TextBlock'
import ChoicePointBlock from './ChoicePointBlock'
import ConditionalBlock from './ConditionalBlock'
import SoundtrackBlock from './SoundtrackBlock'

type Override = { id: string; order: number; condition: string; content: string }
type Choice = { id: string; label: string; setsVariables: string; targetChapterId: string | null }
type Block = {
  id: string
  order: number
  type: string
  content?: string | null
  prompt?: string | null
  displayType?: string | null
  baseContent?: string | null
  choices: Choice[]
  overrides: Override[]
}
type Variable = { id: string; name: string; type: string }
type Character = { id: string; name: string; age?: number | null; hasAvatar?: boolean }

type Props = {
  chapterId: string
  blocks: Block[]
  variables: Variable[]
  characters: Character[]
  onBlocksChange: () => void
  onCreateVariable: (name: string, type: string) => Promise<void>
  onActiveBlockChange?: (blockId: string | null) => void
}

const BLOCK_BORDER: Record<string, string> = {
  text: 'border-l-accent/30',
  choice_point: 'border-l-[#cc8888]',
  conditional_fragment: 'border-l-accent',
  soundtrack: 'border-l-accent/60',
}

function SortableBlock({
  block,
  children,
  onDelete,
  isActive,
  onActivate,
}: {
  block: Block
  children: React.ReactNode
  onDelete: () => void
  isActive: boolean
  onActivate: () => void
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: block.id })

  return (
    <div
      ref={setNodeRef}
      style={{ transform: CSS.Transform.toString(transform), transition, opacity: isDragging ? 0.5 : 1 }}
      className="flex items-start group"
      onClick={onActivate}
    >
      <div className={`flex-1 min-w-0 bg-surface-raised border border-accent/10 border-l-4 ${BLOCK_BORDER[block.type] ?? ''} rounded-r-lg p-4 relative transition-[margin] duration-200 group-hover:mr-2 ${isActive ? 'ring-1 ring-inset ring-accent/30' : ''}`}>
        <button
          {...attributes}
          {...listeners}
          className="absolute top-2 left-2 text-ink-faint opacity-0 group-hover:opacity-100 cursor-grab active:cursor-grabbing transition"
          title="Drag to reorder"
        >
          <LuGripVertical size={16} />
        </button>
        <div className="pl-4">
          {children}
        </div>
      </div>
      <button
        onClick={e => { e.stopPropagation(); onDelete() }}
        className="shrink-0 mt-2 text-ink-faint opacity-0 group-hover:opacity-100 hover:text-choice-kill transition-all duration-200"
        style={{ marginLeft: '8px' }}
      >
        <LuX size={15} />
      </button>
    </div>
  )
}

export default function BlockEditor({ chapterId, blocks: initialBlocks, variables, characters, onBlocksChange, onCreateVariable, onActiveBlockChange }: Props) {
  const [blocks, setBlocks] = useState<Block[]>(initialBlocks)
  const [activeBlockId, setActiveBlockId] = useState<string | null>(null)
  const [newBlockId, setNewBlockId] = useState<string | null>(null)
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 5 } }))
  const blocksContainerRef = useRef<HTMLDivElement>(null)
  const prevBlockCountRef = useRef(initialBlocks.length)
  const mountedRef = useRef(false)

  // Sync when the set of blocks changes structurally (add/delete), but not during drags
  useEffect(() => {
    const incomingIds = initialBlocks.map(b => b.id).join(',')
    const localIds = blocks.map(b => b.id).join(',')
    if (incomingIds !== localIds) {
      if (initialBlocks.length > blocks.length) {
        const added = initialBlocks.find(b => !blocks.some(lb => lb.id === b.id))
        if (added?.type === 'text') setNewBlockId(added.id)
      }
      setBlocks(initialBlocks)
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initialBlocks])

  useEffect(() => { onActiveBlockChange?.(activeBlockId) }, [activeBlockId, onActiveBlockChange])

  // Scroll newly added block into view
  useEffect(() => {
    if (!mountedRef.current) {
      mountedRef.current = true
      prevBlockCountRef.current = blocks.length
      return
    }
    if (blocks.length > prevBlockCountRef.current) {
      const last = blocksContainerRef.current?.lastElementChild as HTMLElement | null
      last?.scrollIntoView({ behavior: 'smooth', block: 'nearest' })
    }
    prevBlockCountRef.current = blocks.length
  }, [blocks.length])

  // Cmd/Ctrl+Shift+Up/Down — move active block
  useEffect(() => {
    const isMac = /Mac/i.test(navigator.platform)
    async function handleKeyDown(e: KeyboardEvent) {
      const meta = isMac ? e.metaKey : e.ctrlKey
      if (!meta || !e.shiftKey) return
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

  // ⌥⇧D — delete active block
  useEffect(() => {
    async function handleKeyDown(e: KeyboardEvent) {
      if (!e.altKey || !e.shiftKey || e.code !== 'KeyD') return
      if (!activeBlockId) return
      e.preventDefault()
      await fetch(`/api/chapters/${chapterId}/blocks/${activeBlockId}`, { method: 'DELETE' })
      onBlocksChange()
    }
    document.addEventListener('keydown', handleKeyDown)
    return () => document.removeEventListener('keydown', handleKeyDown)
  }, [activeBlockId, chapterId, onBlocksChange])

  async function updateBlock(blockId: string, data: object) {
    setBlocks(prev => prev.map(b => b.id === blockId ? { ...b, ...data } : b))
    await fetch(`/api/chapters/${chapterId}/blocks/${blockId}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data),
    })
  }

  async function deleteBlock(blockId: string) {
    await fetch(`/api/chapters/${chapterId}/blocks/${blockId}`, { method: 'DELETE' })
    onBlocksChange()
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

  async function handleDragEnd(event: DragEndEvent) {
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
      <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
        <SortableContext items={blocks.map(b => b.id)} strategy={verticalListSortingStrategy}>
          <div ref={blocksContainerRef} className="flex flex-col gap-3">
            {blocks.map(block => (
              <SortableBlock
                key={block.id}
                block={block}
                isActive={activeBlockId === block.id}
                onActivate={() => setActiveBlockId(block.id)}
                onDelete={() => deleteBlock(block.id)}
              >
                {block.type === 'text' && (
                  <TextBlock
                    content={block.content ?? null}
                    onChange={content => updateBlock(block.id, { content })}
                    autoFocus={block.id === newBlockId}
                    characters={characters}
                  />
                )}

                {block.type === 'choice_point' && (
                  <ChoicePointBlock
                    prompt={block.prompt ?? null}
                    displayType={block.displayType ?? 'inline'}
                    choices={block.choices}
                    variables={variables}
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
                    onAddOverride={(condition, content) => addOverride(block.id, condition, content)}
                    onUpdateOverride={updateOverride}
                    onDeleteOverride={deleteOverride}
                  />
                )}

                {block.type === 'soundtrack' && (
                  <SoundtrackBlock
                    block={block}
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
      </DndContext>
    </div>
  )
}
