import { NextResponse } from 'next/server'
import { readCanonExportSettings, writeCanonExportSettings } from '@/lib/canonExportSettings'

export async function GET() {
  return NextResponse.json(await readCanonExportSettings())
}

export async function PATCH(req: Request) {
  const patch = await req.json().catch(() => ({})) as Partial<{ root: string; subfolder: string; autosave: boolean }>
  const current = await readCanonExportSettings()
  const updated = {
    root: typeof patch.root === 'string' && patch.root.trim() ? patch.root.trim() : current.root,
    // Empty string is meaningful: save at the book folder's top level.
    subfolder: typeof patch.subfolder === 'string' ? patch.subfolder.trim() : current.subfolder,
    autosave: typeof patch.autosave === 'boolean' ? patch.autosave : current.autosave,
  }
  await writeCanonExportSettings(updated)
  return NextResponse.json(updated)
}
