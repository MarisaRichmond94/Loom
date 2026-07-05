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
// conversion leaves it in) the OS may silently kill the process, while Launch
// Services keeps reporting it as running — so events bounce off a zombie.
// The only reliable readiness signal is Pages answering an actual Apple
// Event, so poll with `get version` and keep re-nudging `launch` until it
// answers (~15s max). The initial `launch` MUST be inside a try: against a
// zombie it throws -600 itself, and unwrapped it aborts the whole script
// before the retry loop ever runs (observed in live stress testing).
const LAUNCH_PREAMBLE =
  'try\n' +
  '  tell application "Pages" to launch\n' +
  'end try\n' +
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
const g = globalThis as typeof globalThis & {
  __loomPagesQueue?: Promise<unknown>
  __loomPagesScriptCount?: number
}

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

// Last-resort recovery for a zombie Pages (-600/-609 that survives a plain
// retry). Probe with a real event: if Pages answers, it's alive and killing
// it would be wrong (and could lose the writer's open work). If the probe
// itself errors or times out, the process is a corpse — clear it and start
// a fresh one through Launch Services (`open -ga` succeeds where a scripted
// `launch` bounces off the zombie's cached registration).
async function recoverZombiePages(): Promise<void> {
  try {
    await execFileAsync('osascript', ['-e', 'tell application "Pages" to count documents'], { timeout: 10_000 })
    return // Pages answered — alive, leave it alone
  } catch {
    await execFileAsync('killall', ['Pages']).catch(() => {})
    await new Promise((resolve) => setTimeout(resolve, 500))
    await execFileAsync('open', ['-ga', 'Pages']).catch(() => {})
  }
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
        // A -600/-609 that made it past the preamble means the zombie state
        // is sticky — recover it before burning another attempt on it.
        if (attempt >= 2 && /-600|-609/.test(message)) await recoverZombiePages()
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

// Pages accretes ~10MB RSS per scripted conversion (measured), so after a
// batch of conversions give it a fresh start — but only when the writer has
// nothing open, and only from inside the queue so the quit can never race a
// conversion (an external quit mid-script fails 100% of the time with -609).
const RESTART_EVERY = 25

async function maybeRestartPages(): Promise<void> {
  g.__loomPagesScriptCount = (g.__loomPagesScriptCount ?? 0) + 1
  if (g.__loomPagesScriptCount < RESTART_EVERY) return
  g.__loomPagesScriptCount = 0
  await execFileAsync('osascript', ['-e',
    'tell application "Pages"\n' +
    '  if (count documents) = 0 then quit\n' +
    'end tell',
  ], { timeout: 15_000 }).catch(() => {}) // best-effort; next preamble relaunches
}

// The AppleScript-side timeout must be shorter than the Node execFile
// timeout (120s): that way a stuck conversion errors cleanly as -1712 and
// retries, instead of Node SIGKILLing osascript mid-save and leaving Pages
// holding a half-open document.
function withTimeout(body: string): string {
  return 'with timeout of 90 seconds\n' + body + '\nend timeout'
}

export async function docxToPages(docxPath: string, pagesPath: string): Promise<void> {
  await enqueue(async () => {
    await runOsascript(withTimeout(
      'tell application "Pages"\n' +
      `  set theDoc to open POSIX file ${appleScriptString(docxPath)}\n` +
      `  save theDoc in POSIX file ${appleScriptString(pagesPath)}\n` +
      '  close theDoc saving no\n' +
      'end tell',
    ))
    await maybeRestartPages()
  })
}

export async function pagesToDocx(pagesPath: string, docxPath: string): Promise<void> {
  await enqueue(async () => {
    await runOsascript(withTimeout(
      'tell application "Pages"\n' +
      `  set theDoc to open POSIX file ${appleScriptString(pagesPath)}\n` +
      `  export theDoc to POSIX file ${appleScriptString(docxPath)} as Microsoft Word\n` +
      '  close theDoc saving no\n' +
      'end tell',
    ))
    await maybeRestartPages()
  })
}
