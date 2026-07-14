export async function register() {
  // Only run in Node.js runtime (not edge), and only once
  if (process.env.NEXT_RUNTIME === 'edge') return

  const { scheduleBackup } = await import('@/lib/backupScheduler')
  scheduleBackup()

  const { scheduleNarration } = await import('@/lib/narration/scheduler')
  scheduleNarration()
}
