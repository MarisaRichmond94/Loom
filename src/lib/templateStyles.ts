import { readFile, writeFile, mkdir, stat, rm } from 'fs/promises'
import { tmpdir } from 'os'
import path from 'path'
import { pagesToDocx } from '@/lib/manuscript/pagesConvert'
import JSZip from 'jszip'

// Manuscript style templating. The writer points Loom at a real .pages
// template; its style definitions become the styles of every exported
// manuscript, so the generated files match the template exactly instead of
// approximating it from the Export-tab formatting numbers.
//
// Mechanics: Pages can't be scripted at the style level, but it CAN export
// the template to .docx — and that docx's styles.xml carries the full OOXML
// definition of every style **used in the template's body text**. (Unused
// styles are dropped by Pages, which is why the template needs a sample
// page exercising each style that should carry over.) We convert once and
// cache the extracted styles.xml keyed by the template file's mtime.
//
// Color styles: styles named "<something> Text" that carry a color are
// treated as the writer's intentional inline-color styles ("Red Text",
// "Gray Text", …). Colored editor text gets tagged with the nearest one
// instead of a raw color override, so in Pages the text answers to the
// named style like everything else.

export type TemplateColorStyle = {
  name: string
  type: 'paragraph' | 'character'
  color: string   // rrggbb
  block: string   // full <w:style> XML, styleId normalized to the name
}

export type TemplateStyles = {
  // Paragraph styles by name, full <w:style> XML with styleId = name.
  paragraphBlocks: Map<string, string>
  colorStyles: TemplateColorStyle[]
}

export type TemplateSettings = { path: string }

const SETTINGS_PATH = path.join(process.cwd(), 'data', 'manuscript-template.json')
const CACHE_PATH = path.join(process.cwd(), 'data', 'template-styles-cache.json')

export async function readTemplateSettings(): Promise<TemplateSettings> {
  try {
    const raw = await readFile(SETTINGS_PATH, 'utf-8')
    const parsed = JSON.parse(raw) as Partial<TemplateSettings>
    return { path: typeof parsed.path === 'string' ? parsed.path : '' }
  } catch {
    return { path: '' }
  }
}

export async function writeTemplateSettings(settings: TemplateSettings): Promise<void> {
  await mkdir(path.dirname(SETTINGS_PATH), { recursive: true })
  await writeFile(SETTINGS_PATH, JSON.stringify(settings, null, 2), 'utf-8')
}

type Cache = { path: string; mtimeMs: number; stylesXml: string }

async function templateStylesXml(templatePath: string): Promise<string> {
  const info = await stat(templatePath)
  try {
    const cached = JSON.parse(await readFile(CACHE_PATH, 'utf-8')) as Cache
    if (cached.path === templatePath && cached.mtimeMs === info.mtimeMs) return cached.stylesXml
  } catch { /* no cache yet */ }

  const workDir = path.join(tmpdir(), `loom-template-${Date.now()}`)
  await mkdir(workDir, { recursive: true })
  const docxPath = path.join(workDir, 'template.docx')
  try {
    await pagesToDocx(templatePath, docxPath)
    const zip = await JSZip.loadAsync(await readFile(docxPath))
    const stylesFile = zip.file('word/styles.xml')
    if (!stylesFile) throw new Error('Template conversion produced no styles.xml')
    const stylesXml = await stylesFile.async('string')
    const cache: Cache = { path: templatePath, mtimeMs: info.mtimeMs, stylesXml }
    await mkdir(path.dirname(CACHE_PATH), { recursive: true })
    await writeFile(CACHE_PATH, JSON.stringify(cache), 'utf-8')
    return stylesXml
  } finally {
    await rm(workDir, { recursive: true, force: true }).catch(() => {})
  }
}

// Word boilerplate that exists in every docx and isn't a writer style.
const IGNORED_NAMES = new Set(['Normal', 'Default Paragraph Font', 'Table Normal', 'No List', 'Hyperlink'])

function unescapeXml(s: string): string {
  return s.replace(/&quot;/g, '"').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&')
}
function escapeAttr(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/"/g, '&quot;')
}

export function parseTemplateStyles(stylesXml: string): TemplateStyles {
  const paragraphBlocks = new Map<string, string>()
  const colorStyles: TemplateColorStyle[] = []

  for (const m of stylesXml.matchAll(/<w:style\b[^>]*>[\s\S]*?<\/w:style>/g)) {
    let block = m[0]
    const type = block.match(/w:type="(\w+)"/)?.[1]
    if (type !== 'paragraph' && type !== 'character') continue
    const rawName = block.match(/<w:name w:val="([^"]+)"/)?.[1]
    if (!rawName) continue
    const name = unescapeXml(rawName)
    if (IGNORED_NAMES.has(name)) continue

    // Normalize the styleId to the (escaped) name so document.xml can
    // reference styles by name without tracking Pages' export ids.
    block = block.replace(/w:styleId="[^"]*"/, `w:styleId="${escapeAttr(name)}"`)

    if (type === 'paragraph') paragraphBlocks.set(name, block)

    if (/ Text$/.test(name)) {
      const color = block.match(/<w:color w:val="([0-9a-fA-F]{6})"/)?.[1]?.toLowerCase()
      if (color) colorStyles.push({ name, type, color, block })
    }
  }

  return { paragraphBlocks, colorStyles }
}

// Load the configured template's styles, converting through Pages when the
// cache is stale. Returns null when no template is configured; throws when
// one is configured but can't be read/converted (callers surface that).
export async function loadTemplateStyles(): Promise<TemplateStyles | null> {
  const { path: templatePath } = await readTemplateSettings()
  if (!templatePath) return null
  const stylesXml = await templateStylesXml(templatePath)
  return parseTemplateStyles(stylesXml)
}

// ---- color matching --------------------------------------------------------

function rgb(hex: string): [number, number, number] {
  return [parseInt(hex.slice(0, 2), 16), parseInt(hex.slice(2, 4), 16), parseInt(hex.slice(4, 6), 16)]
}

// Editor palette colors won't equal the template's exactly (#ef4444 vs a
// hand-picked Pages red); nearest-match within a generous radius maps hue
// families without ever crossing them (the template colors are far apart).
const MAX_DISTANCE = 130

export function nearestColorStyle(
  color: string,
  styles: TemplateColorStyle[],
  type?: 'paragraph' | 'character',
): TemplateColorStyle | null {
  const candidates = type ? styles.filter(s => s.type === type) : styles
  if (!candidates.length) return null
  const [r, g, b] = rgb(color)
  let best: TemplateColorStyle | null = null
  let bestD = Infinity
  for (const s of candidates) {
    const [sr, sg, sb] = rgb(s.color)
    const d = Math.sqrt((r - sr) ** 2 + (g - sg) ** 2 + (b - sb) ** 2)
    if (d < bestD) { bestD = d; best = s }
  }
  return bestD <= MAX_DISTANCE ? best : null
}
