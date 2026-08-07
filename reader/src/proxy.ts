import { NextResponse } from 'next/server'
import type { NextRequest } from 'next/server'

/**
 * The outer gate (LOOM-132).
 *
 * `proxy.ts`, not `middleware.ts` — the middleware convention is deprecated and
 * renamed as of Next 16.
 *
 * DELIBERATELY DUMB. It answers one question — is there a reader cookie at all?
 * — and nothing else. It does not resolve the token, because the Next docs are
 * explicit that proxy should not rely on shared modules, and because a database
 * handle opened out here would be a second connection on a different lifecycle
 * from the app's.
 *
 * So this is NOT the enforcement. It is a fast path that turns away visitors
 * carrying nothing at all, and a backstop for any route added later whose
 * author forgets the check. The real decision — is this token known, is this
 * reader revoked — happens in `requireReader()`, per request, against
 * `reader.db`. A cookie is necessary here and sufficient nowhere.
 */

const COOKIE = 'loom-reader'

export function proxy(request: NextRequest) {
  if (request.cookies.has(COOKIE)) return NextResponse.next()
  return NextResponse.redirect(new URL('/invite', request.url), 303)
}

export const config = {
  // Everything except the invite link itself, the page it lands on, and the
  // framework's own assets. `/r/:token*` MUST be excluded or enrolment could
  // never happen — the visitor has no cookie yet, by definition.
  //
  // `api/media` is excluded too, but for the opposite reason: it IS gated, by
  // its own check, and it answers <img> and <audio>. Redirecting those to an
  // HTML page produces a broken asset with a misleading status, so that route
  // returns its own 404 instead.
  matcher: ['/((?!r/|invite|api/media/|_next/|favicon.ico|loom-logo.svg).*)'],
}
