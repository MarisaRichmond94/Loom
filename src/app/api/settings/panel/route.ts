import { NextResponse } from 'next/server'
import { readPanelSettings, writePanelSettings } from '@/lib/panelSettings'

export async function GET() {
  const settings = await readPanelSettings()
  return NextResponse.json(settings)
}

export async function PATCH(req: Request) {
  const patch = (await req.json()) as Partial<{ commentsTabEnabled: unknown }>
  const current = await readPanelSettings()
  const next = {
    ...current,
    ...(typeof patch.commentsTabEnabled === 'boolean' && { commentsTabEnabled: patch.commentsTabEnabled }),
  }
  await writePanelSettings(next)
  return NextResponse.json(next)
}
