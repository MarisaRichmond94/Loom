'use client'

import { LuTriangleAlert, LuX, LuLoader } from 'react-icons/lu'
import { useNotifications, dismissToast } from '@/lib/notifications'

export default function ToastLayer() {
  const { toasts, saving } = useNotifications()
  if (!toasts.length && !saving) return null

  return (
    <div
      className="fixed z-[200] flex flex-col gap-2 pointer-events-none"
      style={{
        right: 'var(--loom-toast-right, 0.75rem)',
        bottom: 'var(--loom-toast-bottom, calc(var(--loom-footer-h, 0px) + 57px))',
      }}
    >
      {toasts.map(t => (
        <div
          key={t.id}
          className="flex items-start gap-3 bg-surface-raised border border-choice-kill/40 rounded-xl px-4 py-3 shadow-2xl max-w-sm pointer-events-auto"
        >
          <LuTriangleAlert size={14} className="text-choice-kill shrink-0 mt-0.5" />
          <span className="text-sm text-ink leading-snug flex-1">{t.message}</span>
          <button
            onClick={() => dismissToast(t.id)}
            className="text-ink-faint hover:text-ink transition shrink-0 ml-1"
          >
            <LuX size={13} />
          </button>
        </div>
      ))}
      {saving && (
        <div className="flex items-center gap-2.5 bg-surface-raised border border-accent/20 rounded-xl px-4 py-3 shadow-2xl pointer-events-auto">
          <LuLoader size={14} className="text-accent animate-spin shrink-0" />
          <span className="text-sm text-ink-muted">Saving…</span>
        </div>
      )}
    </div>
  )
}
