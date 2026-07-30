'use client'

import { ReactNode } from 'react'
import Link from 'next/link'
import { LuMoon, LuSparkles, LuSun } from 'react-icons/lu'
import AvatarButton from '@/components/AvatarButton'
import NotificationBell from '@/components/NotificationBell'
import Greeting from '@/components/Greeting'

/**
 * The single Loom header (KAN-2).
 *
 * Replaces four hand-rolled navs — home, author, settings, and ReaderView —
 * plus a fifth copy that existed only as the author layout's loading skeleton
 * and had to be kept in sync by hand. Three of the four were already
 * near-identical (brand + greeting + light toggle + avatar); only the author
 * header added breadcrumbs, tools, a bell, and the WriteAI jump.
 *
 * Anatomy, in order. WriteAI mirrors this in KAN-7:
 *
 *   [ brand ] › [ context crumbs ] [ app switch ]  ...  [ tools ] [ identity ]
 *
 * The identity cluster is greeting → light toggle → bell → avatar.
 */

export type Crumb = {
  label: string
  /** Omit for the current page — it renders as plain text, not a link. */
  href?: string
  /** Tailwind max-width; long titles truncate with the full text on hover. */
  maxWidth?: string
}

type Props = {
  crumbs?: Crumb[]
  /**
   * Placeholder crumb count while loading. Route params are known before the
   * data fetch resolves, so the skeleton can render the right NUMBER of
   * segments and the header doesn't reflow when the titles arrive.
   */
  crumbCount?: number
  /** Surface-specific controls, e.g. the author header's shortcuts + search. */
  tools?: ReactNode
  /**
   * Reserve space for `tools` while loading. Separate from `tools` because the
   * caller usually cannot build them yet — the author header's SearchBar needs
   * the series data that hasn't arrived. Without this the header would reflow
   * when the tools appear.
   */
  hasTools?: boolean
  showBell?: boolean
  showAppSwitch?: boolean
  /** Hide the wordmark below xl — the author header needs the width. */
  compactWordmark?: boolean
  /** Hide the greeting below lg — same reason. */
  compactGreeting?: boolean
  lightMode: boolean
  onToggleLightMode: () => void
  /** Renders pulsing placeholders in place of crumbs and identity. */
  loading?: boolean
}

function Bar({ className }: { className: string }) {
  return <div className={`bg-surface-muted rounded animate-pulse ${className}`} />
}

function Sep() {
  return <span className="text-ink-faint self-center shrink-0">›</span>
}

export default function AppHeader({
  crumbs,
  crumbCount,
  tools,
  hasTools = false,
  showBell = false,
  showAppSwitch = false,
  compactWordmark = false,
  compactGreeting = false,
  lightMode,
  onToggleLightMode,
  loading = false,
}: Props) {
  // While loading, fall back to crumbCount so the segment count is stable
  // across the skeleton→loaded transition.
  const placeholderCrumbs = loading ? (crumbCount ?? crumbs?.length ?? 0) : 0

  return (
    <nav className="sticky top-0 z-30 bg-surface-raised border-b border-accent/10 px-6 py-3 flex items-center gap-3 text-sm">
      <Link href="/" className="flex items-center gap-2 shrink-0">
        <img src="/loom-logo.svg" alt="" className="block h-9 w-9" />
        <span
          className={`text-accent font-bold tracking-wider text-2xl leading-none${
            compactWordmark ? ' hidden xl:inline' : ''
          }`}
        >
          LOOM
        </span>
      </Link>

      {loading
        ? Array.from({ length: placeholderCrumbs }, (_, i) => (
            <span key={i} className="contents">
              <Sep />
              <Bar className={`h-4 ${i === 0 ? 'w-32' : 'w-24'}`} />
            </span>
          ))
        : crumbs?.map((c, i) => (
            <span key={i} className="contents">
              <Sep />
              {c.href ? (
                <Link
                  href={c.href}
                  title={c.label}
                  className={`text-ink-muted hover:text-ink self-center truncate ${c.maxWidth ?? ''}`}
                >
                  {c.label}
                </Link>
              ) : (
                <span
                  title={c.label}
                  className={`text-ink self-center truncate ${c.maxWidth ?? ''}`}
                >
                  {c.label}
                </span>
              )}
            </span>
          ))}

      {showAppSwitch && (
        /* Jump to the companion WriteAI app (same tab — the browser's back
           button is the return trip). KAN-8 decides its final form and whether
           it belongs on every surface rather than just this one. */
        <a
          href={process.env.NEXT_PUBLIC_WRITEAI_URL ?? 'http://localhost:5173'}
          title="Open WriteAI"
          className="self-center shrink-0 ml-1 p-1 rounded text-ink-faint hover:text-accent hover:bg-accent/10 transition"
        >
          <LuSparkles size={14} />
        </a>
      )}

      <div className="ml-auto flex items-center gap-3 shrink-0">
        {loading ? (
          <>
            {(hasTools || tools) && (
              <div className="flex items-center gap-2 animate-pulse">
                <Bar className="w-4 h-4" />
                <Bar className="h-7 w-72 rounded-lg" />
              </div>
            )}
            <Bar className={`h-4 w-28${compactGreeting ? ' hidden lg:block' : ''}`} />
            <div className="flex items-center gap-1.5 animate-pulse">
              <Bar className="w-3.5 h-3.5 rounded-full" />
              <Bar className="w-9 h-5 rounded-full" />
              <Bar className="w-3.5 h-3.5 rounded-full" />
            </div>
            {showBell && <Bar className="w-4 h-4" />}
            <Bar className="w-10 h-10 rounded-full" />
          </>
        ) : (
          <>
            {tools}
            <div className={compactGreeting ? 'hidden lg:block' : undefined}>
              <Greeting />
            </div>
            <button
              role="switch"
              aria-checked={lightMode}
              onClick={onToggleLightMode}
              title={lightMode ? 'Switch to dark mode' : 'Switch to light mode'}
              className="flex items-center gap-1.5 text-ink-faint hover:text-ink transition"
            >
              <LuMoon size={13} />
              <span
                className={`relative inline-flex w-9 h-5 rounded-full transition-colors duration-200 ${
                  lightMode ? 'bg-accent' : 'bg-surface-muted'
                }`}
              >
                <span
                  className={`absolute top-0.5 w-4 h-4 rounded-full bg-white shadow transition-all duration-200 ${
                    lightMode ? 'left-4' : 'left-0.5'
                  }`}
                />
              </span>
              <LuSun size={13} />
            </button>
            {showBell && <NotificationBell />}
            <AvatarButton />
          </>
        )}
      </div>
    </nav>
  )
}
