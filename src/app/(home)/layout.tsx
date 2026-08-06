'use client'

import { usePathname } from 'next/navigation'
import AppHeader from '@/components/AppHeader'
import { useLightMode } from '@shared/useLightMode'

// Top-level shell for the home routes. Chrome comes from <AppHeader> (KAN-2),
// shared with the author, settings, and reader surfaces.
//
// NOTE: this layout wraps FOUR routes, and only `/` is author-facing —
// /read and /preview/{series,book} are reader-facing. (An earlier version of
// this comment claimed preview pages sat outside this layout; they do not.)
// Anything author-only added here must be gated on the pathname.
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
      {/* showAppSwitch only on `/`. This layout is shared by four routes and
          three of them are READER-facing — /read and both /preview pages. The
          WriteAI jump is an author tool; a reader must not be able to reach the
          analysis app from a book preview. Same reasoning excludes the reader
          session view (KAN-8). */}
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
