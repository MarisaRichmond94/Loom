'use client'

import { LuMoon, LuSun } from 'react-icons/lu'

/**
 * The reader tier's chrome.
 *
 * FORKED FROM AppHeader, not shared — a departure from what LOOM-130's criteria
 * said, and worth stating plainly. `AppHeader` pulls in `ProjectSwitcher`
 * (which fetches /api/series on open), `NotificationBell`, `AvatarButton` and
 * `Greeting`. Sharing it would drag author components AND author API calls into
 * the reader bundle — precisely the leak a separate process exists to prevent.
 * The reader needs three of its ten elements.
 *
 * Visual consistency comes from the shared theme instead: same tokens, same
 * nav geometry, same font-chrome treatment. The bar below is deliberately the
 * same shape as Loom's.
 *
 * NO GREETING, NO AVATAR. Those are the AUTHOR's identity, and this app is not
 * for her. Once reader tokens land (LOOM-132) the reader's own name goes here.
 */
export default function ReaderHeader({
  lightMode,
  onToggleLightMode,
  mounted,
}: {
  lightMode: boolean
  onToggleLightMode: () => void
  mounted: boolean
}) {
  return (
    <nav className="font-chrome sticky top-0 z-50 bg-surface-raised border-b border-accent/10 px-6 py-3 flex items-center gap-3 text-sm">
      <span className="shrink-0" aria-label="Loom">
        <img src="/loom-logo.svg" alt="" className="block h-9 w-9" />
      </span>
      <span className="text-accent font-bold tracking-wider text-2xl leading-none shrink-0">
        LOOM
      </span>

      <div className="ml-auto flex items-center gap-3">
        {/* Placeholder holds the toggle's position until localStorage is
            readable, so it does not pop in a frame late — same reason
            AppHeader gates its identity cluster on `mounted`. */}
        {mounted ? (
          <button
            onClick={onToggleLightMode}
            title={lightMode ? 'Switch to dark' : 'Switch to light'}
            aria-label={lightMode ? 'Switch to dark' : 'Switch to light'}
            className="p-1.5 rounded text-ink-faint hover:text-accent hover:bg-accent/10 transition"
          >
            {lightMode ? <LuMoon size={15} /> : <LuSun size={15} />}
          </button>
        ) : (
          <div className="w-[30px] h-[30px]" />
        )}
      </div>
    </nav>
  )
}
