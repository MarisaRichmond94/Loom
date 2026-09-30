// Ownership of the read-aloud voice (⌥⇧R), shared by the TextBlock extension
// that starts a read and the author layout that can stop one from anywhere on
// the page. speechSynthesis is a window singleton, so exactly one place has to
// know whose read is playing.
//
// WHY NOT speechSynthesis.speaking
// `speaking` is the *engine's* flag, and the engine can lose an utterance
// without ever firing `end` or `error` — Chrome does it when the utterance
// object is garbage-collected mid-read, and on some text it just gives up.
// The flag is then stuck true, and `cancel()` does not reset it; because the
// state lives in the browser process rather than the document, reloading the
// page does not clear it either. Any handler that reads `speaking` to mean
// "a read is in progress, so cancel it" becomes a permanent no-op at that
// point: ⌥⇧R can never start a read again for the life of the browser. That
// is the bug this module exists to make impossible.
//
// So: ownership is tracked here in JS, where we control every transition; the
// utterance is held in a module-level variable so it cannot be collected while
// it is being spoken; a watchdog notices a read the engine dropped silently;
// and stopRead() always clears ownership, so at worst a stuck engine costs one
// keypress instead of the whole feature.

let owner: unknown = null
// Strong reference only — never read. Chrome collects an utterance that
// nothing but its own event handlers point at, which kills the read mid-word.
let active: SpeechSynthesisUtterance | null = null
let cleanup: (() => void) | null = null
let watchdog: ReturnType<typeof setInterval> | null = null

function clearWatchdog() {
  if (watchdog !== null) { clearInterval(watchdog); watchdog = null }
}

/** Whose read is in flight, or null if none is. */
export function readOwner(): unknown {
  return owner
}

/**
 * Take ownership of the synthesizer for `by`, immediately before speak().
 *
 * `onDone` releases whatever the read set up (highlight, transaction
 * tracking). It runs when the read ends for any reason — including the
 * watchdog noticing the engine dropped the utterance with no `end` event —
 * so it must be safe to run more than once.
 */
export function claimRead(by: unknown, utterance: SpeechSynthesisUtterance, onDone: () => void) {
  owner = by
  active = utterance
  cleanup = onDone
  clearWatchdog()
  // Two consecutive idle ticks, so the poll can't mistake the gap between
  // speak() and the engine actually starting for a finished read.
  let idle = 0
  watchdog = setInterval(() => {
    const synth = typeof window === 'undefined' ? null : window.speechSynthesis
    if (!synth) { clearWatchdog(); return }
    if (synth.speaking || synth.pending) { idle = 0; return }
    if (++idle < 2) return
    const done = cleanup
    releaseRead(by)
    done?.()
  }, 1000)
}

/** Drop ownership after a clean end. A no-op for a read we no longer own. */
export function releaseRead(by: unknown) {
  if (owner !== by) return
  owner = null
  active = null
  cleanup = null
  clearWatchdog()
}

/**
 * Stop the read in flight, and return whether there was one.
 *
 * Ownership is cleared before cancel() rather than in response to it, because
 * the `end` event cancel() is supposed to fire is exactly the event a stranded
 * engine withholds.
 */
export function stopRead(): boolean {
  const had = owner !== null
  const done = cleanup
  owner = null
  active = null
  cleanup = null
  clearWatchdog()
  if (typeof window !== 'undefined') window.speechSynthesis?.cancel()
  if (had) done?.()
  return had
}

/**
 * Clear a queue the engine is holding from an earlier read — one page's
 * utterances outlive that page — so a fresh speak() isn't ignored. Guarded on
 * the engine claiming to be busy: cancel() immediately before speak() can
 * swallow the new utterance in Chrome, so we only pay that risk when there is
 * actually something to flush.
 */
export function flushStrandedRead() {
  const synth = typeof window === 'undefined' ? null : window.speechSynthesis
  if (!synth) return
  if (synth.speaking || synth.pending) synth.cancel()
}
