import { readFile, writeFile, mkdir } from 'fs/promises'
import { homedir } from 'os'
import path from 'path'

// Where the ⌥⇧E canon save lands. One JSON blob under data/, mirroring the
// export-formatting pattern. `root` holds one folder per book named
// "<n>. <Book Title>"; `subfolder` is the folder inside the matched book
// folder to save into — empty string means the book folder itself.

export type CanonExportSettings = {
  root: string
  subfolder: string
}

const SETTINGS_PATH = path.join(process.cwd(), 'data', 'canon-export-settings.json')

export function canonExportDefaults(): CanonExportSettings {
  return { root: path.join(homedir(), 'Writing'), subfolder: 'Versions' }
}

export async function readCanonExportSettings(): Promise<CanonExportSettings> {
  const defaults = canonExportDefaults()
  try {
    const raw = await readFile(SETTINGS_PATH, 'utf-8')
    const parsed = JSON.parse(raw) as Partial<CanonExportSettings>
    return {
      root: typeof parsed.root === 'string' && parsed.root.trim() ? parsed.root : defaults.root,
      subfolder: typeof parsed.subfolder === 'string' ? parsed.subfolder : defaults.subfolder,
    }
  } catch {
    return defaults
  }
}

export async function writeCanonExportSettings(settings: CanonExportSettings): Promise<void> {
  await mkdir(path.dirname(SETTINGS_PATH), { recursive: true })
  await writeFile(SETTINGS_PATH, JSON.stringify(settings, null, 2), 'utf-8')
}
