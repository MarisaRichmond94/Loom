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
