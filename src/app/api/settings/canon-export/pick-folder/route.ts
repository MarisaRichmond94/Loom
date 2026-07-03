import { NextResponse } from 'next/server'
import { execFile } from 'child_process'
import { promisify } from 'util'

const execFileAsync = promisify(execFile)

export async function POST() {
  try {
    const { stdout } = await execFileAsync('osascript', [
      '-e',
      'POSIX path of (choose folder with prompt "Select the folder that holds your book folders")',
    ])
    // choose folder returns a trailing slash; strip it so the stored path
    // joins cleanly.
    const folder = stdout.trim().replace(/\/$/, '')
    return NextResponse.json({ folder })
  } catch {
    // User cancelled the dialog — not an error
    return NextResponse.json({ folder: null })
  }
}
