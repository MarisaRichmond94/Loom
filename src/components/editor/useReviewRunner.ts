'use client'

import { useCallback, useRef, useState } from 'react'
import type { ReviewMessage, ReviewSession } from './ReviewPanel'

// Runs a WriteAI review from Loom and streams it back (KAN-22, Increment 2).
//
// Nothing here starts on its own. Opening the panel must never spend money —
// the writer presses the button when the chapter is ready.
//
// WriteAI makes the model call and books the cost; Loom has no API key. The
// `usage` event carries `cost_usd`, which the panel shows at the point of
// action rather than leaving spend to be discovered later (the KAN-25 lesson,
// applied somewhere new).

export const DEFAULT_FOCUS = 'Literary Agent'

/** Matches the id shape WriteAI's own pane generates. */
function newSessionId(): string {
  return 's' + Math.random().toString(36).slice(2) + Date.now().toString(36)
}

export type RunArgs = {
  seriesId: string
  bookId: string
  chapterId: string
  bookTitle: string
  chapter: number | null
  chapterText: string
  /** Absent for a first pass; the writer's words for a follow-up. */
  message?: string
  /** The draft reviewed last turn, so a re-review diffs instead of restarting. */
  previousText?: string
  session: ReviewSession | null
  focus: string
}

export function useReviewRunner(onPersisted: (s: ReviewSession) => void) {
  const [streaming, setStreaming] = useState(false)
  const [streamText, setStreamText] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [cost, setCost] = useState<number | null>(null)
  // The writer's turn, while it is in flight. It is not in the session yet —
  // the session is only written once the reviewer has answered — so without
  // this the panel had nothing to show for the question just asked, and the
  // conversation assembled backwards: progress and reply first, and the
  // writer's own message appearing under them at the very end.
  const [pending, setPending] = useState<ReviewMessage | null>(null)
  const abortRef = useRef<AbortController | null>(null)

  const cancel = useCallback(() => {
    abortRef.current?.abort()
    abortRef.current = null
    setStreaming(false)
  }, [])

  const run = useCallback(async (args: RunArgs) => {
    if (abortRef.current) return          // one review at a time
    const ctrl = new AbortController()
    abortRef.current = ctrl
    setStreaming(true)
    setStreamText('')
    setError(null)
    setCost(null)

    const askedAt = new Date().toISOString()
    const userMsg: ReviewMessage = {
      id: newSessionId(),
      role: 'user',
      content: args.message?.trim()
        || `Please give me a ${args.focus} review of this chapter.`,
      timestamp: askedAt,
    }
    // Show the writer's turn NOW, so the conversation grows downward in the
    // order it happened: her message, then the progress line, then the reply
    // replacing that line beneath it. Cleared in `finally`, by which point the
    // same message is in the persisted session — React batches the two, so it
    // hands over without a flicker.
    setPending(userMsg)

    let acc = ''
    try {
      const res = await fetch('/api/writeai/review/run', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        signal: ctrl.signal,
        body: JSON.stringify({
          seriesId: args.seriesId,
          bookId: args.bookId,
          chapterId: args.chapterId,
          chapterText: args.chapterText,
          focus: args.focus,
          message: args.message ?? '',
          previousText: args.previousText ?? null,
          conversationHistory: (args.session?.messages ?? []).map(m => ({
            role: m.role, content: m.content,
          })),
          // The Ideal Version rewrite dominates output cost and rarely earns
          // it on a first pass — WriteAI's own pane now defaults it off in
          // favour of targeted, prioritized suggestions. Loom follows suit;
          // a full rewrite is still available from WriteAI's pane via its
          // Ideal Version toggle.
          includeIdeal: false,
        }),
      })

      if (!res.ok || !res.body) {
        const detail = await res.json().catch(() => ({}))
        throw new Error(detail.error ?? `review failed (${res.status})`)
      }

      const reader = res.body.getReader()
      const decoder = new TextDecoder()
      let buf = ''
      let done = false
      while (!done) {
        const { value, done: finished } = await reader.read()
        if (finished) break
        buf += decoder.decode(value, { stream: true })
        // SSE frames are separated by a blank line.
        const frames = buf.split('\n\n')
        buf = frames.pop() ?? ''
        for (const frame of frames) {
          const line = frame.split('\n').find(l => l.startsWith('data:'))
          if (!line) continue
          let ev: { type?: string; content?: string; message?: string; cost_usd?: number }
          try { ev = JSON.parse(line.slice(5).trim()) } catch { continue }
          if (ev.type === 'chunk' && ev.content) {
            acc += ev.content
            setStreamText(acc)
          } else if (ev.type === 'usage') {
            setCost(ev.cost_usd ?? null)
          } else if (ev.type === 'error') {
            throw new Error(ev.message ?? 'review failed')
          } else if (ev.type === 'done') {
            done = true
          }
        }
      }

      if (!acc.trim()) throw new Error('the reviewer returned nothing')

      const assistantMsg: ReviewMessage = {
        id: newSessionId(),
        role: 'assistant',
        content: acc,
        timestamp: new Date().toISOString(),
      }

      // A COMPLETE session every time. WriteAI's PUT replaces the whole object
      // rather than merging, so anything omitted here is destroyed.
      const chapterLabel = args.chapter === 0 ? 'Prologue' : `Chapter ${args.chapter}`
      const session: ReviewSession = {
        id: args.session?.id ?? newSessionId(),
        label: args.session?.label ?? `${args.bookTitle} (${chapterLabel}) - ${args.focus}`,
        book: args.bookTitle,
        chapter: args.chapter ?? 0,
        chapterId: args.chapterId,
        focus: args.focus,
        draft: true,
        timestamp: new Date().toISOString(),
        messages: [...(args.session?.messages ?? []), userMsg, assistantMsg],
      }

      const put = await fetch('/api/writeai/review/session', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(session),
      })
      if (!put.ok) {
        const d = await put.json().catch(() => ({}))
        // The review itself succeeded and was paid for — surface the save
        // failure without discarding what came back.
        setError(`Review ran but could not be saved: ${d.error ?? put.status}`)
      }
      onPersisted(session)
    } catch (err) {
      if ((err as Error).name !== 'AbortError') {
        setError(err instanceof Error ? err.message : 'review failed')
      }
    } finally {
      abortRef.current = null
      setStreaming(false)
      setStreamText('')
      // On success the persisted session now carries this message; on failure
      // or cancellation nothing was saved, so leaving it on screen would show
      // a question that was never asked.
      setPending(null)
    }
  }, [onPersisted])

  return { run, cancel, streaming, streamText, error, cost, setError, pending }
}
