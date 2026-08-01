'use client'

// A writer-character's portrait, or their initials (LOOM-32 / LOOM-33).
//
// Extracted rather than copied a third time: the Events tab, the Characters
// tab and the relationship table all show the same faces, and three
// implementations of "fall back to initials" is three chances for them to
// disagree about what happens when a photo is missing.

/**
 * WriteAI's own photo path → Loom's proxy.
 *
 * The stored value is `/api/plan/photos/<file>`, served by WriteAI. Rewriting
 * it keeps the browser talking only to Loom, and the proxy preserves the
 * deliberate `Cache-Control: no-cache` that makes a re-uploaded portrait
 * actually appear — one stable filename per character, overwritten in place.
 */
export function characterPhotoHref(photoUrl: string | null | undefined): string | null {
  const file = photoUrl?.split('/').pop()
  return file ? `/api/writeai/photo/${file}` : null
}

export function CharacterAvatar({
  name,
  src,
  size = 40,
}: {
  name: string
  /** Already resolved through characterPhotoHref. */
  src?: string | null
  size?: number
}) {
  const initials = name
    .split(/\s+/)
    .slice(0, 2)
    .map(part => part[0]?.toUpperCase() ?? '')
    .join('')

  return src ? (
    // Plain <img>: these are proxied from WriteAI at an arbitrary path, which
    // next/image would want configured up front, and they are thumbnails.
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src={src}
      alt=""
      style={{ width: size, height: size }}
      className="shrink-0 rounded-full object-cover"
    />
  ) : (
    <span
      style={{ width: size, height: size, fontSize: Math.max(9, Math.round(size * 0.28)) }}
      className="grid shrink-0 place-items-center rounded-full bg-accent/15 font-semibold text-accent"
    >
      {initials}
    </span>
  )
}
