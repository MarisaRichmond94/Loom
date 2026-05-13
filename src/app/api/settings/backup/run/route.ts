import { NextResponse } from 'next/server'
import { runBackup } from '@/lib/backup'

export async function POST() {
  const result = await runBackup()
  return NextResponse.json(result)
}
