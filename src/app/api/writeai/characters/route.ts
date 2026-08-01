import { callWriteAi } from '@/lib/writeaiProxy'

// WriteAI's writer-character pool, proxied read-only (LOOM-32 / LOOM-35).
//
// Loom needs it for one thing here: the event modal's character multi-select.
// LOOM-33 extends this route with the write half.
//
// ⚠️ GET /api/plan/characters WRITES TO DISK. On the first call it seeds the
// pool from canon; on every call it prunes entries canon now classifies as
// non-characters and self-heals `books` from numbers to names — saving the
// file whenever any of that changes. A route that looks like a cheap read is
// not one.
//
// So: fetch on open and after mutations, never poll. If this ever needs to be
// hot, cache on Loom's side rather than calling more often.

export async function GET() {
  const result = await callWriteAi('/api/plan/characters')
  if ('response' in result) return result.response
  return Response.json(result.data)
}
