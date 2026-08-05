// Validation for Explore chat sessions crossing into WriteAI (LOOM-116).
//
// ⚠️ `PUT /api/sessions/{kind}/{sid}` does `entries[i] = body`. It REPLACES the
// whole session object; it does not merge. A body missing `messages` silently
// discards the entire conversation, with no error and no symptom until someone
// looks for a thread that is no longer there.
//
// This is the FOURTH endpoint in WriteAI with that shape — the others are
// `PATCH /api/writer-events/{id}`, `PUT /api/plan/characters/{id}` and
// `PUT /api/plan/outline/{book}`. INTEGRATION.md's rule applies: assume
// replace, not merge, unless a route says otherwise.
//
// Pure so it can be unit tested — the route that uses it cannot be, since it
// pulls in the ESM Prisma client. Same split as exploreScope.ts.

export type SessionValidation =
  | { ok: true; session: Record<string, unknown> }
  | { ok: false; error: string }

/** Every field WriteAI's own Explore pane writes. Sending fewer destroys the
 *  rest, so an incomplete session is refused rather than forwarded. */
const REQUIRED = ['id', 'question', 'messages', 'timestamp', 'mode'] as const

export function validateChatSession(body: unknown): SessionValidation {
  if (!body || typeof body !== 'object') {
    return { ok: false, error: 'session must be an object' }
  }
  const s = body as Record<string, unknown>

  if (typeof s.id !== 'string' || !s.id) {
    return { ok: false, error: 'session id is required' }
  }

  const missing = REQUIRED.filter(k => s[k] === undefined || s[k] === null)
  if (missing.length) {
    return {
      ok: false,
      error:
        'refusing to write an incomplete session — WriteAI replaces the whole '
        + `object, so this would discard: ${missing.join(', ')}`,
    }
  }

  if (!Array.isArray(s.messages) || s.messages.length === 0) {
    return {
      ok: false,
      error: 'refusing to write a session with no messages — this would erase the conversation',
    }
  }

  // A thread whose messages are all empty is the same erasure wearing a
  // different shape: the array is present, so the length check passes, but
  // what lands in the store is a thread with nothing in it.
  const hasContent = (s.messages as unknown[]).some(
    m => !!m && typeof m === 'object'
      && typeof (m as { content?: unknown }).content === 'string'
      && (m as { content: string }).content.trim().length > 0,
  )
  if (!hasContent) {
    return { ok: false, error: 'refusing to write a session whose messages are all empty' }
  }

  return { ok: true, session: s }
}

/**
 * Reduce WriteAI's whole `sessions.json` to the chat threads a page needs.
 *
 * Filtering happens SERVER-SIDE because that file is ~800 KB and holds both
 * kinds — shipping it to the browser to render a list of questions is the
 * thing the review proxy already refuses to do.
 */
export function selectChatSessions(
  data: unknown,
  limit = 60,
): Record<string, unknown>[] {
  const chat = (data as { chat?: unknown })?.chat
  if (!Array.isArray(chat)) return []
  return chat
    .filter((s): s is Record<string, unknown> => !!s && typeof s === 'object')
    .sort((a, b) => String(b.timestamp ?? '').localeCompare(String(a.timestamp ?? '')))
    .slice(0, limit)
    .map(s => ({
      id: s.id,
      question: s.question,
      timestamp: s.timestamp,
      mode: s.mode,
      selectedBooks: s.selectedBooks,
      selectedPovs: s.selectedPovs,
      loomScope: s.loomScope,
      // The list renders a question and a chip; the conversation is fetched
      // only when a thread is opened. Sending every message of every thread
      // would reintroduce the payload this filtering exists to avoid.
      messageCount: Array.isArray(s.messages) ? s.messages.length : 0,
    }))
}
