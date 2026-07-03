import { execFile } from 'child_process'
import { promisify } from 'util'

const execFileAsync = promisify(execFile)

// Drives the local Pages.app over AppleScript. Loom runs on the author's
// Mac, so a generated .docx can be handed to Pages and saved as a true
// .pages file (and an uploaded .pages front matter converted the other
// way). Both verified non-interactive; Pages briefly opens the document
// in the background while converting.

function appleScriptString(p: string): string {
  return `"${p.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`
}

async function runOsascript(script: string): Promise<void> {
  try {
    await execFileAsync('osascript', ['-e', script], { timeout: 120_000 })
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    throw new Error(`Pages conversion failed — is Pages installed and allowed to be automated? (${message})`)
  }
}

export async function docxToPages(docxPath: string, pagesPath: string): Promise<void> {
  await runOsascript(
    'tell application "Pages"\n' +
    `  set theDoc to open POSIX file ${appleScriptString(docxPath)}\n` +
    `  save theDoc in POSIX file ${appleScriptString(pagesPath)}\n` +
    '  close theDoc saving no\n' +
    'end tell',
  )
}

export async function pagesToDocx(pagesPath: string, docxPath: string): Promise<void> {
  await runOsascript(
    'tell application "Pages"\n' +
    `  set theDoc to open POSIX file ${appleScriptString(pagesPath)}\n` +
    `  export theDoc to POSIX file ${appleScriptString(docxPath)} as Microsoft Word\n` +
    '  close theDoc saving no\n' +
    'end tell',
  )
}
