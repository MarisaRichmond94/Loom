import { NextResponse } from 'next/server'
import { existsSync } from 'fs'
import path from 'path'
import { readProfileSettings, writeProfileSettings } from '@/lib/profileSettings'

export async function GET() {
  const settings = await readProfileSettings()
  // Avatar existence flags so the client can render the right photo
  // (real / pseudonym / blurred main) without firing extra HEAD requests.
  const publicDir = path.join(process.cwd(), 'public')
  return NextResponse.json({
    ...settings,
    hasAvatar: existsSync(path.join(publicDir, 'avatar.jpg')),
    hasPseudonymAvatar: existsSync(path.join(publicDir, 'pseudonym-avatar.jpg')),
  })
}

export async function PATCH(req: Request) {
  const patch = (await req.json()) as Partial<{
    authorName: unknown
    bio: unknown
    pseudonymEnabled: unknown
    pseudonym: unknown
  }>
  const current = await readProfileSettings()
  const next = {
    ...current,
    ...(typeof patch.authorName === 'string' && { authorName: patch.authorName.trim() }),
    ...(typeof patch.bio === 'string' && { bio: patch.bio }),
    ...(typeof patch.pseudonymEnabled === 'boolean' && { pseudonymEnabled: patch.pseudonymEnabled }),
    ...(typeof patch.pseudonym === 'string' && { pseudonym: patch.pseudonym.trim() }),
  }
  await writeProfileSettings(next)
  return NextResponse.json(next)
}
