export function formatPinTime(seconds: number): string {
  const m = Math.floor(seconds / 60)
  const s = seconds % 60
  return `${m}:${String(s).padStart(2, '0')}`
}

export function parsePinTime(input: string): number | null {
  const trimmed = input.trim()
  if (!trimmed) return null
  if (trimmed.includes(':')) {
    const [m, s] = trimmed.split(':')
    const minutes = parseInt(m, 10)
    const seconds = parseInt(s, 10)
    if (isNaN(minutes) || isNaN(seconds) || seconds < 0 || seconds >= 60 || minutes < 0) return null
    return minutes * 60 + seconds
  }
  const n = parseInt(trimmed, 10)
  if (isNaN(n) || n < 0) return null
  return n
}

export function pinLabel(pinStart: number | null | undefined, pinEnd: number | null | undefined): string | null {
  const hasStart = pinStart != null
  const hasEnd = pinEnd != null
  if (!hasStart && !hasEnd) return null
  if (hasStart && hasEnd) return `Plays ${formatPinTime(pinStart!)} – ${formatPinTime(pinEnd!)}`
  if (hasStart) return `Plays from ${formatPinTime(pinStart!)}`
  return `Plays until ${formatPinTime(pinEnd!)}`
}
