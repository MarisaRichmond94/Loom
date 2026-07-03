import { NextResponse } from 'next/server'
import {
  readExportFormatting,
  writeExportFormatting,
  EXPORT_FORMATTING_DEFAULTS,
  type ExportFormatting,
  type ManuscriptStyleKey,
} from '@/lib/exportFormatting'

export async function GET() {
  const settings = await readExportFormatting()
  return NextResponse.json(settings)
}

// PATCH merges page/styles one level deep so the settings UI can send just
// the field the writer changed. DELETE resets everything to the captured
// Pages defaults.
export async function PATCH(req: Request) {
  const body = await req.json() as Partial<ExportFormatting>
  const current = await readExportFormatting()
  const updated: ExportFormatting = {
    ...current,
    ...body,
    page: { ...current.page, ...(body.page ?? {}) },
    styles: { ...current.styles },
  }
  if (body.styles) {
    for (const key of Object.keys(body.styles) as ManuscriptStyleKey[]) {
      updated.styles[key] = { ...current.styles[key], ...body.styles[key] }
    }
  }
  await writeExportFormatting(updated)
  return NextResponse.json(updated)
}

export async function DELETE() {
  await writeExportFormatting(EXPORT_FORMATTING_DEFAULTS)
  return NextResponse.json(EXPORT_FORMATTING_DEFAULTS)
}
