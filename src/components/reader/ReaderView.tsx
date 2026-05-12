'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { generateHTML } from '@tiptap/html'
import StarterKit from '@tiptap/starter-kit'
import { resolveConditional } from '@/lib/storyEngine'
import type { StoryState, HistoryEntry } from '@/lib/storyEngine'
import InlineChoice from './InlineChoice'
import ChapterGate from './ChapterGate'
import HistoryPanel from './HistoryPanel'

type Override = { id: string; order: number; condition: string; content: string }
type Choice = { id: string; label: string; setsVariables: string; targetChapterId: string | null }
type Block = {
  id: string; order: number; type: string
  content?: string | null; prompt?: string | null; displayType?: string | null; baseContent?: string | null
  choices: Choice[]
  overrides: Override[]
}

type Props = {
  sessionId: string
  seriesId: string
  blocks: Block[]
  storyState: StoryState
  choiceHistory: HistoryEntry[]
  seriesTitle: string
  chapterLabel: string
  onSessionUpdate: (state: StoryState, history: HistoryEntry[]) => void
  onNavigate: (chapterId: string) => void
}

function renderTipTap(json: string | null | undefined): string {
  if (!json) return ''
  try {
    return generateHTML(JSON.parse(json), [StarterKit])
  } catch {
    return ''
  }
}

export default function ReaderView({
  sessionId, seriesId, blocks, storyState, choiceHistory, seriesTitle, chapterLabel, onSessionUpdate, onNavigate
}: Props) {
  const router = useRouter()
  const [showHistory, setShowHistory] = useState(false)
  const [pendingChoiceBlock, setPendingChoiceBlock] = useState<Block | null>(null)

  const choiceLabels: Record<string, string> = {}
  const choicePointLocations: Record<string, string> = {}
  blocks.forEach(b => {
    if (b.type === 'choice_point') {
      b.choices.forEach(c => { choiceLabels[c.id] = c.label })
      choicePointLocations[b.id] = chapterLabel
    }
  })

  async function handleChoose(choicePointBlock: Block, choiceId: string) {
    setPendingChoiceBlock(null)
    const res = await fetch(`/api/sessions/${sessionId}/advance`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ choicePointId: choicePointBlock.id, choiceId }),
    })
    if (!res.ok) return
    const updated = await res.json()
    onSessionUpdate(updated.storyState, updated.choiceHistory)

    const choice = choicePointBlock.choices.find(c => c.id === choiceId)
    if (choice?.targetChapterId) onNavigate(choice.targetChapterId)
  }

  async function handleRewind(choicePointId: string) {
    setShowHistory(false)
    const res = await fetch(`/api/sessions/${sessionId}/rewind`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ choicePointId }),
    })
    if (!res.ok) return
    const updated = await res.json()
    onSessionUpdate(updated.storyState, updated.choiceHistory)
  }

  return (
    <div className="min-h-screen bg-surface-base">
      <div className="sticky top-0 bg-surface-base/80 backdrop-blur border-b border-accent/10 px-6 py-3 flex items-center justify-between z-30">
        <span className="text-xs text-ink-faint">{seriesTitle} · {chapterLabel}</span>
        <div className="flex items-center gap-2">
          <button
            onClick={() => setShowHistory(s => !s)}
            className="text-xs px-3 py-1.5 rounded bg-surface-raised border border-accent/20 text-ink-muted hover:text-ink transition"
          >
            ⏮ Choices
          </button>
          <button
            onClick={() => router.push(`/author/${seriesId}`)}
            className="text-xs px-3 py-1.5 rounded bg-surface-raised border border-accent/20 text-ink-muted hover:text-ink transition"
          >
            ✎ Write Mode
          </button>
        </div>
      </div>

      <main className="max-w-xl mx-auto px-6 py-12">
        {(() => {
          let pendingChoice = false
          return blocks.map(block => {
            if (pendingChoice) return null

            if (block.type === 'text') {
              return (
                <div
                  key={block.id}
                  className="prose prose-invert max-w-none mb-6 text-ink leading-relaxed"
                  dangerouslySetInnerHTML={{ __html: renderTipTap(block.content) }}
                />
              )
            }

            if (block.type === 'conditional_fragment') {
              const resolved = resolveConditional(
                {
                  baseContent: block.baseContent ?? '',
                  overrides: block.overrides.map(o => ({
                    id: o.id,
                    order: o.order,
                    condition: JSON.parse(o.condition),
                    content: o.content,
                  })),
                },
                storyState
              )
              return (
                <div
                  key={block.id}
                  className="prose prose-invert max-w-none mb-6 text-ink leading-relaxed"
                  dangerouslySetInnerHTML={{ __html: renderTipTap(resolved) }}
                />
              )
            }

            if (block.type === 'choice_point') {
              const answered = choiceHistory.find(h => h.choicePointId === block.id)

              if (answered) {
                const chosenLabel = block.choices.find(c => c.id === answered.choiceId)?.label ?? '…'
                return (
                  <div key={block.id} className="mb-6 border-t border-accent/10 pt-4">
                    <p className="text-xs uppercase tracking-widest text-ink-faint mb-2">You chose</p>
                    <p className="text-sm text-ink-muted italic">→ {chosenLabel}</p>
                  </div>
                )
              }

              pendingChoice = true

              if (block.displayType === 'chapter_gate') {
                return (
                  <div key={block.id} className="mt-8 text-center">
                    {block.prompt && <p className="text-ink-muted italic mb-4">{block.prompt}</p>}
                    <button
                      onClick={() => setPendingChoiceBlock(block)}
                      className="px-4 py-2 rounded bg-surface-raised border border-accent/20 text-ink-muted text-sm hover:text-ink transition"
                    >
                      End of chapter — make your choice →
                    </button>
                  </div>
                )
              }

              return (
                <div key={block.id} className="mb-6">
                  {block.prompt && <p className="text-ink-muted italic mb-3">{block.prompt}</p>}
                  <InlineChoice choices={block.choices} onChoose={id => handleChoose(block, id)} />
                </div>
              )
            }

            return null
          })
        })()}
      </main>

      {pendingChoiceBlock && (
        <ChapterGate
          choices={pendingChoiceBlock.choices}
          onChoose={id => handleChoose(pendingChoiceBlock, id)}
        />
      )}

      {showHistory && (
        <HistoryPanel
          history={choiceHistory}
          choiceLabels={choiceLabels}
          choicePointLocations={choicePointLocations}
          currentlyChoosing={blocks.some(b => b.type === 'choice_point')}
          onRewind={handleRewind}
          onClose={() => setShowHistory(false)}
        />
      )}
    </div>
  )
}
