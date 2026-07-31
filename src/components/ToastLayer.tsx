'use client'

import { LuTriangleAlert, LuX, LuLoader, LuCheck } from 'react-icons/lu'
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
      {toasts.map(t => {
        const ok = t.kind === 'ok'
        return (
          <div
            key={t.id}
            className={`flex items-start gap-3 bg-surface-raised border rounded-xl px-4 py-3 shadow-2xl max-w-sm pointer-events-auto ${
              ok ? 'border-accent/40' : 'border-choice-kill/40'
            }`}
          >
            {ok
              ? <LuCheck size={14} className="text-accent shrink-0 mt-0.5" />
              : <LuTriangleAlert size={14} className="text-choice-kill shrink-0 mt-0.5" />}
            <div className="flex-1 min-w-0">
              <div className="text-sm text-ink leading-snug">{t.message}</div>
              {t.detail && (
                <div className="text-xs text-ink-faint leading-snug mt-1 break-words">{t.detail}</div>
              )}
              {!!t.actions?.length && (
                <div className="flex flex-wrap gap-3 mt-2">
                  {t.actions.map(a => (
                    <button
                      key={a.label}
                      onClick={() => {
                        if (a.href) window.open(a.href, '_blank', 'noopener,noreferrer')
                        else a.onClick?.()
                        // Leave the toast up. These actions can fail (Drive
                        // unreachable, folder moved) and the toast is where
                        // that gets reported — dismissing on click would take
                        // the message away just as it becomes useful.
                      }}
                      className="text-xs font-medium text-accent hover:underline"
                    >
                      {a.label}
                    </button>
                  ))}
                </div>
              )}
            </div>
            <button
              onClick={() => dismissToast(t.id)}
              className="text-ink-faint hover:text-ink transition shrink-0 ml-1"
            >
              <LuX size={13} />
            </button>
          </div>
        )
      })}
      {saving && (
        <div className="flex items-center gap-2.5 bg-surface-raised border border-accent/20 rounded-xl px-4 py-3 shadow-2xl pointer-events-auto">
          <LuLoader size={14} className="text-accent animate-spin shrink-0" />
          <span className="text-sm text-ink-muted">Saving…</span>
        </div>
      )}
    </div>
  )
}
