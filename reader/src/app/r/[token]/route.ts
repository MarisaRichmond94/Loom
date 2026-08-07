import { NextResponse } from 'next/server'
import { api, ROOT } from '@/lib/basePath'
import { markSeen, READER_COOKIE, READER_COOKIE_MAX_AGE, redeemToken } from '@/lib/readers'

/**
 * A RELATIVE redirect, deliberately.
 *
 * `NextResponse.redirect` needs an absolute URL, and the only host this process
 * knows is its own — 127.0.0.1:3200. Behind `tailscale serve` that is the
 * INTERNAL address, so an absolute redirect sent a family member clicking their
 * invite link to localhost on their own machine. A relative Location is
 * resolved by the browser against the URL it actually requested, which is the
 * tailnet one, and needs no knowledge of how the app is reached.
 */
const seeOther = (path: string) => new NextResponse(null, {
  status: 303,
  // `|| '/'` so the app root is never an EMPTY Location header: unmounted
  // locally, api('') is the empty string.
  headers: { Location: api(path) || '/' },
})

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
  if (!reader) return seeOther('/invite')
  if (reader.disabled) return seeOther('/invite?revoked=1')

  markSeen(reader.id)

  // ROOT, so the reader lands where their cookie applies and skips a 308.
  const res = seeOther('')
  res.cookies.set(READER_COOKIE, reader.token, {
    httpOnly: true,      // page scripts cannot read it
    sameSite: 'lax',     // survives following a link in, blocks cross-site POSTs
    // SCOPED TO THIS APP'S MOUNT, not '/'. The tailnet host serves another
    // application at a different prefix, and a cookie on '/' is sent to it on
    // every request — handing a bearer token that grants access to the books
    // to an app that has no business holding one.
    //
    // ROOT, not api('/'): no trailing slash. `/loom/` would not be sent to
    // `/loom`, which is exactly where Next sends the reader next.
    path: ROOT,
    maxAge: READER_COOKIE_MAX_AGE,
    // `tailscale serve` terminates TLS, so the tailnet URL is https and the
    // cookie should never travel in clear. Browsers treat localhost as a secure
    // context, so this still works for local testing.
    secure: true,
  })
  return res
}
