// Shared shapes for the Explore tab (LOOM-114..116).

import type { ExploreBook, ExplorePov } from '@/lib/exploreScope'

export type { ExploreBook, ExplorePov }

/** WriteAI's `mode`. `alternate` is the what-if toggle. */
export type ExploreMode = 'general' | 'alternate'

/** One citation, as WriteAI's `citations` event shapes it. */
export type Citation = {
  book: string
  chapter: number
  chapter_heading: string
  pov: string
  chunk_index: number
  snippet: string
  text: string
  distance: number
  chunk_id?: string | null
  loom_book_id?: string | null
  loom_series_id?: string | null
}

export type ExploreMessage = {
  id: string
  role: 'user' | 'assistant'
  content: string
  timestamp: string
  citations?: Citation[]
  /** Answer cost, shown at the point of action as the review panel does. */
  costUsd?: number | null
  model?: string | null
  /** Rendered as speculation rather than canon. */
  mode?: ExploreMode
  isStreaming?: boolean
  /** The POV filter matched nothing, so no question was asked (LOOM-113). */
  starved?: boolean
}

/**
 * A saved thread, in the shape WriteAI's `sessions.json` stores under `chat`.
 *
 * ⚠️ `PUT /api/sessions/{kind}/{sid}` REPLACES the whole object — an omitted
 * key is destroyed, not left alone. Anything added here must also be sent on
 * every save, and Loom's proxy refuses an incomplete body before it can reach
 * WriteAI. See INTEGRATION.md §3.
 */
export type ExploreSession = {
  id: string
  question: string
  messages: ExploreMessage[]
  timestamp: string
  mode: ExploreMode
  /** WriteAI book ids (numbers), as its own pane stores them. */
  selectedBooks: string[]
  selectedPovs: string[]
  /**
   * Where the thread was asked. Loom-only, and the reason threads can be
   * shared safely: a thread asked on the book-3 page and one asked in WriteAI
   * across all five books are not the same question, and reopening the wrong
   * one silently changes what the model can see. Absent on threads written by
   * WriteAI's own pane, which is itself the signal.
   */
  loomScope?: {
    seriesId: string
    bookId: string | null
    /** Human label for the chip: "Book 3", "Series". */
    label: string
    /** Loom book cuids the thread was scoped to. */
    bookIds: string[]
  }
}
