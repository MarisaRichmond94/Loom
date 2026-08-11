import { readFile, writeFile, mkdir } from 'fs/promises'
import path from 'path'

// Settings for the chapter editor's right-hand dock (LOOM-138). Mirrors the
// backup-settings file pattern: one small JSON blob under data/.

export type PanelSettings = {
  // Whether the Comments tab appears in the dock at all. On by default — the
  // toggle exists for writers who don't take reader comments, not as a
  // starter state.
  commentsTabEnabled: boolean
}

const SETTINGS_PATH = path.join(process.cwd(), 'data', 'panel.json')

const DEFAULTS: PanelSettings = {
  commentsTabEnabled: true,
}

export async function readPanelSettings(): Promise<PanelSettings> {
  try {
    const raw = await readFile(SETTINGS_PATH, 'utf-8')
    return { ...DEFAULTS, ...JSON.parse(raw) }
  } catch {
    return { ...DEFAULTS }
  }
}

export async function writePanelSettings(settings: PanelSettings): Promise<void> {
  await mkdir(path.dirname(SETTINGS_PATH), { recursive: true })
  await writeFile(SETTINGS_PATH, JSON.stringify(settings, null, 2), 'utf-8')
}
