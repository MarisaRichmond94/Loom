// Soundtrack block titles are free text (ContentBlock.prompt), but Marisa
// names them "<Song Name> - <Artist>" by convention. Split on the FIRST
// " - " rather than the last: song names occasionally contain their own
// hyphens, but the artist half never does in her library.
export function parseSoundtrackName(raw: string | null | undefined): { name: string; artist: string | null } {
  const trimmed = raw?.trim() || ''
  if (!trimmed) return { name: '(untitled)', artist: null }

  const sep = trimmed.indexOf(' - ')
  if (sep === -1) return { name: trimmed, artist: null }

  const name = trimmed.slice(0, sep).trim()
  const artist = trimmed.slice(sep + 3).trim()
  return { name: name || '(untitled)', artist: artist || null }
}
