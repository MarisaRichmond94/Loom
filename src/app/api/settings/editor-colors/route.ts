import { NextResponse } from 'next/server'
import { readFile, writeFile, mkdir, rm } from 'fs/promises'
import path from 'path'
import { DEFAULT_EDITOR_COLORS, sanitizeEditorColors } from '@/lib/editorColors'

// Editor color palette. PUT replaces the whole list (the settings UI edits
// it as one unit); DELETE restores the defaults.

const SETTINGS_PATH = path.join(process.cwd(), 'data', 'editor-colors.json')

async function readColors() {
  try {
    const parsed = JSON.parse(await readFile(SETTINGS_PATH, 'utf-8'))
    return sanitizeEditorColors(parsed) ?? DEFAULT_EDITOR_COLORS
  } catch {
    return DEFAULT_EDITOR_COLORS
  }
}

export async function GET() {
  return NextResponse.json(await readColors())
}

export async function PUT(req: Request) {
  const colors = sanitizeEditorColors(await req.json().catch(() => null))
  if (!colors) {
    return NextResponse.json({ error: 'Each color needs a label and a #rrggbb value (1–24 colors).' }, { status: 422 })
  }
  await mkdir(path.dirname(SETTINGS_PATH), { recursive: true })
  await writeFile(SETTINGS_PATH, JSON.stringify(colors, null, 2), 'utf-8')
  return NextResponse.json(colors)
}

export async function DELETE() {
  await rm(SETTINGS_PATH, { force: true })
  return NextResponse.json(DEFAULT_EDITOR_COLORS)
}
