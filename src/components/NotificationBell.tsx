'use client'

import { useEffect, useRef, useState } from 'react'
import { LuBell } from 'react-icons/lu'
import { useNotifications, markAllNotificationsRead, clearNotifications } from '@/lib/notifications'

// Header bell fed by src/lib/notifications. Unread count badges the icon;
// a pulsing dot means a background job (canon save) is still running.
// Opening the panel marks everything read.

function relativeTime(at: number): string {
  const s = Math.round((Date.now() - at) / 1000)
  if (s < 60) return 'just now'
  const m = Math.round(s / 60)
  if (m < 60) return `${m}m ago`
  const h = Math.round(m / 60)
  return h < 24 ? `${h}h ago` : `${Math.round(h / 24)}d ago`
}

export default function NotificationBell() {
  const { notifications, busy, unread } = useNotifications()
  const [open, setOpen] = useState(false)
  const panelRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    markAllNotificationsRead()
    function handleClick(e: MouseEvent) {
      if (panelRef.current && !panelRef.current.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', handleClick)
    return () => document.removeEventListener('mousedown', handleClick)
  }, [open])

  return (
    <div className="relative" ref={panelRef}>
      <button
        onClick={() => setOpen(o => !o)}
        title="Notifications"
        className="relative p-1 rounded text-ink-faint hover:text-ink transition"
      >
        <LuBell size={16} />
        {busy && (
          <span className="absolute -top-0.5 -right-0.5 w-2 h-2 rounded-full bg-accent animate-pulse" />
        )}
        {!busy && unread > 0 && (
          <span className="absolute -top-1 -right-1 min-w-[14px] h-[14px] px-0.5 rounded-full bg-accent text-white text-[9px] font-bold leading-[14px] text-center">
            {unread > 9 ? '9+' : unread}
          </span>
        )}
      </button>

      {open && (
        <div className="absolute right-0 top-full mt-2 w-80 z-[95] bg-surface-raised border border-accent/20 rounded-xl shadow-2xl overflow-hidden">
          <div className="flex items-center justify-between px-4 py-2.5 border-b border-accent/10">
            <span className="text-xs font-medium text-ink">Notifications</span>
            {notifications.length > 0 && (
              <button
                onClick={clearNotifications}
                className="text-[10px] uppercase tracking-widest text-ink-faint hover:text-ink transition"
              >
                Clear
              </button>
            )}
          </div>
          <div className="max-h-80 overflow-y-auto">
            {busy && (
              <div className="px-4 py-3 flex items-center gap-2 text-xs text-ink-muted border-b border-accent/5">
                <span className="w-2 h-2 rounded-full bg-accent animate-pulse shrink-0" />
                Saving canon version…
              </div>
            )}
            {notifications.length === 0 && !busy && (
              <div className="px-4 py-6 text-xs text-ink-faint text-center">No notifications yet.</div>
            )}
            {notifications.map(n => (
              <div key={n.id} className="px-4 py-3 border-b border-accent/5 last:border-b-0">
                <div className={`text-xs leading-relaxed ${
                  n.kind === 'error' ? 'text-choice-kill' : n.kind === 'warn' ? 'text-amber-500' : 'text-ink'
                }`}>
                  {n.message}
                </div>
                <div className="text-[10px] text-ink-faint mt-1">{relativeTime(n.at)}</div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}
