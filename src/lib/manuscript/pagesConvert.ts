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

// A bare `tell application "Pages"` implicitly launches Pages, but the first
// Apple Event can arrive before Pages finishes starting and bounce with -600
// (procNotFound, "Application isn't running"). Launch explicitly and wait for
// the process before sending real events. `is running` is answered by Launch
// Services, not the app, so the poll itself can't race.
const LAUNCH_PREAMBLE =
  'tell application "Pages" to launch\n' +
  'repeat 50 times\n' +
  '  if application "Pages" is running then exit repeat\n' +
  '  delay 0.2\n' +
  'end repeat\n'

// Pages handles one scripter at a time poorly; overlapping conversions (an
// autosave firing during an export) are the other source of -600. Funnel
// every script through a single queue.
let pagesQueue: Promise<unknown> = Promise.resolve()

function enqueue<T>(fn: () => Promise<T>): Promise<T> {
  const run = pagesQueue.then(fn, fn)
  pagesQueue = run.catch(() => {})
  return run
}

async function runOsascript(script: string): Promise<void> {
  const attempts = 3
  for (let attempt = 1; ; attempt++) {
    try {
      await execFileAsync('osascript', ['-e', LAUNCH_PREAMBLE + script], { timeout: 120_000 })
      return
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      // -600 is transient (Pages mid-launch or mid-relaunch); back off and retry.
      if (/-600/.test(message) && attempt < attempts) {
        await new Promise((resolve) => setTimeout(resolve, attempt * 1000))
        continue
      }
      // -1743 means macOS blocked the Apple Event: the app that launched
      // this server (Terminal, VS Code, a Dock launcher .app) needs Automation
      // permission for Pages, and launcher bundles must declare
      // NSAppleEventsUsageDescription in their Info.plist to even be prompted.
      const hint = /-1743/.test(message)
        ? ' macOS blocked the automation: grant the app that launched Loom access to Pages under System Settings → Privacy & Security → Automation.'
        : /-600/.test(message)
          ? ' Pages never finished launching — open Pages manually once, then retry.'
          : ''
      throw new Error(`Pages conversion failed — is Pages installed and allowed to be automated?${hint} (${message})`)
    }
  }
}

export async function docxToPages(docxPath: string, pagesPath: string): Promise<void> {
  await enqueue(() => runOsascript(
    'tell application "Pages"\n' +
    `  set theDoc to open POSIX file ${appleScriptString(docxPath)}\n` +
    `  save theDoc in POSIX file ${appleScriptString(pagesPath)}\n` +
    '  close theDoc saving no\n' +
    'end tell',
  ))
}

export async function pagesToDocx(pagesPath: string, docxPath: string): Promise<void> {
  await enqueue(() => runOsascript(
    'tell application "Pages"\n' +
    `  set theDoc to open POSIX file ${appleScriptString(pagesPath)}\n` +
    `  export theDoc to POSIX file ${appleScriptString(docxPath)} as Microsoft Word\n` +
    '  close theDoc saving no\n' +
    'end tell',
  ))
}
