import { NextResponse } from 'next/server'
import { readBackupSettings, writeBackupSettings } from '@/lib/backupSettings'
import { rescheduleBackup } from '@/lib/backupScheduler'

export async function GET() {
  const settings = await readBackupSettings()
  return NextResponse.json(settings)
}

export async function PATCH(req: Request) {
  const body = await req.json()
  const current = await readBackupSettings()
  const updated = { ...current, ...body }
  await writeBackupSettings(updated)
  await rescheduleBackup()
  return NextResponse.json(updated)
}
