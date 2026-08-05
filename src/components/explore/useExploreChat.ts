'use client'

import { useCallback, useRef, useState } from 'react'

import type { Citation, ExploreMessage, ExploreMode, ExploreSession } from './types'

// The Explore conversation (LOOM-114).
//
// Maps onto WriteAI's `useStreamChat`, but the SSE reader is Loom's own —
// `useReviewRunner.ts` already parses this exact wire format, and one parsing
// pattern in this codebase is worth more than a faithful port of a second.
//
// ── Spend ───────────────────────────────────────────────────────────────────
//
// NOTHING here fires on mount. The first billable call is the writer pressing
// send. That matters more than it looks: `_build_bible` runs once per selected
// book per message, so the series page with five books injects five condensed
// bibles into every prompt — the cost per message is not flat, and a stray
// warm-up request is not cheap.

const uid = () =>
  `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`

type SendArgs = {
  text: string
  seriesId: string
  bookId: string | null
  bookIds: string[]
  povs: string[]
  mode: ExploreMode
  model: string | null
  thorough: boolean
  /** Scope chip + restore data for the saved thread. */
  scopeLabel: string
}

export function useExploreChat(onPersist: (session: ExploreSession) => void) {
  const [messages, setMessages] = useState<ExploreMessage[]>([])
  const [isStreaming, setStreaming] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [sessionId, setSessionId] = useState<string | null>(null)

  const abortRef = useRef<AbortController | null>(null)
  // Read inside the async body, where a stale closure would otherwise start a
  // second thread instead of appending to the open one.
  const sessionIdRef = useRef<string | null>(null)
  sessionIdRef.current = sessionId

  const reset = useCallback(() => {
    abortRef.current?.abort()
    setMessages([])
    setSessionId(null)
    setError(null)
    setStreaming(false)
  }, [])

  /** Reopen a saved thread. A read — it must never write (see the guard in
   *  ExplorePanel: a thread opened and not added to is not saved). */
  const load = useCallback((session: ExploreSession) => {
    abortRef.current?.abort()
    setMessages(session.messages.map(m => ({ ...m, isStreaming: false })))
    setSessionId(session.id)
    setError(null)
    setStreaming(false)
  }, [])

  const stop = useCallback(() => {
    abortRef.current?.abort()
    setStreaming(false)
  }, [])

  const send = useCallback(async (args: SendArgs) => {
    const text = args.text.trim()
    if (!text) return

    const ctrl = new AbortController()
    abortRef.current = ctrl
    setError(null)
    setStreaming(true)

    // Continue the open thread, or begin one. "New chat" clears the session id,
    // which is what starts a new thread — every send while one is open appends.
    let sid = sessionIdRef.current
    if (!sid) {
      sid = uid()
      sessionIdRef.current = sid
      setSessionId(sid)
    }

    const userMsg: ExploreMessage = {
      id: uid(), role: 'user', content: text, timestamp: new Date().toISOString(),
    }
    const assistantId = uid()
    const history = messages.slice(-8).map(m => ({ role: m.role, content: m.content }))

    setMessages(prev => [...prev, userMsg, {
      id: assistantId,
      role: 'assistant',
      content: '',
      timestamp: new Date().toISOString(),
      mode: args.mode,
      isStreaming: true,
    }])

    let acc = ''
    let citations: Citation[] = []
    let cost: number | null = null
    let model: string | null = null
    let starved = false

    const patch = (fields: Partial<ExploreMessage>) =>
      setMessages(prev => prev.map(m => (m.id === assistantId ? { ...m, ...fields } : m)))

    try {
      const res = await fetch('/api/writeai/chat/run', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        signal: ctrl.signal,
        body: JSON.stringify({
          seriesId: args.seriesId,
          bookId: args.bookId,
          message: text,
          mode: args.mode,
          bookIds: args.bookIds,
          povs: args.povs,
          conversationHistory: history,
          model: args.model,
          thorough: args.thorough,
        }),
      })

      if (!res.ok || !res.body) {
        const detail = await res.json().catch(() => ({}))
        throw new Error(detail.error ?? `Explore failed (${res.status})`)
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
          let ev: {
            type?: string
            content?: string
            message?: string
            sources?: Citation[]
            cost_usd?: number
            model?: string
            pov_filter?: string[]
          }
          try { ev = JSON.parse(line.slice(5).trim()) } catch { continue }

          if (ev.type === 'chunk' && ev.content) {
            acc += ev.content
            patch({ content: acc })
          } else if (ev.type === 'citations') {
            citations = ev.sources ?? []
          } else if (ev.type === 'filter_starved') {
            // The POV filter matched nothing, so nothing was asked of the
            // model and nothing was spent (LOOM-113). Say that, rather than
            // rendering an empty answer.
            starved = true
            const who = (ev.pov_filter ?? []).join(', ')
            acc = who
              ? `No excerpts match **${who}** in the selected books, so there is nothing to answer from. Widen the POV filter or the book selection and ask again.`
              : 'Nothing in the selected books matches this filter.'
            patch({ content: acc, starved: true })
          } else if (ev.type === 'usage') {
            cost = ev.cost_usd ?? null
            model = ev.model ?? null
            patch({ costUsd: cost, model })
          } else if (ev.type === 'error') {
            throw new Error(ev.message ?? 'Explore failed')
          } else if (ev.type === 'done') {
            done = true
          }
        }
      }

      if (!acc.trim()) throw new Error('Explore returned nothing')

      const finalAssistant: ExploreMessage = {
        id: assistantId,
        role: 'assistant',
        content: acc,
        timestamp: new Date().toISOString(),
        citations,
        costUsd: cost,
        model,
        mode: args.mode,
        starved,
        isStreaming: false,
      }
      patch(finalAssistant)

      // A COMPLETE session every time. WriteAI's PUT replaces the whole object
      // rather than merging, so anything omitted here is destroyed.
      const priorMessages = messages
      onPersist({
        id: sid,
        // The label stays the thread's FIRST question, so a thread does not
        // rename itself out from under the writer as it grows.
        question: priorMessages.find(m => m.role === 'user')?.content ?? text,
        messages: [...priorMessages, userMsg, finalAssistant],
        timestamp: new Date().toISOString(),
        mode: args.mode,
        selectedBooks: args.bookIds,
        selectedPovs: args.povs,
        loomScope: {
          seriesId: args.seriesId,
          bookId: args.bookId,
          label: args.scopeLabel,
          bookIds: args.bookIds,
        },
      })
    } catch (err) {
      if ((err as Error)?.name === 'AbortError') {
        // Deliberate stop or a tab switch — not a failure to report.
        setMessages(prev => prev.filter(m => m.id !== assistantId || m.content))
        patch({ isStreaming: false })
        return
      }
      const msg = err instanceof Error ? err.message : 'unknown error'
      setError(msg)
      // Drop the empty assistant bubble; the error is shown on its own.
      setMessages(prev => prev.filter(m => !(m.id === assistantId && !m.content)))
    } finally {
      setStreaming(false)
      abortRef.current = null
    }
  }, [messages, onPersist])

  return { messages, isStreaming, error, sessionId, send, reset, load, stop, setError }
}
