'use client'

import { useEffect, useState } from 'react'
import { LuMessageSquare } from 'react-icons/lu'
import type { PanelSettings } from '@/lib/panelSettings'

// Settings section for the chapter editor's right-hand dock (LOOM-138).
// Currently just the one switch — Comments is the only tab a writer might
// reasonably not want, since it's the only one fed by outside readers rather
// than by the writer's own work on the chapter.

export default function PanelTabsSection() {
  const [settings, setSettings] = useState<PanelSettings | null>(null)

  useEffect(() => {
    fetch('/api/settings/panel').then(r => r.json()).then(setSettings)
  }, [])

  async function toggleCommentsTab() {
    if (!settings) return
    const next = { ...settings, commentsTabEnabled: !settings.commentsTabEnabled }
    setSettings(next)
    await fetch('/api/settings/panel', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ commentsTabEnabled: next.commentsTabEnabled }),
    })
  }

  if (!settings) return null

  return (
    <section className="mb-8">
      <h2 className="text-xs uppercase tracking-widest text-ink-faint mb-4">Dock Tabs</h2>
      <div className="bg-surface-raised border border-accent/10 rounded-xl p-6">
        <div className="flex items-center justify-between">
          <div>
            <div className="text-sm font-medium text-ink mb-1 flex items-center gap-2">
              <LuMessageSquare size={14} className="text-accent" /> Comments Tab
            </div>
            <div className="text-xs text-ink-faint">
              Show reader comments in the chapter editor's side panel.
            </div>
          </div>
          <button
            role="switch"
            aria-checked={settings.commentsTabEnabled}
            onClick={toggleCommentsTab}
            className="flex items-center"
          >
            <span className={`relative inline-flex w-9 h-5 rounded-full transition-colors duration-200 ${settings.commentsTabEnabled ? 'bg-accent' : 'bg-surface-muted'}`}>
              <span className={`absolute top-0.5 w-4 h-4 rounded-full bg-white shadow transition-all duration-200 ${settings.commentsTabEnabled ? 'left-4' : 'left-0.5'}`} />
            </span>
          </button>
        </div>
      </div>
    </section>
  )
}
