import { NextResponse } from 'next/server'
import { createReader, listReaders, type Reader } from '@shared/readerDb'
import {
  readReaderInviteSettings,
  readerDb,
  writeReaderInviteSettings,
} from '@/lib/readerInvites'

/**
 * The author's readers list (LOOM-132).
 *
 * NO TOKENS IN THIS RESPONSE. A token is a reusable bearer credential — whoever
 * holds the link is that person — so the list that renders on screen carries
 * none of them. Copying a link asks for that one token, at that moment
 * (`[id]/link`). The cost is one extra request per copy; what it buys is that a
 * screenshot of this page leaks nothing, and no window exists where every
 * invite in the household is sitting in a browser tab's memory.
 */

/**
 * A reader as the settings UI sees one: everything except the secret.
 *
 * Spelled out rather than `Omit<Reader, 'token'> & { disabled: boolean }` —
 * `Reader.disabled` is SQLite's 0/1 number, and intersecting that with boolean
 * collapses the whole field to `never`.
 */
type ReaderView = {
  id: string
  displayName: string
  disabled: boolean
  createdAt: string
  lastSeenAt: string | null
}

const view = (r: Reader): ReaderView => ({
  id: r.id,
  displayName: r.displayName,
  // SQLite has no boolean; the UI should not have to know that.
  disabled: !!r.disabled,
  createdAt: r.createdAt,
  lastSeenAt: r.lastSeenAt,
})

export async function GET() {
  return NextResponse.json({
    readers: listReaders(readerDb()).map(view),
    settings: await readReaderInviteSettings(),
  })
}

export async function POST(req: Request) {
  const body = await req.json().catch(() => ({})) as { displayName?: string; baseUrl?: string }

  // Doubles as the settings endpoint for the base URL, so the section has one
  // place to write to rather than two half-related routes.
  if (typeof body.baseUrl === 'string') {
    const baseUrl = body.baseUrl.trim()
    if (!baseUrl) return NextResponse.json({ error: 'A base URL is required.' }, { status: 400 })
    await writeReaderInviteSettings({ baseUrl })
    return NextResponse.json({ settings: await readReaderInviteSettings() })
  }

  const displayName = (body.displayName ?? '').trim()
  if (!displayName) {
    return NextResponse.json({ error: 'A reader needs a name.' }, { status: 400 })
  }

  const reader = createReader(readerDb(), displayName)
  // Deliberately returns the VIEW, not the reader: even here, freshly created,
  // the token goes back through the same on-demand door as every other one.
  return NextResponse.json({ reader: view(reader) }, { status: 201 })
}
