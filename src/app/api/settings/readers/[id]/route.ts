import { NextResponse } from 'next/server'
import { listReaders, renameReader, setReaderDisabled } from '@shared/readerDb'
import { readerDb } from '@/lib/readerInvites'

/**
 * Rename and revoke (LOOM-132).
 *
 * Renaming NEVER touches the token: the link has already been sent, and
 * "Mom" becoming "Mum" must not silently lock her out.
 *
 * Disabling is the revocation path, and it is reversible on purpose. There is
 * no delete here — a deleted row frees its token to be reissued and strands a
 * link already in someone's inbox, where `disabled` stops it dead on the next
 * request and can be undone if it was a mistake.
 */
export async function PATCH(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params
  const body = await req.json().catch(() => ({})) as {
    displayName?: string
    disabled?: boolean
  }

  const db = readerDb()
  if (!listReaders(db).some(r => r.id === id)) {
    return NextResponse.json({ error: 'No such reader.' }, { status: 404 })
  }

  if (typeof body.displayName === 'string') {
    const name = body.displayName.trim()
    if (!name) return NextResponse.json({ error: 'A reader needs a name.' }, { status: 400 })
    renameReader(db, id, name)
  }

  if (typeof body.disabled === 'boolean') {
    setReaderDisabled(db, id, body.disabled)
  }

  const updated = listReaders(db).find(r => r.id === id)!
  return NextResponse.json({
    reader: {
      id: updated.id,
      displayName: updated.displayName,
      disabled: !!updated.disabled,
      createdAt: updated.createdAt,
      lastSeenAt: updated.lastSeenAt,
    },
  })
}
