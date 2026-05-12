'use client'

import TextBlock from './TextBlock'
import ChoicePointBlock from './ChoicePointBlock'
import ConditionalBlock from './ConditionalBlock'

type Override = { id: string; order: number; condition: string; content: string }
type Choice = { id: string; label: string; setsVariables: string; targetSceneId: string | null }
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

type Props = {
  sceneId: string
  blocks: Block[]
  variables: Variable[]
  onBlocksChange: () => void
}

const BLOCK_BORDER: Record<string, string> = {
  text: 'border-l-accent/30',
  choice_point: 'border-l-choice-kill',
  conditional_fragment: 'border-l-accent',
}

export default function BlockEditor({ sceneId, blocks, variables, onBlocksChange }: Props) {
  async function addBlock(type: string) {
    await fetch(`/api/scenes/${sceneId}/blocks`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        type,
        ...(type === 'text' && { content: '{"type":"doc","content":[{"type":"paragraph"}]}' }),
        ...(type === 'choice_point' && { displayType: 'inline', prompt: null }),
        ...(type === 'conditional_fragment' && {
          baseContent: '{"type":"doc","content":[{"type":"paragraph"}]}',
        }),
      }),
    })
    onBlocksChange()
  }

  async function updateBlock(blockId: string, data: object) {
    await fetch(`/api/scenes/${sceneId}/blocks/${blockId}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data),
    })
  }

  async function deleteBlock(blockId: string) {
    await fetch(`/api/scenes/${sceneId}/blocks/${blockId}`, { method: 'DELETE' })
    onBlocksChange()
  }

  async function addChoice(blockId: string, label: string) {
    await fetch(`/api/blocks/${blockId}/choices`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ label }),
    })
    onBlocksChange()
  }

  async function updateChoice(choiceId: string, data: object) {
    const block = blocks.find(b => b.choices.some(c => c.id === choiceId))
    if (!block) return
    await fetch(`/api/blocks/${block.id}/choices/${choiceId}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data),
    })
    onBlocksChange()
  }

  async function deleteChoice(choiceId: string) {
    const block = blocks.find(b => b.choices.some(c => c.id === choiceId))
    if (!block) return
    await fetch(`/api/blocks/${block.id}/choices/${choiceId}`, { method: 'DELETE' })
    onBlocksChange()
  }

  async function addOverride(blockId: string, condition: object, content: string) {
    await fetch(`/api/blocks/${blockId}/overrides`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ condition, content }),
    })
    onBlocksChange()
  }

  async function updateOverride(overrideId: string, data: object) {
    const block = blocks.find(b => b.overrides.some(o => o.id === overrideId))
    if (!block) return
    await fetch(`/api/blocks/${block.id}/overrides/${overrideId}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data),
    })
    onBlocksChange()
  }

  async function deleteOverride(overrideId: string) {
    const block = blocks.find(b => b.overrides.some(o => o.id === overrideId))
    if (!block) return
    await fetch(`/api/blocks/${block.id}/overrides/${overrideId}`, { method: 'DELETE' })
    onBlocksChange()
  }

  return (
    <div>
      <div className="flex gap-2 mb-4">
        <button onClick={() => addBlock('text')} className="px-3 py-1.5 rounded text-xs bg-surface-overlay border border-accent/20 text-ink-muted hover:text-ink transition">+ Text</button>
        <button onClick={() => addBlock('choice_point')} className="px-3 py-1.5 rounded text-xs bg-choice-kill-bg border border-choice-kill-border text-choice-kill hover:opacity-80 transition">⑂ Choice Point</button>
        <button onClick={() => addBlock('conditional_fragment')} className="px-3 py-1.5 rounded text-xs bg-surface-overlay border border-accent/30 text-accent hover:opacity-80 transition">◈ Conditional</button>
      </div>

      <div className="flex flex-col gap-3">
        {blocks.map(block => (
          <div key={block.id} className={`bg-surface-raised border border-accent/10 border-l-4 ${BLOCK_BORDER[block.type] ?? ''} rounded-r-lg p-4 group relative`}>
            <button
              onClick={() => deleteBlock(block.id)}
              className="absolute top-2 right-2 text-xs text-ink-faint opacity-0 group-hover:opacity-100 hover:text-choice-kill transition"
            >
              ✕
            </button>

            {block.type === 'text' && (
              <TextBlock
                content={block.content ?? null}
                onChange={content => updateBlock(block.id, { content })}
              />
            )}

            {block.type === 'choice_point' && (
              <ChoicePointBlock
                blockId={block.id}
                displayType={block.displayType ?? 'inline'}
                choices={block.choices}
                variables={variables}
                onUpdateBlock={data => updateBlock(block.id, data)}
                onAddChoice={label => addChoice(block.id, label)}
                onUpdateChoice={updateChoice}
                onDeleteChoice={deleteChoice}
              />
            )}

            {block.type === 'conditional_fragment' && (
              <ConditionalBlock
                baseContent={block.baseContent ?? null}
                overrides={block.overrides}
                variables={variables}
                onUpdateBase={content => updateBlock(block.id, { baseContent: content })}
                onAddOverride={(condition, content) => addOverride(block.id, condition, content)}
                onUpdateOverride={updateOverride}
                onDeleteOverride={deleteOverride}
              />
            )}
          </div>
        ))}

        {blocks.length === 0 && (
          <p className="text-ink-faint text-sm text-center py-8">Add your first block above to start writing.</p>
        )}
      </div>
    </div>
  )
}
