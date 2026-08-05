import { callWriteAi } from '@/lib/writeaiProxy'

// The chat models WriteAI offers (LOOM-119).
//
// Loom keeps NO model list of its own. WriteAI is the only side that knows
// which ids it can price correctly, and a second hard-coded list here would be
// the one nobody remembers to update — with a silent failure mode, since an
// unpriced model still answers and only the spend figure is wrong.
//
// A pure read of module constants on WriteAI's side; safe on tab open.

export const dynamic = 'force-dynamic'

export async function GET() {
  const result = await callWriteAi('/api/models', { cache: 'no-store' })
  if ('response' in result) return result.response

  const data = result.data as {
    models?: { id?: unknown; label?: unknown }[]
    default?: unknown
  }
  const models = (data?.models ?? [])
    .filter((m): m is { id: string; label: string } =>
      typeof m?.id === 'string' && typeof m?.label === 'string')

  return Response.json({
    models,
    default: typeof data?.default === 'string' ? data.default : models[0]?.id ?? null,
  })
}
