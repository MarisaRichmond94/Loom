// The read-aloud (⌥⇧R) lockout regression. A read that the engine drops
// without firing `end` used to leave `speechSynthesis.speaking` stuck true,
// and because both ⌥⇧R handlers read that flag to decide "a read is in
// progress, so cancel it", the hotkey became a permanent no-op — through page
// reloads, because the stuck flag lives in the browser process. These tests
// pin the properties that make that unreachable: ownership is ours, not the
// engine's, and stopRead always clears it.

type FakeSynth = {
  speaking: boolean
  pending: boolean
  cancel: jest.Mock
  speak: jest.Mock
}

let synth: FakeSynth
let state: typeof import('@/lib/narration/readAloudState')

function utter(): SpeechSynthesisUtterance {
  return {} as SpeechSynthesisUtterance
}

beforeEach(() => {
  jest.useFakeTimers()
  jest.resetModules()
  synth = { speaking: false, pending: false, cancel: jest.fn(), speak: jest.fn() }
  // The module reads window.speechSynthesis lazily, so a plain global is enough.
  ;(globalThis as { window?: unknown }).window = { speechSynthesis: synth }
  state = require('@/lib/narration/readAloudState')
})

afterEach(() => {
  jest.useRealTimers()
  delete (globalThis as { window?: unknown }).window
})

test('no read is owned before one starts', () => {
  expect(state.readOwner()).toBeNull()
})

test('claimRead takes ownership for the claiming editor only', () => {
  const editor = {}
  state.claimRead(editor, utter(), () => {})
  expect(state.readOwner()).toBe(editor)
  state.releaseRead({})
  expect(state.readOwner()).toBe(editor)
  state.releaseRead(editor)
  expect(state.readOwner()).toBeNull()
})

test('stopRead cancels, runs cleanup, and reports that it stopped something', () => {
  const done = jest.fn()
  synth.speaking = true
  state.claimRead({}, utter(), done)
  expect(state.stopRead()).toBe(true)
  expect(synth.cancel).toHaveBeenCalled()
  expect(done).toHaveBeenCalledTimes(1)
  expect(state.readOwner()).toBeNull()
})

test('stopRead clears ownership even when the engine reports it is still speaking', () => {
  // The lockout: cancel() does not always reset `speaking`. Ownership must not
  // be conditional on the engine agreeing that the read is over, or the next
  // ⌥⇧R has nothing to stop and still refuses to start.
  state.claimRead({}, utter(), () => {})
  synth.speaking = true
  state.stopRead()
  expect(state.readOwner()).toBeNull()
})

test('stopRead on an idle synthesizer is a no-op that reports nothing stopped', () => {
  expect(state.stopRead()).toBe(false)
})

test('the watchdog releases a read the engine dropped without an end event', () => {
  const done = jest.fn()
  synth.speaking = true
  state.claimRead({}, utter(), done)

  // Still speaking: nothing happens, however long it runs.
  jest.advanceTimersByTime(5000)
  expect(state.readOwner()).not.toBeNull()
  expect(done).not.toHaveBeenCalled()

  // The utterance vanishes with no `end`/`error` — the case that stranded the
  // old code. One idle tick is not enough (speak() to first audio is a gap).
  synth.speaking = false
  jest.advanceTimersByTime(1000)
  expect(state.readOwner()).not.toBeNull()
  jest.advanceTimersByTime(1000)
  expect(state.readOwner()).toBeNull()
  expect(done).toHaveBeenCalledTimes(1)
})

test('a brief dip to idle right after speak does not end the read', () => {
  const done = jest.fn()
  state.claimRead({}, utter(), done)
  jest.advanceTimersByTime(1000) // one idle tick
  synth.speaking = true          // engine got going
  jest.advanceTimersByTime(10000)
  expect(state.readOwner()).not.toBeNull()
  expect(done).not.toHaveBeenCalled()
})

test('a clean release stops the watchdog, so cleanup never runs twice', () => {
  const done = jest.fn()
  const editor = {}
  state.claimRead(editor, utter(), done)
  state.releaseRead(editor) // utterance.onend
  jest.advanceTimersByTime(10000)
  expect(done).not.toHaveBeenCalled()
})

test('flushStrandedRead cancels only when the engine claims to be busy', () => {
  state.flushStrandedRead()
  expect(synth.cancel).not.toHaveBeenCalled()
  synth.pending = true
  state.flushStrandedRead()
  expect(synth.cancel).toHaveBeenCalledTimes(1)
})
