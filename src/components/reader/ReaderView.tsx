'use client'

import { useState, useEffect, useRef } from 'react'
import { useRouter } from 'next/navigation'
import { LuMoon, LuSun, LuArrowLeft, LuMusic, LuUser } from 'react-icons/lu'
import { generateHTML } from '@tiptap/html'
import StarterKit from '@tiptap/starter-kit'
import TextAlign from '@tiptap/extension-text-align'
import { TextStyle } from '@tiptap/extension-text-style'
import Color from '@tiptap/extension-color'
import { Footnote } from '@/lib/extensions/footnote'
import { CharacterMark } from '@/lib/extensions/character'
import { resolveConditional } from '@/lib/storyEngine'
import type { StoryState, HistoryEntry } from '@/lib/storyEngine'
import InlineChoice from './InlineChoice'
import ChapterGate from './ChapterGate'
import AvatarButton from '@/components/AvatarButton'
import Greeting from '@/components/Greeting'

type Override = { id: string; order: number; condition: string; content: string }
type Choice = { id: string; label: string; setsVariables: string; targetChapterId: string | null }
type Block = {
  id: string; order: number; type: string
  content?: string | null; prompt?: string | null; displayType?: string | null; baseContent?: string | null
  choices: Choice[]
  overrides: Override[]
}
type Character = { id: string; name: string; age: number | null; hasAvatar: boolean }

type Props = {
  sessionId: string
  seriesId: string
  blocks: Block[]
  storyState: StoryState
  choiceHistory: HistoryEntry[]
  seriesTitle: string
  chapterLabel: string
  chapterPov?: string | null
  chapterDate?: string | null
  returnTo?: string
  characters?: Character[]
  onSessionUpdate: (state: StoryState, history: HistoryEntry[]) => void
  onNavigate: (chapterId: string) => void
}

function renderTipTap(json: string | null | undefined): string {
  if (!json) return ''
  try {
    return generateHTML(JSON.parse(json), [StarterKit, TextAlign.configure({ types: ['paragraph', 'heading'] }), TextStyle, Color, Footnote, CharacterMark])
  } catch {
    return ''
  }
}

export default function ReaderView({
  sessionId, seriesId, blocks, storyState, choiceHistory, seriesTitle, chapterLabel, chapterPov, chapterDate, returnTo, characters = [], onSessionUpdate, onNavigate
}: Props) {
  const router = useRouter()
  const mainRef = useRef<HTMLElement>(null)
  const prevChoiceCountRef = useRef(choiceHistory.length)
  const [pendingChoiceBlock, setPendingChoiceBlock] = useState<Block | null>(null)
  const [lightMode, setLightMode] = useState(() =>
    typeof window !== 'undefined' && localStorage.getItem('loom-light-mode') === 'true'
  )
  const [charCard, setCharCard] = useState<{ character: Character; x: number; y: number; above: boolean } | null>(null)

  useEffect(() => {
    if (choiceHistory.length <= prevChoiceCountRef.current) {
      prevChoiceCountRef.current = choiceHistory.length
      return
    }
    prevChoiceCountRef.current = choiceHistory.length

    const lastEntry = choiceHistory[choiceHistory.length - 1]
    if (!lastEntry) return
    const choiceIdx = blocks.findIndex(b => b.id === lastEntry.choicePointId)
    const nextBlock = blocks[choiceIdx + 1]
    if (!nextBlock) return

    const el = document.getElementById(`block-${nextBlock.id}`)
    const container = mainRef.current
    if (!el || !container) return
    const offset = el.getBoundingClientRect().top - container.getBoundingClientRect().top
    container.scrollBy({ top: offset - 16, behavior: 'smooth' })
  }, [choiceHistory, blocks])

  function toggleLightMode() {
    setLightMode(m => {
      const next = !m
      localStorage.setItem('loom-light-mode', String(next))
      return next
    })
  }

  useEffect(() => {
    if (characters.length === 0) return
    function onOver(e: MouseEvent) {
      const span = (e.target as Element).closest<HTMLElement>('.character-ref')
      if (!span) { setCharCard(null); return }
      const id = span.dataset.characterId
      const character = characters.find(c => c.id === id)
      if (!character) { setCharCard(null); return }
      const rect = span.getBoundingClientRect()
      const cardW = 300
      const margin = 12
      const rawX = rect.left + rect.width / 2
      const x = Math.min(Math.max(rawX, cardW / 2 + margin), window.innerWidth - cardW / 2 - margin)
      const above = rect.top > 140
      setCharCard({ character, x, y: above ? rect.top : rect.bottom, above })
    }
    document.addEventListener('mouseover', onOver)
    return () => document.removeEventListener('mouseover', onOver)
  }, [characters])

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

  return (
    <div className="h-screen bg-surface-base flex flex-col overflow-hidden">
      <nav className="bg-surface-raised border-b border-accent/10 px-6 py-3 flex items-center justify-between z-30">
        <div className="flex items-center gap-2">
          <img src="/loom-logo.svg" alt="" className="block h-9 w-9" />
          <span className="text-accent font-bold tracking-wider text-2xl leading-none">LOOM</span>
        </div>
        <div className="flex items-center gap-2">
          <Greeting />
          <button
            role="switch"
            aria-checked={lightMode}
            onClick={toggleLightMode}
            title={lightMode ? 'Switch to dark mode' : 'Switch to light mode'}
            className="flex items-center gap-1.5 text-ink-faint hover:text-ink transition"
          >
            <LuMoon size={13} />
            <span className={`relative inline-flex w-9 h-5 rounded-full transition-colors duration-200 ${lightMode ? 'bg-accent' : 'bg-surface-muted'}`}>
              <span className={`absolute top-0.5 w-4 h-4 rounded-full bg-white shadow transition-all duration-200 ${lightMode ? 'left-4' : 'left-0.5'}`} />
            </span>
            <LuSun size={13} />
          </button>
          <AvatarButton />
        </div>
      </nav>

      <main ref={mainRef} className={`flex-1 overflow-y-auto px-8${lightMode ? ' light-body' : ''}`}>
        {/* Sticky action row */}
        <div className="sticky top-0 z-10 flex justify-end items-center px-0 py-3">
          <button
            onClick={() => router.push(returnTo ?? `/author/${seriesId}`)}
            className="px-3 py-1.5 rounded text-xs bg-accent text-white font-medium hover:opacity-90 transition"
          >
            <span className="flex items-center gap-1.5"><LuArrowLeft size={13} /> Go Back To Writing</span>
          </button>
        </div>
        {/* Chapter header */}
        <div className="flex flex-col items-center mb-8 pt-6">
          <h1 className="text-3xl font-bold uppercase tracking-wide text-ink mb-1">{chapterLabel}</h1>
          {chapterPov && <p className="text-accent text-base">{chapterPov}</p>}
        </div>
        {chapterDate && <p className="text-base text-ink-faint mb-2">{chapterDate}</p>}
        {(() => {
          let pendingChoice = false
          return blocks.map(block => {
            if (pendingChoice) return null

            if (block.type === 'text') {
              return (
                <div
                  key={block.id}
                  id={`block-${block.id}`}
                  className="prose prose-invert max-w-none mb-6 text-ink leading-relaxed [&_p]:text-justify [&_p]:indent-8 [&_hr]:border-none [&_hr]:h-px [&_hr]:bg-current [&_hr]:opacity-20 [&_hr]:w-1/3 [&_hr]:mx-auto [&_hr]:my-6"
                  dangerouslySetInnerHTML={{ __html: renderTipTap(block.content) }}
                />
              )
            }

            if (block.type === 'conditional_fragment') {
              const resolved = resolveConditional(
                {
                  overrides: block.overrides.map(o => ({
                    id: o.id,
                    order: o.order,
                    condition: JSON.parse(o.condition),
                    content: o.content,
                  })),
                },
                storyState
              )
              if (!resolved) return null
              return (
                <div
                  key={block.id}
                  id={`block-${block.id}`}
                  className="prose prose-invert max-w-none text-ink leading-relaxed [&_p]:text-justify [&_p]:indent-8 [&_hr]:border-none [&_hr]:h-px [&_hr]:bg-current [&_hr]:opacity-20 [&_hr]:w-1/3 [&_hr]:mx-auto [&_hr]:my-6"
                  dangerouslySetInnerHTML={{ __html: renderTipTap(resolved) }}
                />
              )
            }

            if (block.type === 'choice_point') {
              const answered = choiceHistory.find(h => h.choicePointId === block.id)

              if (answered) return null

              pendingChoice = true

              if (block.displayType === 'chapter_gate') {
                return (
                  <div key={block.id} id={`block-${block.id}`} className="mt-8 text-center">
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
                <div key={block.id} id={`block-${block.id}`} className="mb-6">
                  <InlineChoice prompt={block.prompt ?? null} choices={block.choices} onChoose={id => handleChoose(block, id)} />
                </div>
              )
            }

            if (block.type === 'soundtrack' && block.content) {
              return (
                <div key={block.id} id={`block-${block.id}`} className="my-4 flex items-center gap-3 px-4 py-3 rounded-lg bg-surface-raised border border-accent/10">
                  <LuMusic size={14} className="text-accent shrink-0" />
                  {block.prompt && <span className="text-xs text-ink-faint italic truncate">{block.prompt}</span>}
                  <audio controls src={block.content} className="flex-1 h-8 min-w-0" />
                </div>
              )
            }

            return null
          })
        })()}
      </main>

      {/* Character hover card */}
      {charCard && (
        <div
          className="pointer-events-none fixed z-50 rounded-xl shadow-2xl p-4 flex items-center gap-4"
          style={{
            left: charCard.x,
            top: charCard.above ? charCard.y - 8 : charCard.y + 8,
            transform: charCard.above ? 'translate(-50%, -100%)' : 'translate(-50%, 0)',
            background: lightMode ? '#ffffff' : '#1a1a2e',
            border: lightMode ? '1px solid #d4d0c8' : '1px solid rgba(136,136,255,0.25)',
            whiteSpace: 'nowrap',
          }}
        >
          <div
            className="rounded-full overflow-hidden flex items-center justify-center shrink-0"
            style={{ width: 64, height: 64, border: lightMode ? '2px solid #d4d0c8' : '2px solid rgba(136,136,255,0.3)', background: lightMode ? '#ede9e0' : '#12121e' }}
          >
            {charCard.character.hasAvatar
              ? <img src={`/characters/${charCard.character.id}.jpg`} alt={charCard.character.name} className="w-full h-full object-cover" />
              : <LuUser size={28} style={{ color: lightMode ? '#888' : '#666' }} />
            }
          </div>
          <div>
            <p className="text-sm font-semibold" style={{ color: lightMode ? '#1a1a2a' : '#e0d9c8' }}>{charCard.character.name}</p>
            {charCard.character.age != null && <p className="text-xs mt-0.5" style={{ color: lightMode ? '#666' : '#aaa' }}>Age {charCard.character.age}</p>}
          </div>
        </div>
      )}

      {pendingChoiceBlock && (
        <ChapterGate
          prompt={pendingChoiceBlock.prompt ?? null}
          choices={pendingChoiceBlock.choices}
          onChoose={id => handleChoose(pendingChoiceBlock, id)}
        />
      )}


    </div>
  )
}
