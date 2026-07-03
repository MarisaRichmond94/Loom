import { NextResponse } from 'next/server'
import { readTemplateSettings, writeTemplateSettings, loadTemplateStyles } from '@/lib/templateStyles'

// GET returns the configured template plus the styles Loom could extract
// from it — the UI shows that list so the writer can confirm the template's
// sample page covers everything. Extraction converts through Pages on first
// read (and again whenever the template file changes), so a GET after an
// edit can take a few seconds.

async function summary() {
  const settings = await readTemplateSettings()
  if (!settings.path) return { ...settings, styles: null, error: null }
  try {
    const styles = await loadTemplateStyles()
    return {
      ...settings,
      styles: styles ? {
        paragraph: [...styles.paragraphBlocks.keys()],
        color: styles.colorStyles.map(s => ({ name: s.name, type: s.type, color: `#${s.color}` })),
      } : null,
      error: null,
    }
  } catch (err) {
    return { ...settings, styles: null, error: err instanceof Error ? err.message : 'Template could not be read.' }
  }
}

export async function GET() {
  return NextResponse.json(await summary())
}

export async function PATCH(req: Request) {
  const patch = await req.json().catch(() => ({})) as Partial<{ path: string }>
  if (typeof patch.path === 'string') {
    await writeTemplateSettings({ path: patch.path.trim() })
  }
  return NextResponse.json(await summary())
}
