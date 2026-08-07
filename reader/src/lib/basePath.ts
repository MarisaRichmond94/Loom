/**
 * Where this app is mounted (LOOM-136).
 *
 * The reader is served on the tailnet under a path prefix — `/loom`, beside
 * HoneyDew at `/honey-dew` — so that nothing owns the bare `/` and adding a
 * third thing later is not a rearrangement.
 *
 * Next applies `basePath` to `next/link` and to its own asset URLs, but NOT to
 * `fetch` or `sendBeacon`. Those are ordinary browser calls with no idea the
 * app is mounted anywhere in particular, so a bare `/api/progress` would leave
 * this app entirely and land on whatever answers `/` — which is a different
 * application. Every client call therefore goes through `api()`.
 *
 * NEXT_PUBLIC_ is inlined at build time, which is also true of `basePath`
 * itself: both are baked into the bundle, so the two cannot drift apart within
 * a build.
 */
export const BASE_PATH = process.env.NEXT_PUBLIC_BASE_PATH ?? ''

/** Prefix an app-absolute path with the mount point. */
export const api = (path: string): string => `${BASE_PATH}${path}`

/**
 * The app's root, WITHOUT a trailing slash — `/loom`, or `/` when unmounted.
 *
 * `api('/')` yields `/loom/`, and that trailing slash is not cosmetic. A cookie
 * scoped to `/loom/` is NOT sent to `/loom` (RFC 6265 path-match: the request
 * path is shorter than the cookie path, so it cannot match), and Next
 * normalises `/loom/` to `/loom` with a 308 the moment you land. The result was
 * a reader who enrolled successfully, was redirected to a URL their brand-new
 * cookie did not cover, and got the invite page again.
 *
 * curl does not reproduce it — its path matching is looser than a browser's.
 */
export const ROOT = BASE_PATH || '/'

/**
 * A media URL from the published snapshot.
 *
 * Cover, portrait, soundtrack and narration paths are stored in content.db as
 * app-absolute strings — `/covers/<id>.jpg` — and rendered straight into `src`
 * attributes. Those are plain browser requests, so Next's basePath never
 * touches them: under a mount they leave this app entirely and land on
 * whatever answers `/`, which on the tailnet is a different application.
 *
 * Same problem as `api()`, but named separately because these are not API
 * calls and the fix has to be applied where a URL becomes a `src`.
 */
export const media = (path: string): string => `${BASE_PATH}${path}`
