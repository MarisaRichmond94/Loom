import path from 'node:path'
import { cookies } from 'next/headers'
import { redirect } from 'next/navigation'
import type Database from 'better-sqlite3'
import { findReaderByToken, openReaderDb, touchLastSeen, type Reader } from '@/shared/readerDb'

/**
 * Reader identity for the reader app (LOOM-132).
 *
 * There is no login. A reader opens their invite link once per browser, the
 * token is exchanged for a cookie, and every request after that resolves the
 * cookie to a person. Nothing to type, nothing to remember, nothing to phish —
 * and no password to be reused from somewhere else.
 *
 * THE COOKIE IS NOT THE AUTHORITY. It carries the token, and the token is
 * re-resolved against `reader.db` on every request. That is what makes
 * revocation immediate: flipping `disabled` stops the next request cold, on
 * every device at once, with no session to expire.
 */

/** HttpOnly, so page scripts cannot read it and a leaked bookmark is the only exposure. */
export const READER_COOKIE = 'loom-reader'

/** A year. The invite link is the enrolment step; nobody should repeat it monthly. */
export const READER_COOKIE_MAX_AGE = 60 * 60 * 24 * 365

/** `reader.db` beside `content.db`. The reader app's cwd is `reader/`. */
export const READER_DB_PATH =
  process.env.READER_DB_PATH ?? path.join(process.cwd(), 'reader.db')

let handle: Database.Database | null = null

function db(): Database.Database {
  if (!handle) handle = openReaderDb(READER_DB_PATH)
  return handle
}

/**
 * The reader behind this request, or null.
 *
 * Null covers all three failure modes on purpose — no cookie, unknown token,
 * revoked reader — because the page they land on is the same in each case and
 * distinguishing them for the visitor would only tell an unwanted one which
 * guess was closer.
 */
export async function resolveReader(): Promise<Reader | null> {
  const token = (await cookies()).get(READER_COOKIE)?.value
  if (!token) return null
  const reader = findReaderByToken(db(), token)
  if (!reader || reader.disabled) return null
  return reader
}

/** As above, but sends anyone unrecognised to the invite page. */
export async function requireReader(): Promise<Reader> {
  const reader = await resolveReader()
  if (!reader) redirect('/invite')
  return reader
}

/**
 * Exchange an invite token for a reader. Used only by `/r/<token>`.
 *
 * Returns the reader even when disabled so the route can answer "this link was
 * revoked" rather than silently behaving as though it never existed — the
 * author needs to be able to tell those apart when a family member reports a
 * link not working.
 */
export function redeemToken(token: string): Reader | null {
  return findReaderByToken(db(), token)
}

/**
 * Stamps `lastSeenAt` so the author's readers list can show who has actually
 * opened anything. Best-effort: a failure here must never cost a page.
 */
export function markSeen(readerId: string): void {
  try {
    touchLastSeen(db(), readerId)
  } catch {
    // Not worth a 500. The column is a convenience, not a correctness concern.
  }
}
