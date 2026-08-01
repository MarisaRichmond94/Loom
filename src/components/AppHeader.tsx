'use client'

import { ReactNode } from 'react'
import Link from 'next/link'
import { LuMoon, LuSparkles, LuSun } from 'react-icons/lu'
import AvatarButton from '@/components/AvatarButton'
import NotificationBell from '@/components/NotificationBell'
import Greeting from '@/components/Greeting'
import ProjectSwitcher, { type SwitcherProject } from '@/components/ProjectSwitcher'

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
 *   [ logo ] [ project ▾ | LOOM ] [ app switch ]  ...  [ tools ] [ identity ]
 *
 * The identity cluster is greeting → light toggle → bell → avatar.
 *
 * The breadcrumb chain that used to sit after the brand is gone (KAN-18). The
 * project switcher took over the only job it uniquely did — reaching the series
 * page — and the sidebar's OutlineTree already covered book and chapter better
 * than a trail did. The switcher occupies the wordmark's slot and styling, so
 * the header reads as "what am I working on" rather than "where am I".
 */

type Props = {
  /**
   * The active project, rendered as a switcher beside the brand (KAN-18).
   * Absent on surfaces with no project context — settings, home, the reader.
   */
  project?: SwitcherProject
  /**
   * Reserve space for the switcher while loading. Separate from `project` for
   * the same reason as `hasTools`: the caller cannot supply it yet. Without it,
   * project-less surfaces that also use `loading` — home gates its identity
   * cluster behind `mounted` — would flash a stray separator and placeholder.
   */
  hasProject?: boolean
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

export default function AppHeader({
  project,
  hasProject = false,
  tools,
  hasTools = false,
  showBell = false,
  showAppSwitch = false,
  compactGreeting = false,
  lightMode,
  onToggleLightMode,
  loading = false,
}: Props) {
  // z-50 — the nav is app chrome and outranks everything in the page below it.
  // This has to live on the <nav> itself, not on the dropdowns: a z-indexed
  // sticky element is a stacking context, so the bell's z-[95] and the
  // switcher's z-50 only order them against each other, never against page
  // content. At z-30 that put both menus behind the chapter editor's sticky
  // header (z-[45]). Full-screen modals are z-50 too and still win, being
  // later in the document.
  return (
    <nav className="font-chrome sticky top-0 z-50 bg-surface-raised border-b border-accent/10 px-6 py-3 flex items-center gap-3 text-sm">
      <Link href="/" className="shrink-0" aria-label="Loom">
        <img src="/loom-logo.svg" alt="" className="block h-9 w-9" />
      </Link>

      {/* The wordmark slot shows the PROJECT when there is one, in the same
          treatment LOOM used to have (KAN-18). The logo carries the brand; this
          slot says what you're working on. Surfaces with no project context —
          home, settings, the reader — fall back to the wordmark, so the brand
          is never absent entirely.

          No separator: the switcher replaces the wordmark rather than trailing
          from it, which is what let the breadcrumb row go away. */}
      {loading && hasProject ? (
        // h-5 matches the project title's text-xl line box — a mismatch here
        // reintroduces the vertical jump on skeleton → loaded.
        <Bar className="h-5 w-56" />
      ) : project ? (
        <ProjectSwitcher active={project} />
      ) : (
        <span className="text-accent font-bold tracking-wider text-2xl leading-none shrink-0">
          LOOM
        </span>
      )}

      {showAppSwitch && (
        /* Jump to the companion WriteAI app (same tab — the browser's back
           button is the return trip).

           Present on every Loom surface EXCEPT the reader (KAN-8). It used to
           sit only on author pages, which read as incidental. The reader is
           excluded deliberately: read mode is for reading, and a jump to the
           analysis tool mid-chapter is a different mode of attention.

           Icon + tooltip rather than a label — the header already carries a
           project switcher, search, greeting, toggle, bell and avatar. WriteAI
           mirrors this exactly. */
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
              <LuMoon size={14} />
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
              <LuSun size={14} />
            </button>
            {showBell && <NotificationBell />}
            <AvatarButton />
          </>
        )}
      </div>
    </nav>
  )
}
