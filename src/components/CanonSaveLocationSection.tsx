'use client'

import { useEffect, useState } from 'react'
import { LuFolderOpen } from 'react-icons/lu'

// Settings section for where the ⌥⇧E canon save lands. The root is the
// folder holding one folder per book ("<n>. <Book Title>"); the subfolder
// dropdown offers the folder names that actually exist inside those book
// folders (plus "book folder itself" for saving at the top level).

type Settings = { root: string; subfolder: string }

export default function CanonSaveLocationSection() {
  const [settings, setSettings] = useState<Settings | null>(null)
  const [subfolders, setSubfolders] = useState<string[]>([])
  const [rootError, setRootError] = useState<string | null>(null)
  const [picking, setPicking] = useState(false)

  useEffect(() => {
    fetch('/api/settings/canon-export')
      .then(r => r.json())
      .then((s: Settings) => {
        setSettings(s)
        loadSubfolders(s.root)
      })
  }, [])

  async function loadSubfolders(root: string) {
    const res = await fetch(`/api/settings/canon-export/subfolders?root=${encodeURIComponent(root)}`)
    const data = await res.json() as { subfolders: string[]; error?: string }
    setSubfolders(data.subfolders ?? [])
    setRootError(res.ok ? null : (data.error ?? 'Folder not found.'))
  }

  async function patch(body: Partial<Settings>) {
    const res = await fetch('/api/settings/canon-export', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    })
    if (res.ok) setSettings(await res.json())
  }

  async function setRoot(root: string) {
    setSettings(s => s ? { ...s, root } : s)
    await patch({ root })
    await loadSubfolders(root)
  }

  async function pickFolder() {
    setPicking(true)
    const res = await fetch('/api/settings/canon-export/pick-folder', { method: 'POST' })
    const { folder } = await res.json() as { folder: string | null }
    setPicking(false)
    if (folder) await setRoot(folder)
  }

  if (!settings) return null

  // Keep the saved subfolder selectable even when it doesn't exist (yet)
  // under the current root — the export mkdirs it on first save.
  const options = subfolders.includes(settings.subfolder) || !settings.subfolder
    ? subfolders
    : [settings.subfolder, ...subfolders]

  return (
    <section className="mb-8">
      <h2 className="text-xs uppercase tracking-widest text-ink-faint mb-4">Canon Save Location</h2>
      <div className="bg-surface-raised border border-accent/10 rounded-xl p-6 flex flex-col gap-5">
        <p className="text-xs text-ink-faint leading-relaxed -mb-1">
          Where ⌥⇧E saves a book's canon manuscript. The folder below should
          hold one folder per book (the name just needs to contain the book's
          title); the manuscript is saved as{' '}
          <span className="font-mono">Book Name.pages</span> inside the chosen
          subfolder, replacing the previous save.
        </p>

        <div>
          <label className="block text-xs uppercase tracking-widest text-ink-faint mb-2">Books Folder</label>
          <div className="flex gap-2">
            <input
              value={settings.root}
              onChange={e => setSettings(s => s ? { ...s, root: e.target.value } : s)}
              onBlur={e => setRoot(e.target.value)}
              placeholder="/Users/you/Writing"
              className="flex-1 bg-surface-base border border-accent/20 rounded-lg px-4 py-2.5 text-sm text-ink placeholder:text-ink-faint outline-none focus:border-accent font-mono"
            />
            <button
              onClick={pickFolder}
              disabled={picking}
              title="Choose folder"
              className="px-3 py-2 rounded-lg bg-surface-base border border-accent/20 text-ink-muted hover:text-ink transition disabled:opacity-50 shrink-0"
            >
              <LuFolderOpen size={16} />
            </button>
          </div>
          {rootError && <p className="text-xs text-choice-kill mt-1.5">{rootError}</p>}
        </div>

        <div>
          <label className="block text-xs uppercase tracking-widest text-ink-faint mb-2">Save Into</label>
          <select
            value={settings.subfolder}
            onChange={e => { const subfolder = e.target.value; setSettings(s => s ? { ...s, subfolder } : s); patch({ subfolder }) }}
            className="w-full bg-surface-base border border-accent/20 rounded-lg px-4 py-2.5 text-sm text-ink outline-none focus:border-accent"
          >
            <option value="">(book folder itself)</option>
            {options.map(name => (
              <option key={name} value={name}>{name}</option>
            ))}
          </select>
          <p className="text-xs text-ink-faint mt-1.5">
            Subfolders found inside your book folders. Saving to the book
            folder itself will overwrite any file already named after the book.
          </p>
        </div>
      </div>
    </section>
  )
}
