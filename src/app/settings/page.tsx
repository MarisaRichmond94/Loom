'use client'

import { useState, useEffect, useRef, useCallback } from 'react'
import { useRouter } from 'next/navigation'
import { LuShield, LuPlay, LuFolderOpen, LuUser, LuX, LuCheck, LuArrowLeft, LuDatabaseBackup } from 'react-icons/lu'
import Cropper from 'react-easy-crop'
import type { Area } from 'react-easy-crop'
import { cropImageToBlob } from '@/lib/cropImage'
import { useDocumentTitle } from '@/lib/useDocumentTitle'
import AppHeader from '@/components/AppHeader'
import { useLightMode } from '@shared/useLightMode'
import ExportFormattingSection from '@/components/ExportFormattingSection'
import CanonSaveLocationSection from '@/components/CanonSaveLocationSection'
import ManuscriptTemplateSection from '@/components/ManuscriptTemplateSection'
import EditorColorsSection from '@/components/EditorColorsSection'
import PanelTabsSection from '@/components/PanelTabsSection'
import ReadersSection from '@/components/ReadersSection'
import ToastLayer from '@/components/ToastLayer'
import { showToast } from '@/lib/notifications'


type BackupSettings = {
  enabled: boolean
  folder: string
  time: string
  retentionDays: number
}

export default function SettingsPage() {
  const router = useRouter()
  useDocumentTitle('Settings')
  const { lightMode, toggleLightMode } = useLightMode()
  const [authorName, setAuthorName] = useState('')
  const [backup, setBackup] = useState<BackupSettings>({
    enabled: false,
    folder: '',
    time: '22:30',
    retentionDays: 30,
  })
  const [backupStatus, setBackupStatus] = useState<{ ok: boolean; message: string } | null>(null)
  const [runningBackup, setRunningBackup] = useState(false)
  // On-demand whole-database snapshot (KAN-26). Only the in-flight state lives
  // here — the result is a toast, so there is nothing to hold afterwards.
  const [snapshotting, setSnapshotting] = useState(false)
  const [pickingFolder, setPickingFolder] = useState(false)
  const [hasAvatar, setHasAvatar] = useState(false)
  const [avatarTs, setAvatarTs] = useState(0)
  const [imageSrc, setImageSrc] = useState<string | null>(null)
  const [crop, setCrop] = useState({ x: 0, y: 0 })
  const [zoom, setZoom] = useState(1)
  const [croppedArea, setCroppedArea] = useState<Area | null>(null)
  const [saving, setSaving] = useState(false)
  const avatarInputRef = useRef<HTMLInputElement>(null)
  // Bio + pseudonym. Same source as authorName — the server-side profile.
  // Pseudonym avatar is a file (public/pseudonym-avatar.jpg); we track its
  // existence (+ a cache-buster ts) here so the UI can swap between the
  // uploaded photo and a blurred-main fallback without a reload.
  const [bio, setBio] = useState('')
  const [pseudonymEnabled, setPseudonymEnabled] = useState(false)
  const [pseudonym, setPseudonym] = useState('')
  const [hasPseudonymAvatar, setHasPseudonymAvatar] = useState(false)
  const [pseudonymAvatarTs, setPseudonymAvatarTs] = useState(0)
  const pseudonymAvatarInputRef = useRef<HTMLInputElement>(null)
  // Demo data — lets the author populate Explore with N mock series to
  // see how the page feels with a real catalog. Mock series are flagged
  // demo=true; the Clear button deletes only those.
  const [demoCount, setDemoCount] = useState(25)
  const [demoBusy, setDemoBusy] = useState<'generating' | 'clearing' | null>(null)
  const [demoStatus, setDemoStatus] = useState<string | null>(null)

  useEffect(() => {
    // Prefer the server-side profile (so this matches what public preview
    // pages display), falling back to the legacy localStorage value if the
    // server hasn't been populated yet.
    fetch('/api/settings/profile')
      .then(r => r.ok ? r.json() : { authorName: '' })
      .then((p: { authorName?: string; bio?: string; pseudonymEnabled?: boolean; pseudonym?: string }) => {
        const server = (p.authorName ?? '').trim()
        const local = (localStorage.getItem('loom-author-name') ?? '').trim()
        const initial = server || local
        setAuthorName(initial)
        setBio(p.bio ?? '')
        setPseudonymEnabled(!!p.pseudonymEnabled)
        setPseudonym(p.pseudonym ?? '')
        // Keep localStorage in sync so the author's own greeting/UI sees the
        // same value without a round trip.
        if (initial) localStorage.setItem('loom-author-name', initial)
      })
      .catch(() => setAuthorName(localStorage.getItem('loom-author-name') ?? ''))
    fetch('/api/settings/backup').then(r => r.json()).then(setBackup)
    fetch('/avatar.jpg', { method: 'HEAD' })
      .then(r => { if (r.ok) { setHasAvatar(true); setAvatarTs(Date.now()) } })
      .catch(() => {})
    fetch('/pseudonym-avatar.jpg', { method: 'HEAD' })
      .then(r => { if (r.ok) { setHasPseudonymAvatar(true); setPseudonymAvatarTs(Date.now()) } })
      .catch(() => {})
  }, [])

  const onCropComplete = useCallback((_: Area, pixels: Area) => {
    setCroppedArea(pixels)
  }, [])

  function handleAvatarFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (!file) return
    const reader = new FileReader()
    reader.onload = () => setImageSrc(reader.result as string)
    reader.readAsDataURL(file)
    e.target.value = ''
  }

  async function handleAvatarSave() {
    if (!imageSrc || !croppedArea) return
    setSaving(true)
    try {
      const blob = await cropImageToBlob(imageSrc, croppedArea)
      const form = new FormData()
      form.append('avatar', blob, 'avatar.jpg')
      const res = await fetch('/api/avatar', { method: 'POST', body: form })
      if (res.ok) { setHasAvatar(true); setAvatarTs(Date.now()) }
    } finally {
      setSaving(false)
      setImageSrc(null)
      setZoom(1)
      setCrop({ x: 0, y: 0 })
    }
  }

  function handleAvatarCancel() {
    setImageSrc(null)
    setZoom(1)
    setCrop({ x: 0, y: 0 })
  }

  async function handleAuthorNameBlur() {
    const trimmed = authorName.trim()
    localStorage.setItem('loom-author-name', trimmed)
    // Mirror to the server so public preview pages can render a byline
    // even when the visitor's browser has no localStorage value.
    await fetch('/api/settings/profile', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ authorName: trimmed }),
    }).catch(() => { /* non-fatal — local copy still saved */ })
  }

  async function patchProfile(patch: Partial<{
    bio: string; pseudonymEnabled: boolean; pseudonym: string
  }>) {
    await fetch('/api/settings/profile', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(patch),
    }).catch(() => { /* non-fatal */ })
  }

  async function handlePseudonymAvatarChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (!file) return
    const form = new FormData()
    form.append('avatar', file)
    const res = await fetch('/api/pseudonym-avatar', { method: 'POST', body: form })
    if (res.ok) {
      setHasPseudonymAvatar(true)
      setPseudonymAvatarTs(Date.now())
    }
    e.target.value = ''
  }

  async function removePseudonymAvatar() {
    const res = await fetch('/api/pseudonym-avatar', { method: 'DELETE' })
    if (res.ok) setHasPseudonymAvatar(false)
  }

  async function generateDemoData() {
    if (demoBusy) return
    setDemoBusy('generating')
    setDemoStatus(null)
    const res = await fetch('/api/seed/demo', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ count: demoCount }),
    })
    if (res.ok) {
      const { created } = await res.json() as { created: number }
      setDemoStatus(`Created ${created} demo series.`)
    } else {
      setDemoStatus('Generation failed.')
    }
    setDemoBusy(null)
  }

  async function clearDemoData() {
    if (demoBusy) return
    setDemoBusy('clearing')
    setDemoStatus(null)
    const res = await fetch('/api/seed/demo', { method: 'DELETE' })
    if (res.ok) {
      const { deleted } = await res.json() as { deleted: number }
      setDemoStatus(`Cleared ${deleted} demo series.`)
    } else {
      setDemoStatus('Clear failed.')
    }
    setDemoBusy(null)
  }

  async function patchBackup(patch: Partial<BackupSettings>) {
    const updated = { ...backup, ...patch }
    setBackup(updated)
    await fetch('/api/settings/backup', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(patch),
    })
  }

  async function pickFolder() {
    setPickingFolder(true)
    const res = await fetch('/api/settings/backup/pick-folder', { method: 'POST' })
    const { folder } = await res.json()
    setPickingFolder(false)
    if (folder) {
      await patchBackup({ folder })
    }
  }

  async function runNow() {
    setRunningBackup(true)
    setBackupStatus(null)
    const res = await fetch('/api/settings/backup/run', { method: 'POST' })
    const result = await res.json()
    setBackupStatus(result)
    setRunningBackup(false)
  }

  async function revealBackup(p: string) {
    const res = await fetch('/api/backup/reveal', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ path: p }),
    })
    if (!res.ok) {
      const { error } = await res.json().catch(() => ({ error: null }))
      showToast({ kind: 'error', message: error ?? 'Could not show that in Finder.' })
    }
  }

  async function runBackupNow() {
    setSnapshotting(true)
    try {
      const res = await fetch('/api/backup/now', { method: 'POST' })
      const result = await res.json()
      // Trust the payload, not the status code. The route only sets ok:true
      // after parsing the script's verified "Snapshot OK" line.
      if (!res.ok || !result.ok) {
        setSnapshotting(false)
        showToast({
          kind: 'error',
          message: result.error ?? 'Snapshot failed.',
          detail: result.log?.trim().split('\n').slice(-1)[0],
          // Failures stay up longer. A backup that did not happen is worth
          // more of the writer's attention than one that did.
          durationMs: 30000,
        })
        return
      }
      setSnapshotting(false)
      showToast({
        kind: 'ok',
        // Lead with what was verified, not that it finished.
        message: `Backed up ${result.chapters.toLocaleString()} chapters, ${result.words.toLocaleString()} words.`,
        // Drive still gets a mention — knowing the off-machine copy happened is
        // the point of it — it just isn't a link.
        detail: `${result.size}${result.uploaded ? ' · copied to Google Drive' : ' · not uploaded'}`,
        actions: [{ label: 'Show in Finder', onClick: () => revealBackup(result.path) }],
        // 5s, the same as every other toast. The backup is already safe on
        // disk by the time this appears — Show in Finder is a convenience, not
        // something the writer has to catch before it disappears.
        durationMs: 5000,
      })
    } catch (err) {
      setSnapshotting(false)
      // A network-level failure here is almost always the 4-minute timeout or
      // a restarted server — say so rather than showing an empty error.
      showToast({
        kind: 'error',
        message: err instanceof Error ? err.message : 'Could not reach the server.',
        durationMs: 30000,
      })
    }
  }

  const TABS = ['Profile', 'Editor', 'Export', 'Backups', 'Readers', 'Demo Data'] as const
  type Tab = typeof TABS[number]
  const [activeTab, setActiveTab] = useState<Tab>('Profile')

  return (
    <div className="h-screen bg-surface-base flex flex-col overflow-hidden">
      {/* No project context here, so no switcher — and the crumb that used to
          read "› Settings" is redundant with the page's own <h1>. */}
      {/* No project context here, so no switcher. The app switch is present on
          every Loom surface except the reader (KAN-8) — it used to sit only on
          author pages, which read as incidental rather than chosen. */}
      <AppHeader showAppSwitch lightMode={lightMode} onToggleLightMode={toggleLightMode} />
      {/* Settings sits outside the author layout, which is where ToastLayer is
          normally mounted — so it needs its own.

          The default bottom offset lifts toasts clear of the editor's footer
          and floating add-block button, neither of which exists here, leaving
          a lopsided gap. Override it to match the right inset so the toast sits
          equally far from both edges. */}
      <div style={{ '--loom-toast-bottom': '0.75rem' } as React.CSSProperties}>
        <ToastLayer />
      </div>

      <main className={`flex-1 overflow-y-auto${lightMode ? ' light-body' : ''}`}>
        <div className="px-8 py-10">
          <h1 className="text-2xl font-bold text-ink mb-2">Settings</h1>
          <button
            onClick={() => router.back()}
            className="flex items-center gap-1.5 text-xs text-ink-muted hover:text-ink transition mb-6"
          >
            <LuArrowLeft size={13} /> Back
          </button>

          <div className="flex gap-1 border-b border-accent/10 mb-8">
            {TABS.map(tab => (
              <button
                key={tab}
                onClick={() => setActiveTab(tab)}
                className={`px-4 py-2 text-sm font-medium rounded-t transition-colors ${
                  activeTab === tab
                    ? 'text-accent border-b-2 border-accent -mb-px'
                    : 'text-ink-faint hover:text-ink'
                }`}
              >
                {tab}
              </button>
            ))}
          </div>

          {/* Profile */}
          {activeTab === 'Profile' && <section>
            <div className="bg-surface-raised border border-accent/10 rounded-xl p-6 flex flex-col gap-5">
              <div className="flex items-center gap-6">
                <input ref={avatarInputRef} type="file" accept="image/*" className="hidden" onChange={handleAvatarFileChange} />
                <button
                  onClick={() => avatarInputRef.current?.click()}
                  title="Upload profile photo"
                  className="w-20 h-20 rounded-full overflow-hidden border-2 border-accent/30 hover:border-accent transition flex items-center justify-center bg-surface-base shrink-0"
                >
                  {hasAvatar
                    ? <img src={`/avatar.jpg?t=${avatarTs}`} alt="Avatar" className="w-full h-full object-cover" />
                    : <LuUser size={28} className="text-ink-faint" />
                  }
                </button>
                <div>
                  <div className="text-sm font-medium text-ink mb-1">Profile Photo</div>
                  <div className="text-xs text-ink-faint">Click the avatar to upload or change your photo.</div>
                </div>
              </div>
              <div>
                <label className="block text-xs uppercase tracking-widest text-ink-faint mb-2">Author Name</label>
                <input
                  value={authorName}
                  onChange={e => setAuthorName(e.target.value)}
                  onBlur={handleAuthorNameBlur}
                  placeholder="Your name"
                  className="w-full bg-surface-base border border-accent/20 rounded-lg px-4 py-2.5 text-sm text-ink placeholder:text-ink-faint outline-none focus:border-accent"
                />
                <p className="text-xs text-ink-faint mt-1.5">Used in exported files to identify the author.</p>
              </div>

              <div>
                <label className="block text-xs uppercase tracking-widest text-ink-faint mb-2">Bio</label>
                <textarea
                  value={bio}
                  onChange={e => setBio(e.target.value)}
                  onBlur={() => patchProfile({ bio })}
                  placeholder="A few sentences about you — appears on your public author bio."
                  rows={4}
                  className="w-full bg-surface-base border border-accent/20 rounded-lg px-4 py-2.5 text-sm text-ink placeholder:text-ink-faint outline-none focus:border-accent resize-y"
                />
              </div>

              <div className="border-t border-accent/10 pt-5">
                <label className="flex items-center gap-2 text-sm text-ink cursor-pointer">
                  <input
                    type="checkbox"
                    checked={pseudonymEnabled}
                    onChange={e => {
                      setPseudonymEnabled(e.target.checked)
                      patchProfile({ pseudonymEnabled: e.target.checked })
                    }}
                    className="accent-accent"
                  />
                  <span>Show me under a pseudonym</span>
                </label>
                <p className="text-xs text-ink-faint mt-1.5 pl-6">
                  When on, your public bio uses the pseudonym below and either
                  blurs your photo or shows the alternate one you upload.
                </p>

                {pseudonymEnabled && (
                  <div className="mt-4 flex flex-col gap-4 pl-6">
                    <div className="flex items-center gap-6">
                      <input
                        ref={pseudonymAvatarInputRef}
                        type="file"
                        accept="image/*"
                        className="hidden"
                        onChange={handlePseudonymAvatarChange}
                      />
                      <div
                        className="w-20 h-20 rounded-full overflow-hidden border-2 border-accent/30 bg-surface-base shrink-0 flex items-center justify-center"
                      >
                        {hasPseudonymAvatar ? (
                          <img
                            src={`/pseudonym-avatar.jpg?t=${pseudonymAvatarTs}`}
                            alt="Pseudonym avatar"
                            className="w-full h-full object-cover"
                          />
                        ) : hasAvatar ? (
                          // Blur the main avatar as the default pseudonym look.
                          <img
                            src={`/avatar.jpg?t=${avatarTs}`}
                            alt=""
                            className="w-full h-full object-cover blur-md scale-110"
                          />
                        ) : (
                          <LuUser size={28} className="text-ink-faint" />
                        )}
                      </div>
                      <div className="flex flex-col gap-1.5">
                        <div className="flex gap-2">
                          <button
                            type="button"
                            onClick={() => pseudonymAvatarInputRef.current?.click()}
                            className="px-3 py-1.5 rounded text-xs bg-surface-base border border-accent/20 text-ink-muted hover:text-ink transition"
                          >
                            {hasPseudonymAvatar ? 'Replace photo' : 'Upload alternate photo'}
                          </button>
                          {hasPseudonymAvatar && (
                            <button
                              type="button"
                              onClick={removePseudonymAvatar}
                              className="px-3 py-1.5 rounded text-xs text-ink-muted hover:text-ink transition"
                            >
                              Use blurred photo instead
                            </button>
                          )}
                        </div>
                        <p className="text-xs text-ink-faint">
                          {hasPseudonymAvatar
                            ? 'Readers see this photo on your public bio.'
                            : 'Readers see your profile photo blurred. Upload an alternate to use a different image.'}
                        </p>
                      </div>
                    </div>

                    <div>
                      <label className="block text-xs uppercase tracking-widest text-ink-faint mb-2">Pseudonym</label>
                      <input
                        value={pseudonym}
                        onChange={e => setPseudonym(e.target.value)}
                        onBlur={() => patchProfile({ pseudonym })}
                        placeholder="The name readers see"
                        className="w-full bg-surface-base border border-accent/20 rounded-lg px-4 py-2.5 text-sm text-ink placeholder:text-ink-faint outline-none focus:border-accent"
                      />
                    </div>
                  </div>
                )}
              </div>
            </div>
          </section>}

          {/* Demo Data */}
          {activeTab === 'Demo Data' && <section>
            <div className="bg-surface-raised border border-accent/10 rounded-xl p-6 flex flex-col gap-4">
              <p className="text-xs text-ink-faint leading-relaxed">
                Generate fake series to see how Explore reads with a real
                catalog. Each one comes with a title, blurb, 1–3 books, and
                a sprinkle of genres + keywords. Cards are flagged internally
                and only the Clear button below deletes them — your real
                series are untouched.
              </p>
              <div className="flex items-end gap-3 flex-wrap">
                <div>
                  <label className="block text-xs uppercase tracking-widest text-ink-faint mb-2">How many?</label>
                  <input
                    type="number"
                    min={1}
                    max={500}
                    value={demoCount}
                    onChange={e => setDemoCount(Math.max(1, Math.min(500, parseInt(e.target.value || '0', 10) || 0)))}
                    className="w-24 bg-surface-base border border-accent/20 rounded-lg px-3 py-2 text-sm text-ink outline-none focus:border-accent"
                  />
                </div>
                <button
                  type="button"
                  onClick={generateDemoData}
                  disabled={demoBusy != null || demoCount <= 0}
                  className="px-4 py-2 rounded bg-accent text-white text-sm font-medium hover:opacity-90 transition disabled:opacity-50"
                >
                  {demoBusy === 'generating' ? 'Generating…' : 'Generate'}
                </button>
                <button
                  type="button"
                  onClick={clearDemoData}
                  disabled={demoBusy != null}
                  className="px-4 py-2 rounded bg-surface-overlay border border-accent/20 text-ink-muted hover:text-ink text-sm font-medium transition disabled:opacity-50"
                >
                  {demoBusy === 'clearing' ? 'Clearing…' : 'Clear demo data'}
                </button>
                {demoStatus && (
                  <span className="text-xs text-ink-muted italic">{demoStatus}</span>
                )}
              </div>
            </div>
          </section>}

          {/* Reader invites (LOOM-132). Sits with the operational tabs rather
              than under Profile: this is about other people's access, not the
              author's identity. */}
          {activeTab === 'Readers' && <ReadersSection />}

          {/* Editor preferences */}
          {activeTab === 'Editor' && <>
            <PanelTabsSection />
            <EditorColorsSection />
          </>}

          {/* Manuscript export formatting + template + canon save location */}
          {activeTab === 'Export' && <>
            <ManuscriptTemplateSection />
            <CanonSaveLocationSection />
            <ExportFormattingSection />
          </>}

          {/* Backups */}
          {activeTab === 'Backups' && <section className="flex flex-col gap-4">
            {/* Back up now (KAN-26).
                Sits ABOVE the schedule settings deliberately: this is the
                thing you reach for at a specific moment — before a big
                restructure, before letting an agent near the database — and
                that moment shouldn't require scrolling past configuration.

                Distinct from a book's Backup button, which exports one story
                as .loom.json. This is the whole database: notes, narration,
                reader sessions and settings included. */}
            <div className="bg-surface-raised border border-accent/10 rounded-xl p-6">
              <div className="flex items-start justify-between gap-6">
                <div>
                  <div className="text-sm font-medium text-ink mb-1 flex items-center gap-2">
                    <LuDatabaseBackup size={14} className="text-accent" /> Database Snapshot
                  </div>
                  <div className="text-xs text-ink-faint leading-relaxed max-w-md">
                    A verified copy of the entire database — everything the book
                    exports below leave out, including chapter notes, narration
                    and reader sessions. Compressed, checked, and copied to
                    Google Drive. Safe to run while you&rsquo;re writing.
                  </div>
                </div>
                <button
                  onClick={runBackupNow}
                  disabled={snapshotting}
                  className="shrink-0 flex items-center gap-1.5 px-4 py-2 rounded-lg bg-accent text-white text-xs font-medium hover:opacity-90 transition disabled:opacity-50"
                >
                  <LuDatabaseBackup size={11} />
                  {snapshotting ? 'Snapshotting…' : 'Snapshot Now'}
                </button>
              </div>

              {/* The result is a toast, not a panel here. A verified backup is
                  worth seeing when it happens and worth forgetting afterwards;
                  a box that stays on the page implies there is something left
                  to do with it. */}
            </div>

            <div className="bg-surface-raised border border-accent/10 rounded-xl p-6 flex flex-col gap-6">

              {/* Enable toggle */}
              <div className="flex items-center justify-between">
                <div>
                  <div className="text-sm font-medium text-ink mb-1 flex items-center gap-2">
                    <LuShield size={14} className="text-accent" /> Automatic Backups
                  </div>
                  <div className="text-xs text-ink-faint">
                    Exports all books to a local folder on a daily schedule.
                  </div>
                </div>
                <button
                  role="switch"
                  aria-checked={backup.enabled}
                  onClick={() => patchBackup({ enabled: !backup.enabled })}
                  className="flex items-center"
                >
                  <span className={`relative inline-flex w-9 h-5 rounded-full transition-colors duration-200 ${backup.enabled ? 'bg-accent' : 'bg-surface-muted'}`}>
                    <span className={`absolute top-0.5 w-4 h-4 rounded-full bg-white shadow transition-all duration-200 ${backup.enabled ? 'left-4' : 'left-0.5'}`} />
                  </span>
                </button>
              </div>

              <div className={`flex flex-col gap-5 transition-opacity duration-200 ${backup.enabled ? 'opacity-100' : 'opacity-40 pointer-events-none'}`}>
                {/* Folder */}
                <div>
                  <label className="block text-xs uppercase tracking-widest text-ink-faint mb-2">Backup Folder</label>
                  <div className="flex gap-2">
                    <input
                      value={backup.folder}
                      onChange={e => setBackup(s => ({ ...s, folder: e.target.value }))}
                      onBlur={() => patchBackup({ folder: backup.folder })}
                      placeholder="/Users/you/Documents/loom-backups"
                      className="flex-1 bg-surface-base border border-accent/20 rounded-lg px-4 py-2.5 text-sm text-ink placeholder:text-ink-faint outline-none focus:border-accent font-mono"
                    />
                    <button
                      onClick={pickFolder}
                      disabled={pickingFolder}
                      title="Choose folder"
                      className="px-3 py-2 rounded-lg bg-surface-base border border-accent/20 text-ink-muted hover:text-ink transition disabled:opacity-50 shrink-0"
                    >
                      <LuFolderOpen size={16} />
                    </button>
                  </div>
                  <p className="text-xs text-ink-faint mt-1.5">
                    Books are saved as <span className="font-mono">Series Name / Book Name / Book Name_YYYY-MM-DD.loom.json</span>
                  </p>
                </div>

                {/* Time + Retention */}
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <label className="block text-xs uppercase tracking-widest text-ink-faint mb-2">Daily Backup Time</label>
                    <input
                      type="time"
                      value={backup.time}
                      onChange={e => setBackup(s => ({ ...s, time: e.target.value }))}
                      onBlur={() => patchBackup({ time: backup.time })}
                      className="w-full bg-surface-base border border-accent/20 rounded-lg px-4 py-2.5 text-sm text-ink outline-none focus:border-accent"
                    />
                  </div>
                  <div>
                    <label className="block text-xs uppercase tracking-widest text-ink-faint mb-2">Keep Backups For</label>
                    <div className="relative">
                      <input
                        type="number"
                        min={1}
                        max={365}
                        value={backup.retentionDays}
                        onChange={e => setBackup(s => ({ ...s, retentionDays: Number(e.target.value) }))}
                        onBlur={() => patchBackup({ retentionDays: backup.retentionDays })}
                        className="w-full bg-surface-base border border-accent/20 rounded-lg px-4 py-2.5 text-sm text-ink outline-none focus:border-accent pr-14"
                      />
                      <span className="absolute right-4 top-1/2 -translate-y-1/2 text-xs text-ink-faint pointer-events-none">days</span>
                    </div>
                  </div>
                </div>

                {/* Run now */}
                <div className="flex items-center justify-between pt-1 border-t border-accent/10">
                  <div>
                    {backupStatus && (
                      <span className={`text-xs ${backupStatus.ok ? 'text-accent' : 'text-choice-kill'}`}>
                        {backupStatus.message}
                      </span>
                    )}
                  </div>
                  <button
                    onClick={runNow}
                    disabled={runningBackup || !backup.folder}
                    className="flex items-center gap-1.5 px-4 py-2 rounded-lg bg-accent text-white text-xs font-medium hover:opacity-90 transition disabled:opacity-50"
                  >
                    <LuPlay size={11} /> {runningBackup ? 'Running…' : 'Run Backup Now'}
                  </button>
                </div>
              </div>

            </div>
          </section>}

        </div>
      </main>

      {imageSrc && (
        <div className="fixed inset-0 z-[100] flex flex-col bg-black/80" onClick={handleAvatarCancel}>
          <div
            className="flex flex-col flex-1 max-w-lg w-full mx-auto my-8 bg-surface-raised rounded-xl overflow-hidden shadow-2xl"
            onClick={e => e.stopPropagation()}
          >
            <div className="flex items-center justify-between px-5 py-4 border-b border-accent/10">
              <span className="text-sm font-medium text-ink">Adjust photo</span>
              <button onClick={handleAvatarCancel} className="text-ink-faint hover:text-ink transition">
                <LuX size={16} />
              </button>
            </div>
            <div className="relative flex-1 min-h-[340px] bg-black">
              <Cropper
                image={imageSrc}
                crop={crop}
                zoom={zoom}
                aspect={1}
                cropShape="round"
                showGrid={false}
                onCropChange={setCrop}
                onZoomChange={setZoom}
                onCropComplete={onCropComplete}
              />
            </div>
            <div className="px-6 py-4 flex items-center gap-3 border-t border-accent/10">
              <span className="text-xs text-ink-faint w-8">Zoom</span>
              <input
                type="range" min={1} max={3} step={0.01} value={zoom}
                onChange={e => setZoom(Number(e.target.value))}
                className="flex-1 accent-accent"
              />
            </div>
            <div className="px-5 pb-5 flex justify-end gap-2">
              <button onClick={handleAvatarCancel} className="px-4 py-2 rounded text-sm text-ink-muted hover:text-ink transition">
                Cancel
              </button>
              <button
                onClick={handleAvatarSave}
                disabled={saving}
                className="px-4 py-2 rounded bg-accent text-white text-sm font-medium hover:opacity-90 transition disabled:opacity-50 flex items-center gap-1.5"
              >
                <LuCheck size={14} />
                {saving ? 'Saving…' : 'Save'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
