'use client'

import AppHeader from '@/components/AppHeader'
import { useLightMode } from '@/lib/useLightMode'

// Top-level shell for the home routes. Chrome comes from <AppHeader> (KAN-2),
// shared with the author, settings, and reader surfaces. Preview pages have
// their own chrome and don't sit under this layout.
//
// The Write | Explore tab pair was removed with KAN-9: /explore became /read
// and is orphaned pending a decision about the reader-facing browse, so the
// pair had one destination left and nothing to switch between.
export default function HomeLayout({ children }: { children: React.ReactNode }) {
  const { lightMode, toggleLightMode, mounted } = useLightMode()

  return (
    <div className="h-screen bg-surface-base flex flex-col overflow-hidden">
      {/* loading={!mounted}: the greeting and toggle read localStorage after
          mount, so placeholders hold their position rather than letting them
          pop in a frame late. */}
      <AppHeader
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
