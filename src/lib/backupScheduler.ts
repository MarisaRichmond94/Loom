import cron, { type ScheduledTask } from 'node-cron'
import { readBackupSettings } from '@/lib/backupSettings'
import { runBackup } from '@/lib/backup'

let currentTask: ScheduledTask | null = null

function timeToCron(time: string): string {
  const [h, m] = time.split(':').map(Number)
  return `${m ?? 0} ${h ?? 22} * * *`
}

export async function scheduleBackup() {
  const settings = await readBackupSettings()

  if (currentTask) {
    currentTask.stop()
    currentTask = null
  }

  if (!settings.enabled || !settings.folder) return

  const expression = timeToCron(settings.time)
  currentTask = cron.schedule(expression, async () => {
    console.log('[Loom] Running scheduled backup…')
    const result = await runBackup()
    console.log(`[Loom] Backup result: ${result.message}`)
  })

  console.log(`[Loom] Backup scheduled at ${settings.time} (cron: ${expression})`)
}

export async function rescheduleBackup() {
  await scheduleBackup()
}
