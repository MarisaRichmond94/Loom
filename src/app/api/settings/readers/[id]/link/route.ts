import { NextResponse } from 'next/server'
import { listReaders } from '@shared/readerDb'
import { inviteUrl, readReaderInviteSettings, readerDb } from '@/lib/readerInvites'

/**
 * One reader's invite link, on demand (LOOM-132).
 *
 * The only route that ever emits a token, and it emits exactly one — the door
 * the readers list deliberately does not have. Called when the author clicks
 * Copy, so the secret is in the page for as long as it takes to reach the
 * clipboard rather than for as long as the tab is open.
 *
 * POST rather than GET: this hands out a credential, and GETs are the things
 * that get prefetched, logged with their full URL, and left in history. None of
 * that should happen to a route whose response body is an invite.
 */
export async function POST(
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params
  const reader = listReaders(readerDb()).find(r => r.id === id)
  if (!reader) return NextResponse.json({ error: 'No such reader.' }, { status: 404 })

  const { baseUrl } = await readReaderInviteSettings()
  return NextResponse.json({
    url: inviteUrl(baseUrl, reader.token),
    // So the UI can warn rather than hand over a link that will bounce.
    disabled: !!reader.disabled,
  })
}
