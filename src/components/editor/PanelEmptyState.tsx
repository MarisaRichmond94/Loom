import type { ReactNode } from 'react'

// The dock's empty states — icon, headline, explanation, centred in the panel.
//
// Shared by Review and Pins rather than copied. An empty tab is the FIRST thing
// the writer sees in it (92% of chapters have no review, and pins start empty
// every session), so these are the panel's normal appearance rather than an
// edge case, and two of them drifting apart would be immediately visible.

export function PanelEmptyState({
  icon,
  title,
  children,
}: {
  icon: ReactNode
  title: string
  children?: ReactNode
}) {
  return (
    <div className="flex h-full flex-col items-center justify-center gap-2 px-6 py-8 text-center">
      <div className="text-ink-faint/50">{icon}</div>
      <p className="text-xs font-semibold text-ink-muted">{title}</p>
      {children && (
        <p className="max-w-[34ch] text-[11px] leading-relaxed text-ink-faint">{children}</p>
      )}
    </div>
  )
}

/** Fills the panel so the state above can centre itself against real height. */
export function PanelEmpty({ children }: { children: ReactNode }) {
  return <div className="flex-1 overflow-y-auto overscroll-contain">{children}</div>
}
