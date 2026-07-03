import { NextResponse } from 'next/server'
import { execFile } from 'child_process'
import { promisify } from 'util'

const execFileAsync = promisify(execFile)

export async function POST() {
  try {
    const { stdout } = await execFileAsync('osascript', [
      '-e',
      'POSIX path of (choose file with prompt "Select your Pages manuscript template" of type {"com.apple.iwork.pages.sffpages", "com.apple.iwork.pages.pages"})',
    ])
    return NextResponse.json({ file: stdout.trim() })
  } catch {
    // User cancelled the dialog — not an error
    return NextResponse.json({ file: null })
  }
}
