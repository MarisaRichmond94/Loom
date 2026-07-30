'use client'

import { useState, useEffect, useMemo, useRef, memo, type CSSProperties } from 'react'
import { useRouter } from 'next/navigation'
import { LuArrowLeft, LuArrowRight, LuMusic, LuUser, LuSlidersHorizontal, LuCopy, LuCheck } from 'react-icons/lu'
import { generateHTML } from '@tiptap/html'
import StarterKit from '@tiptap/starter-kit'
import TextAlign from '@tiptap/extension-text-align'
import { TextStyle } from '@tiptap/extension-text-style'
import Color from '@tiptap/extension-color'
import { Footnote } from '@/lib/extensions/footnote'
import { CharacterMark } from '@/lib/extensions/character'
import { resolveConditionalOverride, matchesCondition, applyChoice } from '@/lib/storyEngine'
import { substituteVarTemplates } from '@/lib/templateVars'
import { tryRenderRichContent } from '@/lib/renderRichContent'
import { pinLabel } from '@/lib/pinLabel'
import type { ChapterLabel } from '@/lib/chapterLabels'
import type { StoryState, HistoryEntry } from '@/lib/storyEngine'
import dynamic from 'next/dynamic'
import InlineChoice from './InlineChoice'
import ChapterGate from './ChapterGate'
import InlineBadEnding from './InlineBadEnding'

// Both only mount on rare events (Configure click / a bad-ending choice) —
// load their chunks then instead of with every reader page.
const ChoiceConfigModal = dynamic(() => import('./ChoiceConfigModal'), { ssr: false })
const BadEndingModal = dynamic(() => import('./BadEndingModal'), { ssr: false })
import AppHeader from '@/components/AppHeader'
import { useLightMode } from '@/lib/useLightMode'
import PinnedAudio from '@/components/PinnedAudio'
import NarrationBar from './NarrationBar'
import { stripEmptyParagraphs, htmlToPlainText, inlineParagraphStyles, educateHtml, educateQuotes, PASTE_FONT_FAMILY } from '@/lib/clipboardFormatting'

type Override = { id: string; order: number; condition: string; content: string; endingMessage?: string | null; endsChapter?: boolean }
type Choice = { id: string; order: number; label: string; setsVariables: string; targetChapterId: string | null; endingMessage?: string | null; isBadEnding?: boolean; endsChapter?: boolean; condition?: string | null }
type Block = {
  id: string; order: number; type: string
  content?: string | null; prompt?: string | null; displayType?: string | null; baseContent?: string | null
  condition?: string | null
  pinStart?: number | null
  pinEnd?: number | null
  hasAlbumArt?: boolean
  choices: Choice[]
  overrides: Override[]
}
type Character = {
  id: string; name: string; age: number | null
  hasAvatar: boolean
  hasBookAvatar?: boolean
  hasCanonicalAvatar?: boolean
  deceased?: boolean
}
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
  currentBookId?: string | null
  books?: Book[]
  variables?: Variable[]
  chapterLabels?: Record<string, ChapterLabel>
  currentChapterId?: string
  // When true, any block that isn't a plain text block (conditional
  // fragment content, choice branch text, override endings) is wrapped
  // in a left-stripe highlight so the writer can see at a glance which
  // prose is dynamic. Toggled from the Configure modal.
  highlightConditionals: boolean
  onHighlightConditionalsChange: (next: boolean) => void
  onSessionUpdate: (state: StoryState, history: HistoryEntry[]) => void
  onNavigate: (chapterId: string) => void
}

// A rendered prose block. Memoized so that a ReaderView re-render for an
// unrelated reason (hovering a character card, copy-button state, …) does NOT
// reconcile the block's dangerouslySetInnerHTML — otherwise React would rebuild
// the block's DOM and wipe the word-highlight spans that NarrationBar wraps into
// it imperatively (which never get re-added on a hover, so the read-mode
// highlight would vanish until the chapter reloads). Re-renders only when the
// html/class/style actually change (e.g. a choice unlocks/reveals new prose).
const ProseBlock = memo(function ProseBlock({
  blockId,
  className,
  style,
  html,
}: {
  blockId: string
  className: string
  style?: CSSProperties
  html: string
}) {
  return (
    <div
      id={`block-${blockId}`}
      className={className}
      style={style}
      dangerouslySetInnerHTML={{ __html: html }}
    />
  )
})

// Which options a choice point actually shows the reader. The two base
// options (order 0/1) always render — that's the guarantee that a choice
// point is never empty. Extras (order >= 2) render only when their gate
// matches the current story state; an ungated or malformed-condition extra
// is treated as always-visible.
function visibleChoices(choices: Choice[], storyState: StoryState): Choice[] {
  return [...choices]
    .sort((a, b) => a.order - b.order)
    .filter(c => {
      if (c.order < 2) return true
      if (!c.condition) return true
      try { return matchesCondition(JSON.parse(c.condition), storyState) }
      catch { return true }
    })
}

function escapeHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
}

// Built once at module load — generateHTML instantiates a ProseMirror schema
// from this list on every call, so the array itself must not be rebuilt per
// block per render.
const RENDER_EXTENSIONS = [StarterKit, TextAlign.configure({ types: ['paragraph', 'heading'] }), TextStyle, Color, Footnote, CharacterMark]

function renderTipTap(json: string | null | undefined, storyState?: StoryState): string {
  if (!json) return ''
  try {
    const html = generateHTML(JSON.parse(json), RENDER_EXTENSIONS)
    const stripped = stripEmptyParagraphs(html)
    if (!storyState) return stripped
    return substituteVarTemplates(stripped, storyState, escapeHtml)
  } catch {
    return ''
  }
}

export default function ReaderView({
  sessionId, seriesId, blocks, storyState, choiceHistory, chapterLabel, chapterPov, chapterDate, returnTo, characters = [], currentBookId, books = [], variables = [], chapterLabels = {}, currentChapterId, highlightConditionals, onHighlightConditionalsChange, onSessionUpdate, onNavigate
}: Props) {
  // Only visible chapters participate in prev/next navigation.
  const allChapters = books
    .flatMap(b => b.chapters)
    .filter(c => chapterLabels[c.id]?.visible ?? true)
  const currentIdx = allChapters.findIndex(c => c.id === currentChapterId)
  const prevChapter = currentIdx > 0 ? allChapters[currentIdx - 1] : null
  const nextChapter = currentIdx !== -1 && currentIdx < allChapters.length - 1 ? allChapters[currentIdx + 1] : null

  // Tailwind classes applied to any non-plain-text rendered prose when the
  // writer turns on Color-code conditional text in the Configure modal.
  // A left accent stripe + soft tint frames each dynamic block without
  // changing the prose typography itself (negative left padding pulls the
  // stripe outside the column so the indent of the first line is undisturbed).
  const HIGHLIGHT_CLASSES = highlightConditionals
    ? 'border-l-2 border-accent/50 bg-accent/5 pl-3 -ml-3 rounded-r'
    : ''
  const router = useRouter()
  const mainRef = useRef<HTMLElement>(null)
  const [pendingChoiceBlock, setPendingChoiceBlock] = useState<Block | null>(null)
  const { lightMode, toggleLightMode } = useLightMode()
  const [charCard, setCharCard] = useState<{ character: Character; x: number; y: number; above: boolean } | null>(null)
  // Scroll progress is written straight to the DOM (bar width) instead of
  // React state — a per-scroll-event setState re-rendered the whole chapter.
  // Only the coarse "reached the end" flag stays in state, for the
  // next-chapter button styling; setAtEnd with an unchanged value is a
  // no-op re-render-wise.
  const scrollProgressRef = useRef(0)
  const progressFillRef = useRef<HTMLDivElement>(null)
  const [atEnd, setAtEnd] = useState(false)
  const [choiceMarkers, setChoiceMarkers] = useState<{ id: string; position: number }[]>([])
  const [showConfig, setShowConfig] = useState(false)
  const [isAuthor, setIsAuthor] = useState(false)
  const [endingMessage, setEndingMessage] = useState<string | null>(null)
  const pendingScrollBlockRef = useRef<string | null>(null)
  const prevHistoryLengthRef = useRef(choiceHistory.length)
  const [copyState, setCopyState] = useState<'idle' | 'copied'>('idle')

  // Belt-and-suspenders modal dismissal. The modal's onApply already calls
  // setEndingMessage(null), but if anything in the React batch happens to
  // delay or swallow that update, the rewound choiceHistory still lets us
  // detect the rewind and force-close: choiceHistory only shrinks via the
  // rewind PATCH in useBadEndingRewind, so a shorter history while the
  // modal is open means the user just rewound.
  useEffect(() => {
    if (endingMessage != null && choiceHistory.length < prevHistoryLengthRef.current) {
      setEndingMessage(null)
    }
    prevHistoryLengthRef.current = choiceHistory.length
  }, [choiceHistory, endingMessage])

  useEffect(() => {
    setIsAuthor((localStorage.getItem('loom-author-name') ?? '').trim() !== '')
  }, [])

  function applyScrollProgress(p: number) {
    scrollProgressRef.current = p
    if (progressFillRef.current) progressFillRef.current.style.width = `${p * 100}%`
    setAtEnd(p >= 0.99)
  }

  useEffect(() => {
    const el = mainRef.current
    if (!el) return
    function onScroll() {
      const { scrollTop, scrollHeight, clientHeight } = el!
      const max = scrollHeight - clientHeight
      applyScrollProgress(max > 0 ? scrollTop / max : 0)
    }
    el.addEventListener('scroll', onScroll, { passive: true })
    return () => el.removeEventListener('scroll', onScroll)
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  useEffect(() => {
    const el = mainRef.current
    if (!el) return
    if (pendingScrollBlockRef.current) {
      const target = pendingScrollBlockRef.current
      pendingScrollBlockRef.current = null
      const raf = requestAnimationFrame(() => {
        const blockEl = document.getElementById(`block-${target}`)
        if (blockEl) blockEl.scrollIntoView({ block: 'start' })
        else { el.scrollTop = 0; applyScrollProgress(0) }
      })
      return () => cancelAnimationFrame(raf)
    }
    el.scrollTop = 0
    applyScrollProgress(0)
  // eslint-disable-next-line react-hooks/exhaustive-deps
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
      // Recompute progress fill: choice expansion / collapse changes scrollHeight,
      // so the cached ratio from the onScroll listener is stale until the user scrolls.
      const max = el.scrollHeight - el.clientHeight
      applyScrollProgress(max > 0 ? el.scrollTop / max : 0)
    })
    return () => cancelAnimationFrame(id)
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [blocks, choiceHistory])

  // Auto-scroll after a choice answer was jumpy in practice — the block
  // expansion shifted the content under the scroll mid-animation, which
  // made the reveal feel disorienting. Choices now just reveal the next
  // text in place; the reader scrolls themselves when ready.


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

  // All prose HTML and condition evaluation happens here, once per
  // (blocks, storyState, choiceHistory) change — never inside the render
  // loop. renderTipTap parses JSON and runs generateHTML per call, which is
  // far too expensive to repeat on every hover/scroll-driven re-render.
  const renderedBlocks = useMemo(() => {
    const map = new Map<string, {
      html?: string
      matched?: ReturnType<typeof resolveConditionalOverride>
      conditionOk?: boolean
      branchHtml?: string | null
    }>()
    for (const block of blocks) {
      if (block.type === 'text') {
        map.set(block.id, { html: renderTipTap(block.content, storyState) })
      } else if (block.type === 'conditional_fragment') {
        const matched = resolveConditionalOverride(
          {
            overrides: block.overrides.map(o => ({
              id: o.id,
              order: o.order,
              condition: JSON.parse(o.condition),
              content: o.content,
              endingMessage: o.endingMessage ?? null,
              endsChapter: o.endsChapter ?? false,
            })),
          },
          storyState
        )
        map.set(block.id, { matched, html: matched ? renderTipTap(matched.content, storyState) : '' })
      } else if (block.type === 'choice_point') {
        let conditionOk = true
        if (block.condition) {
          try {
            conditionOk = matchesCondition(JSON.parse(block.condition), storyState)
          } catch { /* malformed condition: treat as visible */ }
        }
        const answered = choiceHistory.find(h => h.choicePointId === block.id)
        const chosen = answered ? block.choices.find(c => c.id === answered.choiceId) : undefined
        const branchHtml = chosen?.endingMessage && !chosen.isBadEnding
          ? tryRenderRichContent(chosen.endingMessage, storyState)
          : null
        map.set(block.id, { conditionOk, branchHtml })
      } else if (block.type === 'soundtrack') {
        let conditionOk = true
        if (block.condition) {
          try {
            conditionOk = matchesCondition(JSON.parse(block.condition), storyState)
          } catch { /* malformed condition: ignore and play */ }
        }
        map.set(block.id, { conditionOk })
      }
    }
    return map
  }, [blocks, storyState, choiceHistory])

  // choicePointId -> chosen choiceId, for the narration bar so it can narrate
  // past choices the reader has already answered (and only up to the next
  // unanswered one).
  const answeredChoices = useMemo(
    () => Object.fromEntries(choiceHistory.map(h => [h.choicePointId, h.choiceId])),
    [choiceHistory],
  )

  // For each in-chapter branch of the next pending choice, the (state, answered)
  // it would produce — handed to the narration bar to pre-generate so answering
  // resumes instantly. Mirrors handleChoose's applyChoice, so the pre-warmed
  // variant is the exact one the answer will request.
  const narrationPrewarm = useMemo(() => {
    const pending = blocks.find(b => {
      if (b.type !== 'choice_point') return false
      if (choiceHistory.some(h => h.choicePointId === b.id)) return false
      if (!b.condition) return true
      try { return matchesCondition(JSON.parse(b.condition), storyState) } catch { return true }
    })
    if (!pending) return []
    const out: { storyState: StoryState; answered: Record<string, string> }[] = []
    for (const choice of visibleChoices(pending.choices, storyState)) {
      // Options that jump to another chapter don't unlock in-chapter prose.
      if (choice.targetChapterId) continue
      let setsVariables: Record<string, unknown> = {}
      try { setsVariables = JSON.parse(choice.setsVariables || '{}') } catch { /* treat as no-op */ }
      const { newState } = applyChoice(storyState, choiceHistory, pending.id, {
        id: choice.id,
        setsVariables: setsVariables as Parameters<typeof applyChoice>[3]['setsVariables'],
        targetChapterId: choice.targetChapterId ?? null,
      })
      out.push({ storyState: newState, answered: { ...answeredChoices, [pending.id]: choice.id } })
    }
    return out
  }, [blocks, choiceHistory, storyState, answeredChoices])

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
    // The modal fires only when the writer explicitly marked the choice
    // as a bad ending. A non-bad-ending choice with branch text just
    // renders inline; nav to the target chapter still happens.
    if (choice?.isBadEnding && choice?.endingMessage) {
      setEndingMessage(choice.endingMessage)
      return
    }
    if (choice?.targetChapterId) onNavigate(choice.targetChapterId)
  }

  // Builds an HTML + plain-text copy of the chapter's prose for the clipboard.
  // Writes both formats via ClipboardItem so apps that accept rich text
  // (Google Docs, Word, Notion) keep paragraphs and italics, while plain-text
  // destinations still get a readable fallback. Stops at the first visible,
  // unanswered choice so blurred ahead-content can't leak.
  async function copyChapter() {
    const htmlParts: string[] = []
    const textParts: string[] = []
    for (const block of blocks) {
      let html: string | null = null
      if (block.type === 'text') {
        html = renderTipTap(block.content, storyState)
      } else if (block.type === 'conditional_fragment') {
        const matched = resolveConditionalOverride(
          {
            overrides: block.overrides.map(o => ({
              id: o.id,
              order: o.order,
              condition: JSON.parse(o.condition),
              content: o.content,
              endingMessage: o.endingMessage ?? null,
              endsChapter: o.endsChapter ?? false,
            })),
          },
          storyState,
        )
        if (matched) {
          html = renderTipTap(matched.content, storyState)
          // Bad-ending override: copy its prose (the death scene IS the
          // ending), then stop — everything after is hidden in the chapter.
          if (matched.endingMessage != null) {
            if (html) { htmlParts.push(html); textParts.push(htmlToPlainText(html)) }
            break
          }
          // Clean "ends chapter" override: copy its prose, then stop — later
          // blocks are hidden in the chapter, mirroring the on-page render.
          if (matched.endsChapter) {
            if (html) { htmlParts.push(html); textParts.push(htmlToPlainText(html)) }
            break
          }
        }
      } else if (block.type === 'choice_point') {
        const answered = choiceHistory.find(h => h.choicePointId === block.id)
        if (answered) {
          // Mirror the on-page render: an answered non-bad-ending choice
          // shows its branch prose inline at the choice's position
          // (see the render loop), so copy that same prose. Bad endings
          // aren't repeated inline, so they contribute nothing here.
          const chosen = block.choices.find(c => c.id === answered.choiceId)
          if (chosen?.endingMessage && !chosen.isBadEnding) {
            html = renderedBlocks.get(block.id)?.branchHtml
              // Fallback matches the display's legacy plain-text path:
              // wrap the raw message in a paragraph.
              ?? `<p>${escapeHtml(chosen.endingMessage)}</p>`
          }
          if (html) { htmlParts.push(html); textParts.push(htmlToPlainText(html)) }
          // A clean "ends chapter" branch stops the copy here — later blocks
          // are hidden in the chapter, mirroring the on-page render.
          if (chosen?.endsChapter && !chosen.isBadEnding) break
          continue
        }
        if (block.condition) {
          try {
            const parsed = JSON.parse(block.condition)
            if (!matchesCondition(parsed, storyState)) continue
          } catch { /* fall through and stop */ }
        }
        break
      }
      if (html) {
        htmlParts.push(html)
        textParts.push(htmlToPlainText(html))
      }
    }
    // Concatenate without inter-block whitespace; inline paragraph styles so
    // pasted output keeps first-line indent and tight paragraph spacing.
    // Wrap in a font-styled container so the destination picks up Charter 11pt
    // via inheritance instead of falling back to its default body font.
    const inner = htmlParts.map(inlineParagraphStyles).join('')
    // Educate straight quotes/apostrophes to their curly equivalents
    // so a pasted manuscript reads like prose, not source code.
    const htmlOut = educateHtml(`<div style="font-family:${PASTE_FONT_FAMILY}">${inner}</div>`)
    const textOut = educateQuotes(textParts.filter(Boolean).join('\n\n'))
    try {
      if (typeof ClipboardItem !== 'undefined' && navigator.clipboard?.write) {
        await navigator.clipboard.write([
          new ClipboardItem({
            'text/html': new Blob([htmlOut], { type: 'text/html' }),
            'text/plain': new Blob([textOut], { type: 'text/plain' }),
          }),
        ])
      } else {
        await navigator.clipboard.writeText(textOut)
      }
      setCopyState('copied')
      setTimeout(() => setCopyState('idle'), 1500)
    } catch { /* clipboard unavailable; silently ignore */ }
  }

  return (
    <div className="h-screen bg-surface-base flex flex-col overflow-hidden">
      <AppHeader lightMode={lightMode} onToggleLightMode={toggleLightMode} />

      <main ref={mainRef} className={`flex-1 overflow-y-auto px-8${lightMode ? ' light-body' : ''}`}>
        {/* Sticky action row */}
        <div className="flex justify-end items-center gap-2 pr-6 py-3">
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
        <NarrationBar chapterId={currentChapterId ?? null} scrollRef={mainRef} storyState={storyState} answered={answeredChoices} prewarm={narrationPrewarm} />
        <div className={`pb-8 pr-6${isAuthor ? ' reader-selectable' : ''}`}>
        {chapterDate && <p className="text-base text-ink-faint mb-2">{chapterDate}</p>}
        {(() => {
          let pendingChoice = false
          let hitBadEnding = false
          // A matched "ends chapter" conditional or answered "ends chapter"
          // choice cleanly closes the chapter early: like hitBadEnding, every
          // block after it is hidden — but there's no death overlay, and the
          // reader advances with the normal chapter footer.
          let chapterEnded = false
          const elements = blocks.map(block => {
            // A conditional bad-ending earlier in the chapter ends the run;
            // every block after it is hidden (not blurred — the story is over).
            if (hitBadEnding || chapterEnded) return null

            if (block.type === 'text') {
              return (
                <ProseBlock
                  key={block.id}
                  blockId={block.id}
                  className="prose prose-invert max-w-none text-ink leading-relaxed [&_p]:text-justify [&_p]:indent-8 [&_p.no-indent]:indent-0 [&_p[style*='center']]:indent-0 [&_p:empty]:min-h-[1em] [&_hr]:border-none [&_hr]:h-px [&_hr]:bg-current [&_hr]:opacity-20 [&_hr]:w-1/3 [&_hr]:mx-auto [&_hr]:my-6"
                  style={pendingChoice ? { filter: 'blur(5px)', pointerEvents: 'none', userSelect: 'none' } : undefined}
                  html={renderedBlocks.get(block.id)?.html ?? ''}
                />
              )
            }

            if (pendingChoice) return null

            if (block.type === 'conditional_fragment') {
              const matched = renderedBlocks.get(block.id)?.matched
              if (!matched) return null
              // Render the override's prose either way — for bad endings the
              // prose IS the death scene. Flip hitBadEnding so the rest of
              // the chapter (and the InlineBadEnding controls below) take over.
              if (matched.endingMessage != null) hitBadEnding = true
              // A clean "ends chapter" override closes the chapter after its
              // prose — no overlay, the reader continues via the footer.
              else if (matched.endsChapter) chapterEnded = true
              return (
                <ProseBlock
                  key={block.id}
                  blockId={block.id}
                  className={`prose prose-invert max-w-none text-ink leading-relaxed [&_p]:text-justify [&_p]:indent-8 [&_p.no-indent]:indent-0 [&_p[style*='center']]:indent-0 [&_p:empty]:min-h-[1em] [&_hr]:border-none [&_hr]:h-px [&_hr]:bg-current [&_hr]:opacity-20 [&_hr]:w-1/3 [&_hr]:mx-auto [&_hr]:my-6 ${HIGHLIGHT_CLASSES}`}
                  html={renderedBlocks.get(block.id)?.html ?? ''}
                />
              )
            }

            if (block.type === 'choice_point') {
              const answered = choiceHistory.find(h => h.choicePointId === block.id)

              if (answered) {
                // After answering, if the chosen branch carries inline
                // text (non-bad-ending), render it as styled prose at
                // the choice's position. Bad endings flow through the
                // full-screen modal in handleChoose above and aren't
                // repeated inline. Branch text is TipTap JSON in new
                // data; tryRenderRichContent falls back to wrapping
                // legacy plain text in a paragraph.
                const chosen = block.choices.find(c => c.id === answered.choiceId)
                // A clean "ends chapter" branch closes the chapter after this
                // point: its inline consequence prose (if any) still renders
                // below, but every later block is hidden and the reader
                // advances via the footer. Bad endings take the modal path and
                // never set this.
                if (chosen?.endsChapter && !chosen?.isBadEnding) chapterEnded = true
                if (chosen?.endingMessage && !chosen?.isBadEnding) {
                  const rich = renderedBlocks.get(block.id)?.branchHtml ?? null
                  const branchClass = `prose prose-invert max-w-none text-ink leading-relaxed [&_p]:text-justify [&_p]:indent-8 [&_p.no-indent]:indent-0 [&_p[style*='center']]:indent-0 [&_p:empty]:min-h-[1em] [&_hr]:border-none [&_hr]:h-px [&_hr]:bg-current [&_hr]:opacity-20 [&_hr]:w-1/3 [&_hr]:mx-auto [&_hr]:my-6 ${HIGHLIGHT_CLASSES}`
                  // rich: rendered HTML → show it; null → legacy plain text,
                  // wrap verbatim; '' → rich JSON that rendered to nothing
                  // (e.g. an empty placeholder), render nothing rather than
                  // dumping the raw doc JSON.
                  if (rich) {
                    return <ProseBlock key={block.id} blockId={block.id} className={branchClass} html={rich} />
                  }
                  if (rich === null) {
                    return (
                      <div key={block.id} id={`block-${block.id}`} className={branchClass}>
                        <p style={{ whiteSpace: 'pre-wrap' }}>{chosen.endingMessage}</p>
                      </div>
                    )
                  }
                  return null
                }
                return null
              }

              if (!(renderedBlocks.get(block.id)?.conditionOk ?? true)) return null

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
                  <InlineChoice prompt={block.prompt ?? null} choices={visibleChoices(block.choices, storyState)} onChoose={id => handleChoose(block, id)} />
                </div>
              )
            }

            if (block.type === 'soundtrack' && block.content) {
              // Optional conditioning — same shape choice blocks use.
              // No condition → always plays.
              if (!(renderedBlocks.get(block.id)?.conditionOk ?? true)) return null
              const label = pinLabel(block.pinStart, block.pinEnd)
              return (
                <div key={block.id} id={`block-${block.id}`} className="my-4 px-4 py-3 rounded-lg bg-surface-raised border border-accent/10">
                  <div className="flex items-center gap-3">
                    {block.hasAlbumArt
                      ? <img src={`/music/${block.id}-art.jpg`} alt="" className="shrink-0 w-10 h-10 rounded object-cover border border-accent/10" />
                      : <LuMusic size={14} className="text-accent shrink-0" />}
                    {block.prompt && <span className="text-xs text-ink-faint italic truncate">{block.prompt}</span>}
                    <PinnedAudio
                      src={block.content}
                      pinStart={block.pinStart}
                      pinEnd={block.pinEnd}
                      className="flex-1 min-w-0"
                    />
                  </div>
                  {label && (
                    <p className={`text-xs text-ink-faint italic mt-2 ${block.hasAlbumArt ? 'pl-[3.25rem]' : 'pl-6'}`}>{label}</p>
                  )}
                </div>
              )
            }

            return null
          })
          return (
            <>
              {elements}
              {hitBadEnding && (
                <InlineBadEnding
                  sessionId={sessionId}
                  seriesId={seriesId}
                  choiceHistory={choiceHistory}
                  variables={variables}
                  chapterLabels={chapterLabels}
                  firstChapterId={books[0]?.chapters[0]?.id ?? null}
                  onApply={(state, history, chapterId, scrollToBlockId) => {
                    onSessionUpdate(state, history)
                    if (scrollToBlockId) pendingScrollBlockRef.current = scrollToBlockId
                    onNavigate(chapterId)
                  }}
                />
              )}
            </>
          )
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
              ? <img
                  src={
                    charCard.character.hasBookAvatar && currentBookId
                      ? `/characters/${charCard.character.id}-${currentBookId}.jpg`
                      : `/characters/${charCard.character.id}.jpg`
                  }
                  alt={charCard.character.name}
                  className="w-full h-full object-cover"
                />
              : <LuUser size={28} style={{ color: lightMode ? '#888' : '#666' }} />
            }
          </div>
          <div>
            <p className="text-sm font-semibold" style={{ color: lightMode ? '#1a1a2a' : '#e0d9c8' }}>{charCard.character.name}</p>
            {charCard.character.deceased
              ? <p className="text-xs mt-0.5 italic uppercase tracking-widest" style={{ color: lightMode ? '#888' : '#888' }}>Deceased</p>
              : charCard.character.age != null && <p className="text-xs mt-0.5" style={{ color: lightMode ? '#666' : '#aaa' }}>Age {charCard.character.age}</p>}
          </div>
        </div>
      )}

      {pendingChoiceBlock && (
        <ChapterGate
          prompt={pendingChoiceBlock.prompt ?? null}
          choices={visibleChoices(pendingChoiceBlock.choices, storyState)}
          onChoose={id => handleChoose(pendingChoiceBlock, id)}
        />
      )}

      {showConfig && (
        <ChoiceConfigModal
          seriesId={seriesId}
          sessionId={sessionId}
          choiceHistory={choiceHistory}
          variables={variables}
          currentChapterId={currentChapterId ?? null}
          highlightConditionals={highlightConditionals}
          onHighlightConditionalsChange={onHighlightConditionalsChange}
          onApply={(state, history) => {
            onSessionUpdate(state, history)
            setShowConfig(false)
            if (currentChapterId) onNavigate(currentChapterId)
          }}
          onClose={() => setShowConfig(false)}
        />
      )}

      {endingMessage != null && (
        <BadEndingModal
          message={endingMessage}
          storyState={storyState}
          sessionId={sessionId}
          seriesId={seriesId}
          choiceHistory={choiceHistory}
          variables={variables}
          chapterLabels={chapterLabels}
          firstChapterId={books[0]?.chapters[0]?.id ?? null}
          onApply={(state, history, chapterId, scrollToBlockId) => {
            onSessionUpdate(state, history)
            setEndingMessage(null)
            if (scrollToBlockId) pendingScrollBlockRef.current = scrollToBlockId
            onNavigate(chapterId)
          }}
        />
      )}

      {(prevChapter || nextChapter) && (
        <footer className="shrink-0 bg-surface-raised border-t border-accent/10 px-4 py-4 flex items-center gap-4 z-20">
          {prevChapter ? (
            <button
              onClick={() => onNavigate(prevChapter.id)}
              className="shrink-0 flex items-center gap-1.5 text-xs text-ink-muted hover:text-ink transition"
            >
              <LuArrowLeft size={13} /> {chapterLabels[prevChapter.id]?.readerLabel ?? prevChapter.title}
            </button>
          ) : <div />}
          <div className="flex-1 relative h-1 bg-surface-muted rounded-full">
            <div
              ref={progressFillRef}
              className="h-full bg-accent/60 rounded-full transition-[width] duration-75"
              style={{ width: `${scrollProgressRef.current * 100}%` }}
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
              className={`shrink-0 flex items-center gap-1.5 text-xs transition ${atEnd ? 'text-white font-medium' : 'text-ink-muted hover:text-ink'}`}
            >
              {chapterLabels[nextChapter.id]?.readerLabel ?? nextChapter.title} <LuArrowRight size={13} />
            </button>
          ) : <div />}
        </footer>
      )}

      {/* Floating copy-chapter button — author-only, hugs the viewport edge
          above the footer so it never overlaps the last lines of prose. */}
      {isAuthor && (
        <button
          onClick={copyChapter}
          title={copyState === 'copied' ? 'Copied!' : 'Copy chapter text'}
          className="fixed bottom-16 right-3 z-50 bg-surface-raised border border-accent/20 hover:border-accent/40 text-ink-muted hover:text-ink transition w-9 h-9 flex items-center justify-center rounded-full shadow-lg"
        >
          {copyState === 'copied' ? <LuCheck size={14} className="text-accent" /> : <LuCopy size={14} />}
        </button>
      )}
    </div>
  )
}
