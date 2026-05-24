'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { LuMoon, LuSun } from 'react-icons/lu'
import AvatarButton from '@/components/AvatarButton'
import Greeting from '@/components/Greeting'

// Top-level shell for the marketing/home routes (Explore + Write). Provides
// the logo, the Explore | Write tab pair, and the right-side greeting +
// light-mode toggle + avatar. Author pages, reader pages, and preview pages
// each have their own chrome and don't sit under this layout.
export default function HomeLayout({ children }: { children: React.ReactNode }) {
  const pathname = usePathname() ?? '/'
  const [lightMode, setLightMode] = useState(false)
  useEffect(() => {
    setLightMode(localStorage.getItem('loom-light-mode') === 'true')
  }, [])

  function toggleLightMode() {
    setLightMode(prev => {
      const next = !prev
      localStorage.setItem('loom-light-mode', String(next))
      return next
    })
  }

  // Anchored at `/write` so other future write-rooted routes (write/...)
  // still light up the tab. Explore is the root index.
  const isWrite = pathname.startsWith('/write')
  const isExplore = !isWrite

  return (
    <div className="h-screen bg-surface-base flex flex-col overflow-hidden">
      <nav className="sticky top-0 z-10 bg-surface-raised border-b border-accent/10 px-6 py-3 flex items-center gap-6 text-sm">
        <Link href="/" className="flex items-center gap-2 shrink-0">
          <img src="/loom-logo.svg" alt="" className="block h-9 w-9" />
          <span className="text-accent font-bold tracking-wider text-2xl leading-none">LOOM</span>
        </Link>
        <div className="flex items-center gap-3 text-sm">
          <Link
            href="/"
            className={`transition ${isExplore ? 'text-accent font-medium' : 'text-ink-muted hover:text-ink'}`}
          >
            Explore
          </Link>
          <span className="text-ink-faint">|</span>
          <Link
            href="/write"
            className={`transition ${isWrite ? 'text-accent font-medium' : 'text-ink-muted hover:text-ink'}`}
          >
            Write
          </Link>
        </div>
        <div className="ml-auto flex items-center gap-2">
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
        </div>
      </nav>

      <main className={`flex-1 overflow-y-auto${lightMode ? ' light-body' : ''}`}>
        {children}
      </main>
    </div>
  )
}
