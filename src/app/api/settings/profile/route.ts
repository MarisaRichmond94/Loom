import { NextResponse } from 'next/server'
import { readProfileSettings, writeProfileSettings } from '@/lib/profileSettings'

export async function GET() {
  const settings = await readProfileSettings()
  return NextResponse.json(settings)
}

export async function PATCH(req: Request) {
  const patch = (await req.json()) as Partial<{ authorName: unknown }>
  const current = await readProfileSettings()
  const next = {
    ...current,
    ...(typeof patch.authorName === 'string' && { authorName: patch.authorName.trim() }),
  }
  await writeProfileSettings(next)
  return NextResponse.json(next)
}
