import { NextResponse } from 'next/server'
import { readdir } from 'fs/promises'
import path from 'path'
import { prisma } from '@/lib/prisma'
import { readCanonExportSettings } from '@/lib/canonExportSettings'

// Unique subfolder names found inside the BOOK folders under the configured
// root (e.g. Assets, Dust Jacket, Versions). Only folders whose name matches
// a Loom book title count — the root can also hold unrelated folders
// (Audiobooks, Planning, …) whose insides would just be noise here. Feeds
// the settings dropdown so the writer picks a folder that actually exists
// rather than typing one. A ?root= override lets the UI preview a folder
// the writer just picked but hasn't saved yet.

function normalizeTitle(s: string): string {
  return s.normalize('NFC').replace(/[‘’]/g, "'").trim().toLowerCase()
}

export async function GET(req: Request) {
  const url = new URL(req.url)
  const root = url.searchParams.get('root') || (await readCanonExportSettings()).root

  let entries
  try {
    entries = await readdir(root, { withFileTypes: true })
  } catch {
    return NextResponse.json({ subfolders: [], error: `Folder not found: ${root}` }, { status: 422 })
  }

  const books = await prisma.book.findMany({ select: { title: true } })
  const titles = new Set(books.map(b => normalizeTitle(b.title)))
  const bookDirs = entries.filter(e =>
    e.isDirectory() && titles.has(normalizeTitle(e.name.replace(/^\d+\.\s*/, '')))
  )

  const names = new Set<string>()
  for (const dir of bookDirs) {
    try {
      const inner = await readdir(path.join(root, dir.name), { withFileTypes: true })
      for (const e of inner) {
        if (e.isDirectory() && !e.name.startsWith('.')) names.add(e.name)
      }
    } catch { /* unreadable book folder — skip */ }
  }

  return NextResponse.json({ subfolders: [...names].sort((a, b) => a.localeCompare(b)) })
}
