import { readFile, writeFile, mkdir } from 'fs/promises'
import path from 'path'

export type BackupSettings = {
  enabled: boolean
  folder: string
  time: string        // "HH:MM" 24-hour
  retentionDays: number
}

const SETTINGS_PATH = path.join(process.cwd(), 'data', 'backup-settings.json')

const DEFAULTS: BackupSettings = {
  enabled: false,
  folder: '',
  time: '22:30',
  retentionDays: 30,
}

export async function readBackupSettings(): Promise<BackupSettings> {
  try {
    const raw = await readFile(SETTINGS_PATH, 'utf-8')
    return { ...DEFAULTS, ...JSON.parse(raw) }
  } catch {
    return { ...DEFAULTS }
  }
}

export async function writeBackupSettings(settings: BackupSettings): Promise<void> {
  await mkdir(path.dirname(SETTINGS_PATH), { recursive: true })
  await writeFile(SETTINGS_PATH, JSON.stringify(settings, null, 2), 'utf-8')
}
