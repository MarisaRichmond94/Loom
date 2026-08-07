import { LuBookLock } from 'react-icons/lu'

/**
 * Where anyone unrecognised lands (LOOM-132).
 *
 * DELIBERATELY NOT A LOGIN FORM. There is no field here, because there is
 * nothing to type: identity comes from a link, so a form would only offer
 * something to guess at and something to phish. It also would not help the
 * person actually reading it — if they had the link they would not be here.
 *
 * It does not say what went wrong beyond revoked-versus-not. "No such token"
 * and "wrong token" are the same page on purpose.
 */
export default async function InvitePage({
  searchParams,
}: {
  searchParams: Promise<{ revoked?: string }>
}) {
  const revoked = (await searchParams).revoked === '1'

  return (
    <div className="min-h-screen bg-surface-base flex items-center justify-center px-6">
      <div className="max-w-md text-center">
        <LuBookLock size={40} className="mx-auto text-accent/70" />

        <h1 className="mt-6 text-2xl font-bold tracking-wide text-ink">
          {revoked ? 'This link is no longer active' : 'You’ll need your invite link'}
        </h1>

        <p className="mt-4 text-sm leading-relaxed text-ink-muted">
          {revoked
            ? 'The invite you used has been turned off. If that seems wrong, ask the author to send you a new one.'
            : 'These books are shared with a few people by private link. Open the link you were sent and this device will remember you.'}
        </p>

        <p className="mt-8 text-xs text-ink-faint">
          Nothing to sign in to — the link is the key.
        </p>
      </div>
    </div>
  )
}
