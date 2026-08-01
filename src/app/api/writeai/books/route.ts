import { callWriteAi } from '@/lib/writeaiProxy'

// WriteAI's book list, proxied read-only (LOOM-33 / LOOM-46).
//
// The character modal's book chips write into `books`, which stores book
// TITLES — so the valid values are whatever WriteAI calls its books, not
// whatever Loom does. Asking WriteAI keeps the two from disagreeing after a
// rename on either side.
//
// Sourced here rather than threaded down from the chapter page on purpose:
// the page and the dock are shared files, and this needs neither.
export async function GET() {
  const result = await callWriteAi('/api/books')
  if ('response' in result) return result.response

  // Shape is { books: [...], last_synced }, and each row carries its whole
  // chapter list — far more than a set of chips needs. Reduced to names here
  // so the browser is not handed a payload it has no use for, and so a second
  // consumer cannot quietly grow on the extra fields.
  const rows = ((result.data as { books?: unknown })?.books ?? []) as { name?: string }[]
  return Response.json({
    books: rows.map(b => b.name).filter((n): n is string => typeof n === 'string' && n.length > 0),
  })
}
