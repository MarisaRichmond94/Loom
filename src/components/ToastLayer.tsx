'use client'

import { LuTriangleAlert, LuX } from 'react-icons/lu'
import { useNotifications, dismissToast } from '@/lib/notifications'

export default function ToastLayer() {
  const { toasts } = useNotifications()
  if (!toasts.length) return null

  return (
    <div className="fixed bottom-6 right-6 z-[200] flex flex-col gap-2 pointer-events-none">
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
    </div>
  )
}
