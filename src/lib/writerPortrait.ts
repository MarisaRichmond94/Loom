// Which portrait to show for a writer character, in which book — LOOM-87,
// under LOOM-5.
//
// The one capability Loom's native cast had that WriteAI's does not: a
// character can look different in each book. Characters age across five books,
// so one portrait for the whole series is wrong.
//
// The chain, in order:
//
//   1. Loom's per-book file   public/characters/<wc-id>-<bookId>.jpg
//   2. Loom's canonical file  public/characters/<wc-id>.jpg
//   3. WriteAI's photo        proxied via /api/writeai/photo/<file>
//
// Step 2 is vestigial by design. Loom's 36 canonical portraits were pushed
// into WriteAI rather than renamed, so the DEFAULT portrait has exactly one
// home — the Characters tab — and changing it there changes it everywhere.
// The rung is kept because it costs nothing and makes the fallback total: a
// character with a stray Loom-side file still resolves rather than showing a
// blank.

export type PortraitSource = {
  id: string
  hasBookAvatar: boolean
  hasCanonicalAvatar: boolean
  writerPhotoUrl: string | null
}

/**
 * A URL the browser can load, or null when the character has no portrait
 * anywhere.
 *
 * `cacheBust` is appended to Loom-served files only. WriteAI's own photo route
 * sets `Cache-Control: no-cache` deliberately — it overwrites portraits in
 * place under a stable filename — and that header, preserved by Loom's proxy,
 * already solves the same problem for step 3.
 */
export function writerPortraitUrl(
  character: PortraitSource,
  bookId: string | null,
  cacheBust?: number | string,
): string | null {
  const bust = cacheBust == null ? '' : `?t=${cacheBust}`

  if (bookId && character.hasBookAvatar) {
    return `/characters/${character.id}-${bookId}.jpg${bust}`
  }
  if (character.hasCanonicalAvatar) {
    return `/characters/${character.id}.jpg${bust}`
  }
  return writeAiPhotoUrl(character.writerPhotoUrl)
}

/**
 * Turn WriteAI's `photo_url` into one Loom can serve.
 *
 * WriteAI hands back paths like `/api/plan/photos/wc-abc12345.jpg` — and
 * sometimes `...jpg?v=1783028749603659541`, its own cache-buster after a
 * re-upload. Only the filename is passed to Loom's proxy (which validates it),
 * and the version query is carried over so a re-uploaded portrait still busts
 * the browser cache.
 *
 * Returns null for anything unusable rather than building a URL that would
 * 400 at the proxy.
 */
export function writeAiPhotoUrl(photoUrl: string | null): string | null {
  if (!photoUrl) return null
  const [pathPart, query] = photoUrl.split('?', 2)
  // Taking the basename would already neutralise `../../etc/passwd` into
  // `passwd`, but silently fetching a DIFFERENT file than the one asked for is
  // worse than refusing: a photo_url containing a traversal means something
  // upstream is wrong, and that should surface as a missing portrait rather
  // than a plausible-looking one.
  if (pathPart.includes('..')) return null
  const file = pathPart.split('/').pop()
  if (!file || !/^[A-Za-z0-9._-]+$/.test(file)) return null
  return `/api/writeai/photo/${file}${query ? `?${query}` : ''}`
}
