'use client'

import AppHeader from '@/components/AppHeader'
import { useLightMode } from '@shared/useLightMode'

/**
 * Shell for the author's preview surfaces (LOOM-137).
 *
 * These pages moved out of `(home)` because they are AUTHOR TOOLS, not reader
 * pages: the branching preview, draft access, narration playback, and the
 * canon-versus-non-canon check done while writing. Sitting at `/preview/*`
 * beside the retired root page, they read as superseded reader code now that a
 * real reader app exists — and LOOM-131 nearly orphaned them on exactly that
 * reasoning.
 *
 * They need their own layout because `(home)/layout.tsx` was giving them their
 * chrome. Moving them without this would have quietly stripped the header from
 * two working pages — a behaviour change disguised as a file move.
 *
 * THE (framed) GROUP EXISTS TO KEEP THE SESSION PAGE OUT OF THIS. Only the
 * series and book previews want this shell. The reading session
 * (/author/preview/session/*) renders its OWN header and owns its full height
 * for a sticky footer — it lived at /read/<id> with no layout at all. Putting
 * it under this one gave it two headers and swallowed its footer. A route group
 * scopes the layout without touching a single URL.
 *
 * NO APP SWITCH. `(home)` gated it on `pathname === '/'`, so these pages never
 * had it; passing false here preserves that exactly. The WriteAI jump is an
 * author tool, but these pages are also what the author uses to LOOK at a book
 * as a reader would, and the switch has no place in that view.
 */
export default function AuthorPreviewLayout({ children }: { children: React.ReactNode }) {
  const { lightMode, toggleLightMode, mounted } = useLightMode()

  return (
    <div className="h-screen bg-surface-base flex flex-col overflow-hidden">
      <AppHeader
        showAppSwitch={false}
        lightMode={lightMode}
        onToggleLightMode={toggleLightMode}
        loading={!mounted}
      />

      <main className={`flex-1 overflow-y-auto${lightMode ? ' light-body' : ''}`}>
        {children}
      </main>
    </div>
  )
}
