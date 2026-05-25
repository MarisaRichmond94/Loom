import { readFile, writeFile, mkdir } from 'fs/promises'
import path from 'path'

// Server-side mirror of the author's display name so public preview pages
// can surface a byline regardless of which browser the reader is on.
// Mirrors the backup-settings file pattern: one JSON blob under data/.

export type ProfileSettings = {
  authorName: string
  bio: string
  // When true, the public bio uses `pseudonym` as the display name and
  // either blurs the author's photo or shows a separately uploaded one
  // (see /api/pseudonym-avatar; file existence at /pseudonym-avatar.jpg
  // is the source of truth — no field is needed on this row).
  pseudonymEnabled: boolean
  pseudonym: string
}

const SETTINGS_PATH = path.join(process.cwd(), 'data', 'profile.json')

const DEFAULTS: ProfileSettings = {
  authorName: '',
  bio: '',
  pseudonymEnabled: false,
  pseudonym: '',
}

export async function readProfileSettings(): Promise<ProfileSettings> {
  try {
    const raw = await readFile(SETTINGS_PATH, 'utf-8')
    return { ...DEFAULTS, ...JSON.parse(raw) }
  } catch {
    return { ...DEFAULTS }
  }
}

export async function writeProfileSettings(settings: ProfileSettings): Promise<void> {
  await mkdir(path.dirname(SETTINGS_PATH), { recursive: true })
  await writeFile(SETTINGS_PATH, JSON.stringify(settings, null, 2), 'utf-8')
}
