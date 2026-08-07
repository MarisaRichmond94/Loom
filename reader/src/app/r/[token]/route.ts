import { NextResponse } from 'next/server'
import { markSeen, READER_COOKIE, READER_COOKIE_MAX_AGE, redeemToken } from '@/lib/readers'

/**
 * The invite link: `/r/<token>` (LOOM-132).
 *
 * Opening it once per browser is the entire enrolment. The token is exchanged
 * for a cookie and the visitor is redirected to the catalog, so the token stops
 * appearing in the address bar immediately afterwards.
 *
 * A KNOWN PROPERTY, recorded rather than discovered later: a token in a URL
 * path lands in browser history and in any server access log. That is accepted
 * at this scale — the tailnet is the outer boundary (LOOM-136) — but it is why
 * this route redirects rather than rendering, and why nothing here writes the
 * token to a log line.
 *
 * The redirect is 303, not the default 307. A 307 preserves the method, which
 * is meaningless here and would replay oddly if the link were ever prefetched
 * or opened by something other than a browser address bar.
 */
export async function GET(
  req: Request,
  { params }: { params: Promise<{ token: string }> },
) {
  const { token } = await params
  const reader = redeemToken(decodeURIComponent(token ?? ''))

  // Unknown and revoked land in the same place, but for different reasons:
  // unknown must not confirm which guess was closer, and revoked is a state the
  // author chose. `?revoked` is a hint for the page's wording, not a claim the
  // page needs to trust — the cookie is never set on either path.
  if (!reader) return NextResponse.redirect(new URL('/invite', req.url), 303)
  if (reader.disabled) return NextResponse.redirect(new URL('/invite?revoked=1', req.url), 303)

  markSeen(reader.id)

  const res = NextResponse.redirect(new URL('/', req.url), 303)
  res.cookies.set(READER_COOKIE, reader.token, {
    httpOnly: true,      // page scripts cannot read it
    sameSite: 'lax',     // survives following a link in, blocks cross-site POSTs
    path: '/',
    maxAge: READER_COOKIE_MAX_AGE,
    // Not `secure`: the tailnet serves this over plain HTTP, and a secure
    // cookie would simply never be stored — locking every reader out. Revisit
    // with LOOM-136 if TLS lands there.
    secure: false,
  })
  return res
}
