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
// (procNotFound, "Application isn't running"). Worse, Pages opts into macOS
// automatic termination: with no windows open (exactly the state each
// conversion leaves it in) the OS silently kills the process, while Launch
// Services keeps reporting it as running — so an `is running` poll passes
// against a corpse and the real event still bounces -600. The only reliable
// readiness signal is Pages answering an actual Apple Event, so poll with
// `get version` and keep re-nudging `launch` until it answers (~15s max).
const LAUNCH_PREAMBLE =
  'tell application "Pages" to launch\n' +
  'repeat 60 times\n' +
  '  try\n' +
  '    tell application "Pages" to get version\n' +
  '    exit repeat\n' +
  '  on error\n' +
  '    try\n' +
  '      tell application "Pages" to launch\n' +
  '    end try\n' +
  '    delay 0.25\n' +
  '  end try\n' +
  'end repeat\n'

// Pages handles one scripter at a time poorly; overlapping conversions (an
// autosave firing during an export) are the other source of -600. Funnel
// every script through a single queue. The queue lives on globalThis
// because dev-mode HMR re-instantiates this module per recompiled route —
// a module-local queue would let scripts from different route bundles
// overlap despite the queue.
const g = globalThis as typeof globalThis & { __loomPagesQueue?: Promise<unknown> }

function enqueue<T>(fn: () => Promise<T>): Promise<T> {
  const prev = g.__loomPagesQueue ?? Promise.resolve()
  const run = prev.then(fn, fn)
  g.__loomPagesQueue = run.catch(() => {})
  return run
}

// Transient Apple Event failures worth retrying: -600 (Pages mid-launch or
// mid-relaunch), -609 (connection dropped — Pages quit or crashed between
// events), -1712 (event timed out — Pages busy with a modal or a huge doc),
// -10810 (Launch Services failed to start the app). A killed osascript
// (execFile timeout) is retried too — Pages was likely wedged and the
// relaunch preamble recovers it.
function isTransient(err: unknown): boolean {
  const message = err instanceof Error ? err.message : String(err)
  if (/-600|-609|-1712|-10810/.test(message)) return true
  return typeof err === 'object' && err !== null && 'killed' in err && (err as { killed?: boolean }).killed === true
}

async function runOsascript(script: string): Promise<void> {
  const attempts = 4
  for (let attempt = 1; ; attempt++) {
    try {
      await execFileAsync('osascript', ['-e', LAUNCH_PREAMBLE + script], { timeout: 120_000 })
      return
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      if (isTransient(err) && attempt < attempts) {
        await new Promise((resolve) => setTimeout(resolve, attempt * 1500))
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
