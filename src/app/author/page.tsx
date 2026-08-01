import { redirect } from 'next/navigation'
import { getLastActiveSeries } from '@/lib/authorState'
import { authorJumpTarget } from '@/lib/crossAppJump'

// Reads author-state.json per request — without this, Next has no signal
// that the page is dynamic and prerenders (caches) the redirect at build
// time, permanently freezing it at whatever was last active during the build.
export const dynamic = 'force-dynamic'

// Bare /author has no series in the URL to render. Land the writer back
// where they left off (LOOM-57) instead of 404ing, using the same
// last-touched resolution the WriteAI jump-in already trusts.
export default async function AuthorRootPage() {
  const seriesId = await getLastActiveSeries()
  redirect(seriesId ? await authorJumpTarget(seriesId) : '/')
}
