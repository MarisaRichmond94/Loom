'use client'

import { usePathname } from 'next/navigation'
import AppHeader from '@/components/AppHeader'
import { useLightMode } from '@shared/useLightMode'

// Top-level shell for the home routes. Chrome comes from <AppHeader> (KAN-2),
// shared with the author, settings, and reader surfaces.
//
// NOTE: this layout now wraps TWO routes — `/` and the orphaned `/read`
// catalog. The two /preview pages moved to /author/preview in LOOM-137, taking
// their chrome with them (author/preview/layout.tsx), because they are author
// tools rather than reader pages and reading as reader code nearly got them
// deleted. Anything author-only added here must still be gated on the pathname
// while /read remains.
//
// The Write | Explore tab pair was removed with KAN-9: /explore became /read
// and is orphaned pending a decision about the reader-facing browse, so the
// pair had one destination left and nothing to switch between.
export default function HomeLayout({ children }: { children: React.ReactNode }) {
  const { lightMode, toggleLightMode, mounted } = useLightMode()
  const pathname = usePathname()

  return (
    <div className="h-screen bg-surface-base flex flex-col overflow-hidden">
      {/* loading={!mounted}: the greeting and toggle read localStorage after
          mount, so placeholders hold their position rather than letting them
          pop in a frame late. */}
      {/* showAppSwitch only on `/`. The WriteAI jump is an author tool and
          /read is the reader-facing catalog, so it stays gated rather than
          becoming unconditional — LOOM-137 removed the preview pages from this
          layout but /read is still here. */}
      <AppHeader
        showAppSwitch={pathname === '/'}
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
