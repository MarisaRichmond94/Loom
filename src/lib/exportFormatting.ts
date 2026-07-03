import { readFile, writeFile, mkdir } from 'fs/promises'
import path from 'path'

// Manuscript-export formatting settings. One JSON blob under data/,
// mirroring the backup-settings pattern. The defaults reproduce the
// author's canonical Pages layout (5.5"×8.5" trade size, Charter body,
// Roboto chapter numbers) — measured from an actual Pages export so a
// generated manuscript is indistinguishable from a hand-written one.

export type ManuscriptAlign = 'left' | 'center' | 'right' | 'justify'

export type ManuscriptStyle = {
  font: string
  sizePt: number
  color: string          // #rrggbb
  align: ManuscriptAlign
  spaceAfterPt: number
  lineSpacing: number    // multiple of single spacing (1.1 = Pages default)
  // Only meaningful for body text; ignored elsewhere.
  firstLineIndentIn?: number
  // Extra tracking between letters. Chapter numbers / section-break
  // ornaments use this; prose leaves it 0.
  letterSpacingPt?: number
}

export type ManuscriptStyleKey =
  | 'chapter' | 'pov' | 'date' | 'body' | 'sectionBreak' | 'footnote' | 'header'

export type ExportFormatting = {
  page: {
    widthIn: number
    heightIn: number
    marginTopIn: number
    marginBottomIn: number
    marginLeftIn: number
    marginRightIn: number
  }
  styles: Record<ManuscriptStyleKey, ManuscriptStyle>
  // Text rendered on a section-break line ("* * *", "⁂", …). Empty string
  // renders the break as a small vertical gap, matching the author's docs.
  sectionBreakText: string
  // Alternating running heads: odd pages show the book title, even pages
  // the author (pseudonym when enabled).
  runningHeaders: boolean
  pageNumbers: boolean
}

const SETTINGS_PATH = path.join(process.cwd(), 'data', 'export-formatting.json')

export const EXPORT_FORMATTING_DEFAULTS: ExportFormatting = {
  page: {
    widthIn: 5.5,
    heightIn: 8.5,
    marginTopIn: 1,
    marginBottomIn: 1,
    marginLeftIn: 0.75,
    marginRightIn: 0.5,
  },
  styles: {
    chapter:      { font: 'Roboto Bold',          sizePt: 30, color: '#a0a8ab', align: 'center',  spaceAfterPt: 0,  lineSpacing: 1.1, letterSpacingPt: 1.15 },
    pov:          { font: 'Charter Roman',        sizePt: 12, color: '#b42029', align: 'center',  spaceAfterPt: 10, lineSpacing: 1.1 },
    date:         { font: 'Charter Roman',        sizePt: 11, color: '#535e64', align: 'left',    spaceAfterPt: 0,  lineSpacing: 1.1 },
    body:         { font: 'Charter Roman',        sizePt: 11, color: '#000000', align: 'justify', spaceAfterPt: 0,  lineSpacing: 1.1, firstLineIndentIn: 0.25 },
    sectionBreak: { font: 'Charter Roman',        sizePt: 5,  color: '#5e5e5e', align: 'center',  spaceAfterPt: 0,  lineSpacing: 1.1, letterSpacingPt: 0.15 },
    footnote:     { font: 'Charter Roman',        sizePt: 10, color: '#000000', align: 'left',    spaceAfterPt: 0,  lineSpacing: 1.1 },
    header:       { font: 'Avenir Next Regular',  sizePt: 8,  color: '#000000', align: 'center',  spaceAfterPt: 9,  lineSpacing: 1.1 },
  },
  sectionBreakText: '',
  runningHeaders: true,
  pageNumbers: true,
}

function mergeStyles(saved: Partial<Record<ManuscriptStyleKey, Partial<ManuscriptStyle>>> | undefined) {
  const out = {} as Record<ManuscriptStyleKey, ManuscriptStyle>
  for (const key of Object.keys(EXPORT_FORMATTING_DEFAULTS.styles) as ManuscriptStyleKey[]) {
    out[key] = { ...EXPORT_FORMATTING_DEFAULTS.styles[key], ...(saved?.[key] ?? {}) }
  }
  return out
}

export async function readExportFormatting(): Promise<ExportFormatting> {
  try {
    const raw = await readFile(SETTINGS_PATH, 'utf-8')
    const parsed = JSON.parse(raw) as Partial<ExportFormatting>
    return {
      ...EXPORT_FORMATTING_DEFAULTS,
      ...parsed,
      page: { ...EXPORT_FORMATTING_DEFAULTS.page, ...(parsed.page ?? {}) },
      styles: mergeStyles(parsed.styles),
    }
  } catch {
    return {
      ...EXPORT_FORMATTING_DEFAULTS,
      page: { ...EXPORT_FORMATTING_DEFAULTS.page },
      styles: mergeStyles(undefined),
    }
  }
}

export async function writeExportFormatting(settings: ExportFormatting): Promise<void> {
  await mkdir(path.dirname(SETTINGS_PATH), { recursive: true })
  await writeFile(SETTINGS_PATH, JSON.stringify(settings, null, 2), 'utf-8')
}
