'use client'

import { useState, useEffect, useRef } from 'react'
import { useRouter } from 'next/navigation'
import { LuMoon, LuSun, LuArrowLeft, LuArrowRight, LuMusic, LuUser, LuSlidersHorizontal } from 'react-icons/lu'
import { generateHTML } from '@tiptap/html'
import StarterKit from '@tiptap/starter-kit'
import TextAlign from '@tiptap/extension-text-align'
import { TextStyle } from '@tiptap/extension-text-style'
import Color from '@tiptap/extension-color'
import { Footnote } from '@/lib/extensions/footnote'
import { CharacterMark } from '@/lib/extensions/character'
import { resolveConditional, matchesCondition } from '@/lib/storyEngine'
import type { StoryState, HistoryEntry } from '@/lib/storyEngine'
import InlineChoice from './InlineChoice'
import ChapterGate from './ChapterGate'
import ChoiceConfigModal from './ChoiceConfigModal'
import AvatarButton from '@/components/AvatarButton'
import Greeting from '@/components/Greeting'

type Override = { id: string; order: number; condition: string; content: string }
type Choice = { id: string; label: string; setsVariables: string; targetChapterId: string | null }
type Block = {
  id: string; order: number; type: string
  content?: string | null; prompt?: string | null; displayType?: string | null; baseContent?: string | null
  condition?: string | null
  choices: Choice[]
  overrides: Override[]
}
type Character = { id: string; name: string; age: number | null; hasAvatar: boolean }
type BookChapter = { id: string; title: string; order: number }
type Book = { id: string; title: string; order: number; chapters: BookChapter[] }
type Variable = { id: string; name: string; type: string; defaultValue: string }

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
  books?: Book[]
  variables?: Variable[]
  currentChapterId?: string
  onSessionUpdate: (state: StoryState, history: HistoryEntry[]) => void
  onNavigate: (chapterId: string) => void
}

const VAR_PATTERN = /\{\{([a-zA-Z_$][a-zA-Z0-9_$]*)\}\}/g

function escapeHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
}

function renderTipTap(json: string | null | undefined, storyState?: StoryState): string {
  if (!json) return ''
  try {
    const html = generateHTML(JSON.parse(json), [StarterKit, TextAlign.configure({ types: ['paragraph', 'heading'] }), TextStyle, Color, Footnote, CharacterMark])
    // Strip empty paragraphs (TipTap leaves trailing/leading <p></p> or <p><br></p> behind editing)
    const stripped = html.replace(/<p[^>]*>(?:\s|<br\s*\/?>)*<\/p>/g, '')
    // Substitute {{varName}} with storyState value when the variable is known; leave literal otherwise.
    if (!storyState) return stripped
    return stripped.replace(VAR_PATTERN, (match, name) =>
      name in storyState ? escapeHtml(String(storyState[name])) : match
    )
  } catch {
    return ''
  }
}

export default function ReaderView({
  sessionId, seriesId, blocks, storyState, choiceHistory, chapterLabel, chapterPov, chapterDate, returnTo, characters = [], books = [], variables = [], currentChapterId, onSessionUpdate, onNavigate
}: Props) {
  const allChapters = books.flatMap(b => b.chapters)
  const currentIdx = allChapters.findIndex(c => c.id === currentChapterId)
  const prevChapter = currentIdx > 0 ? allChapters[currentIdx - 1] : null
  const nextChapter = currentIdx !== -1 && currentIdx < allChapters.length - 1 ? allChapters[currentIdx + 1] : null
  const router = useRouter()
  const mainRef = useRef<HTMLElement>(null)
  const prevChoiceCountRef = useRef(choiceHistory.length)
  const [pendingChoiceBlock, setPendingChoiceBlock] = useState<Block | null>(null)
  const [lightMode, setLightMode] = useState(() =>
    typeof window !== 'undefined' && localStorage.getItem('loom-light-mode') === 'true'
  )
  const [charCard, setCharCard] = useState<{ character: Character; x: number; y: number; above: boolean } | null>(null)
  const [scrollProgress, setScrollProgress] = useState(0)
  const [choiceMarkers, setChoiceMarkers] = useState<{ id: string; position: number }[]>([])
  const [showConfig, setShowConfig] = useState(false)
  const [isAuthor, setIsAuthor] = useState(false)

  useEffect(() => {
    setIsAuthor((localStorage.getItem('loom-author-name') ?? '').trim() !== '')
  }, [])

  useEffect(() => {
    const el = mainRef.current
    if (!el) return
    function onScroll() {
      const { scrollTop, scrollHeight, clientHeight } = el!
      const max = scrollHeight - clientHeight
      setScrollProgress(max > 0 ? scrollTop / max : 0)
    }
    el.addEventListener('scroll', onScroll, { passive: true })
    return () => el.removeEventListener('scroll', onScroll)
  }, [])

  useEffect(() => {
    if (mainRef.current) mainRef.current.scrollTop = 0
    setScrollProgress(0)
  }, [blocks])

  useEffect(() => {
    const el = mainRef.current
    if (!el) return
    const id = requestAnimationFrame(() => {
      const unanswered = blocks.filter(
        b => b.type === 'choice_point' && !choiceHistory.some(h => h.choicePointId === b.id)
      )
      const markers = unanswered.flatMap(block => {
        const blockEl = document.getElementById(`block-${block.id}`)
        if (!blockEl) return []
        const blockTop = blockEl.getBoundingClientRect().top - el.getBoundingClientRect().top + el.scrollTop
        return [{ id: block.id, position: blockTop / el.scrollHeight }]
      })
      setChoiceMarkers(markers)
    })
    return () => cancelAnimationFrame(id)
  }, [blocks, choiceHistory])

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
        <div className="flex justify-end items-center gap-2 px-0 py-3">
          {isAuthor && (
            <button
              onClick={() => setShowConfig(true)}
              className="px-3 py-1.5 rounded text-xs bg-surface-raised border border-accent/20 text-ink-muted font-medium hover:text-ink hover:border-accent/40 transition"
            >
              <span className="flex items-center gap-1.5"><LuSlidersHorizontal size={13} /> Configure</span>
            </button>
          )}
          <button
            onClick={() => router.push(returnTo ?? `/author/${seriesId}`)}
            className="px-3 py-1.5 rounded text-xs bg-accent text-white font-medium hover:opacity-90 transition"
          >
            <span className="flex items-center gap-1.5"><LuArrowLeft size={13} /> Return</span>
          </button>
        </div>
        {/* Chapter header */}
        <div className="flex flex-col items-center mb-8 pt-6">
          <h1 className="text-3xl font-bold uppercase tracking-wide text-ink mb-1">{chapterLabel}</h1>
          {chapterPov && (
            <p className="text-accent text-base">
              {(() => {
                const povChar = characters.find(c => c.name === chapterPov)
                return povChar
                  ? <span className="character-ref cursor-default" data-character-id={povChar.id}>{chapterPov}</span>
                  : chapterPov
              })()}
            </p>
          )}
        </div>
        <div className="px-8 pb-8">
        {chapterDate && <p className="text-base text-ink-faint mb-2">{chapterDate}</p>}
        {(() => {
          let pendingChoice = false
          return blocks.map(block => {
            if (block.type === 'text') {
              return (
                <div
                  key={block.id}
                  id={`block-${block.id}`}
                  className="prose prose-invert max-w-none text-ink leading-relaxed [&_p]:text-justify [&_p]:indent-8 [&_hr]:border-none [&_hr]:h-px [&_hr]:bg-current [&_hr]:opacity-20 [&_hr]:w-1/3 [&_hr]:mx-auto [&_hr]:my-6"
                  style={pendingChoice ? { filter: 'blur(5px)', pointerEvents: 'none', userSelect: 'none' } : undefined}
                  dangerouslySetInnerHTML={{ __html: renderTipTap(block.content, storyState) }}
                />
              )
            }

            if (pendingChoice) return null

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
                  dangerouslySetInnerHTML={{ __html: renderTipTap(resolved, storyState) }}
                />
              )
            }

            if (block.type === 'choice_point') {
              const answered = choiceHistory.find(h => h.choicePointId === block.id)

              if (answered) return null

              if (block.condition) {
                const parsed = JSON.parse(block.condition) as Record<string, boolean | number | string>
                if (!matchesCondition(parsed, storyState)) return null
              }

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
                <div key={block.id} id={`block-${block.id}`} className="mt-6 mb-6">
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
        </div>
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

      {showConfig && (
        <ChoiceConfigModal
          seriesId={seriesId}
          sessionId={sessionId}
          choiceHistory={choiceHistory}
          variables={variables}
          onApply={(state, history) => {
            onSessionUpdate(state, history)
            setShowConfig(false)
            if (currentChapterId) onNavigate(currentChapterId)
          }}
          onClose={() => setShowConfig(false)}
        />
      )}

      {(prevChapter || nextChapter) && (
        <footer className="shrink-0 bg-surface-raised border-t border-accent/10 px-4 py-3 flex items-center gap-4 z-20">
          {prevChapter ? (
            <button
              onClick={() => onNavigate(prevChapter.id)}
              className="shrink-0 flex items-center gap-1.5 text-xs text-ink-muted hover:text-ink transition"
            >
              <LuArrowLeft size={13} /> {prevChapter.title}
            </button>
          ) : <div />}
          <div className="flex-1 relative h-1 bg-surface-muted rounded-full">
            <div
              className="h-full bg-accent/60 rounded-full transition-[width] duration-75"
              style={{ width: `${scrollProgress * 100}%` }}
            />
            {choiceMarkers.map(marker => (
              <div
                key={marker.id}
                className="absolute top-1/2 w-2.5 h-2.5 rounded-full bg-accent border-2 border-surface-raised"
                style={{ left: `${marker.position * 100}%`, transform: 'translate(-50%, -50%)', zIndex: 1 }}
              />
            ))}
          </div>
          {nextChapter ? (
            <button
              onClick={() => onNavigate(nextChapter.id)}
              className={`shrink-0 flex items-center gap-1.5 text-xs transition ${scrollProgress >= 0.99 ? 'text-white font-medium' : 'text-ink-muted hover:text-ink'}`}
            >
              {nextChapter.title} <LuArrowRight size={13} />
            </button>
          ) : <div />}
        </footer>
      )}

    </div>
  )
}
