'use client'

// Tiny alert chime for events worth hearing from another tab (a finished
// review, say). Synthesized via Web Audio instead of shipping an asset —
// two short tones is enough to be noticeable without being obnoxious.
export function playChime() {
  if (typeof window === 'undefined') return
  const Ctx = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext
  if (!Ctx) return

  const ctx = new Ctx()
  const playTone = (freq: number, startOffset: number, duration: number) => {
    const osc = ctx.createOscillator()
    const gain = ctx.createGain()
    osc.type = 'sine'
    osc.frequency.value = freq
    const startAt = ctx.currentTime + startOffset
    gain.gain.setValueAtTime(0, startAt)
    gain.gain.linearRampToValueAtTime(0.2, startAt + 0.02)
    gain.gain.exponentialRampToValueAtTime(0.001, startAt + duration)
    osc.connect(gain)
    gain.connect(ctx.destination)
    osc.start(startAt)
    osc.stop(startAt + duration)
  }

  playTone(880, 0, 0.15)
  playTone(1175, 0.12, 0.2)

  setTimeout(() => ctx.close(), 500)
}
