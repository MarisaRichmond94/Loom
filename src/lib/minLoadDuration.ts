// Pads short loads so loading skeletons don't flash on/off too quickly.
// Pass the timestamp captured at the start of the load; this resolves when
// at least `minMs` milliseconds have elapsed since that start.
export async function ensureMinDuration(start: number, minMs: number = 1000): Promise<void> {
  const elapsed = Date.now() - start
  if (elapsed >= minMs) return
  await new Promise(r => setTimeout(r, minMs - elapsed))
}
