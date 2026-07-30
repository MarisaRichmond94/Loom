'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { LuMoon, LuSun } from 'react-icons/lu'
import AvatarButton from '@/components/AvatarButton'
import Greeting from '@/components/Greeting'

// Top-level shell for the home routes. Provides the logo and the right-side
// greeting + light-mode toggle + avatar. Author pages, reader pages, and
// preview pages each have their own chrome and don't sit under this layout.
//
// The Write | Explore tab pair was removed with KAN-9: /explore became /read
// and is orphaned pending a decision about the reader-facing browse, so the
// pair had one destination left and nothing to switch between.
export default function HomeLayout({ children }: { children: React.ReactNode }) {
  const [lightMode, setLightMode] = useState(false)
  // Greeting/toggle/avatar all read from localStorage or fetch after mount;
  // gating them behind `mounted` swaps a pulsing placeholder in for that gap
  // instead of letting the greeting text and toggle position pop in late.
  const [mounted, setMounted] = useState(false)
  useEffect(() => {
    setLightMode(localStorage.getItem('loom-light-mode') === 'true')
    setMounted(true)
  }, [])

  function toggleLightMode() {
    setLightMode(prev => {
      const next = !prev
      localStorage.setItem('loom-light-mode', String(next))
      return next
    })
  }

  return (
    <div className="h-screen bg-surface-base flex flex-col overflow-hidden">
      <nav className="sticky top-0 z-10 bg-surface-raised border-b border-accent/10 px-6 py-3 flex items-center gap-6 text-sm">
        <Link href="/" className="flex items-center gap-2 shrink-0">
          <img src="/loom-logo.svg" alt="" className="block h-9 w-9" />
          <span className="text-accent font-bold tracking-wider text-2xl leading-none">LOOM</span>
        </Link>
        <div className="ml-auto flex items-center gap-2">
          {mounted ? (
            <>
              <Greeting />
              <button
                role="switch"
                aria-checked={lightMode}
                onClick={toggleLightMode}
                title={lightMode ? 'Switch to dark mode' : 'Switch to light mode'}
                className="flex items-center gap-1.5 text-ink-faint hover:text-ink transition"
              >
                <LuMoon size={13} />
                <span className={`relative inline-flex w-9 h-5 rounded-full transition-colors duration-200 ${lightMode ? 'bg-accent' : 'bg-surface-muted'}`}>
                  <span className={`absolute top-0.5 w-4 h-4 rounded-full bg-white shadow transition-all duration-200 ${lightMode ? 'left-4' : 'left-0.5'}`} />
                </span>
                <LuSun size={13} />
              </button>
              <AvatarButton />
            </>
          ) : (
            <div className="flex items-center gap-2 animate-pulse">
              <div className="h-4 w-28 bg-surface-muted rounded" />
              <div className="w-9 h-5 rounded-full bg-surface-muted" />
              <div className="w-10 h-10 rounded-full bg-surface-muted" />
            </div>
          )}
        </div>
      </nav>

      <main className={`flex-1 overflow-y-auto${lightMode ? ' light-body' : ''}`}>
        {children}
      </main>
    </div>
  )
}
