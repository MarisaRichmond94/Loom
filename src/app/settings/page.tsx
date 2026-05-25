'use client'

import { useState, useEffect, useRef, useCallback } from 'react'
import Link from 'next/link'
import { LuMoon, LuSun, LuShield, LuPlay, LuFolderOpen, LuUser, LuX, LuCheck } from 'react-icons/lu'
import Cropper from 'react-easy-crop'
import type { Area } from 'react-easy-crop'
import Greeting from '@/components/Greeting'
import AvatarButton from '@/components/AvatarButton'

async function cropImageToBlob(imageSrc: string, pixelCrop: Area): Promise<Blob> {
  const image = await new Promise<HTMLImageElement>((resolve, reject) => {
    const img = new Image()
    img.onload = () => resolve(img)
    img.onerror = reject
    img.src = imageSrc
  })
  const canvas = document.createElement('canvas')
  canvas.width = pixelCrop.width
  canvas.height = pixelCrop.height
  const ctx = canvas.getContext('2d')!
  ctx.drawImage(image, pixelCrop.x, pixelCrop.y, pixelCrop.width, pixelCrop.height, 0, 0, pixelCrop.width, pixelCrop.height)
  return new Promise((resolve, reject) =>
    canvas.toBlob(b => b ? resolve(b) : reject(new Error('Canvas empty')), 'image/jpeg', 0.92)
  )
}

type BackupSettings = {
  enabled: boolean
  folder: string
  time: string
  retentionDays: number
}

export default function SettingsPage() {
  const [lightMode, setLightMode] = useState(false)
  useEffect(() => {
    setLightMode(localStorage.getItem('loom-light-mode') === 'true')
  }, [])
  const [authorName, setAuthorName] = useState('')
  const [backup, setBackup] = useState<BackupSettings>({
    enabled: false,
    folder: '',
    time: '22:30',
    retentionDays: 30,
  })
  const [backupStatus, setBackupStatus] = useState<{ ok: boolean; message: string } | null>(null)
  const [runningBackup, setRunningBackup] = useState(false)
  const [pickingFolder, setPickingFolder] = useState(false)
  const [hasAvatar, setHasAvatar] = useState(false)
  const [avatarTs, setAvatarTs] = useState(0)
  const [imageSrc, setImageSrc] = useState<string | null>(null)
  const [crop, setCrop] = useState({ x: 0, y: 0 })
  const [zoom, setZoom] = useState(1)
  const [croppedArea, setCroppedArea] = useState<Area | null>(null)
  const [saving, setSaving] = useState(false)
  const avatarInputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    // Prefer the server-side profile (so this matches what public preview
    // pages display), falling back to the legacy localStorage value if the
    // server hasn't been populated yet.
    fetch('/api/settings/profile')
      .then(r => r.ok ? r.json() : { authorName: '' })
      .then((p: { authorName?: string }) => {
        const server = (p.authorName ?? '').trim()
        const local = (localStorage.getItem('loom-author-name') ?? '').trim()
        const initial = server || local
        setAuthorName(initial)
        // Keep localStorage in sync so the author's own greeting/UI sees the
        // same value without a round trip.
        if (initial) localStorage.setItem('loom-author-name', initial)
      })
      .catch(() => setAuthorName(localStorage.getItem('loom-author-name') ?? ''))
    fetch('/api/settings/backup').then(r => r.json()).then(setBackup)
    fetch('/avatar.jpg', { method: 'HEAD' })
      .then(r => { if (r.ok) { setHasAvatar(true); setAvatarTs(Date.now()) } })
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

  function toggleLightMode() {
    setLightMode(prev => {
      const next = !prev
      localStorage.setItem('loom-light-mode', String(next))
      return next
    })
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

  return (
    <div className="h-screen bg-surface-base flex flex-col overflow-hidden">
      <nav className="sticky top-0 z-10 bg-surface-raised border-b border-accent/10 px-6 py-3 flex items-center gap-3 text-sm">
        <Link href="/" className="flex items-center gap-2">
          <img src="/loom-logo.svg" alt="" className="block h-9 w-9" />
          <span className="text-accent font-bold tracking-wider text-2xl leading-none">LOOM</span>
        </Link>
        <span className="text-ink-faint self-center">›</span>
        <span className="text-ink self-center">Settings</span>
        <div className="ml-auto flex items-center gap-2">
          <Greeting />
          <button
            role="switch"
            aria-checked={lightMode}
            onClick={toggleLightMode}
            title={lightMode ? 'Switch to dark mode' : 'Switch to light mode'}
            className="flex items-center gap-1.5 text-ink-faint hover:text-ink transition"
          >
            <LuMoon size={13} />
            <span className={`relative inline-flex w-9 h-5 rounded-full transition-colors duration-200 ${lightMode ? 'bg-accent' : 'bg-surface-muted'}`}>
              <span className={`absolute top-0.5 w-4 h-4 rounded-full bg-white shadow transition-all duration-200 ${lightMode ? 'left-4' : 'left-0.5'}`} />
            </span>
            <LuSun size={13} />
          </button>
          <AvatarButton />
        </div>
      </nav>

      <main className={`flex-1 overflow-y-auto${lightMode ? ' light-body' : ''}`}>
        <div className="max-w-2xl mx-auto px-8 py-10">
          <h1 className="text-2xl font-bold text-ink mb-8">Settings</h1>

          {/* Profile */}
          <section className="mb-8">
            <h2 className="text-xs uppercase tracking-widest text-ink-faint mb-4">Profile</h2>
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
            </div>
          </section>

          {/* Appearance */}
          <section className="mb-8">
            <h2 className="text-xs uppercase tracking-widest text-ink-faint mb-4">Appearance</h2>
            <div className="bg-surface-raised border border-accent/10 rounded-xl p-6">
              <div className="flex items-center justify-between">
                <div>
                  <div className="text-sm font-medium text-ink mb-1">Light Mode</div>
                  <div className="text-xs text-ink-faint">Toggle between light and dark theme.</div>
                </div>
                <button
                  role="switch"
                  aria-checked={lightMode}
                  onClick={toggleLightMode}
                  className="flex items-center gap-1.5 text-ink-faint hover:text-ink transition"
                >
                  <LuMoon size={13} />
                  <span className={`relative inline-flex w-9 h-5 rounded-full transition-colors duration-200 ${lightMode ? 'bg-accent' : 'bg-surface-muted'}`}>
                    <span className={`absolute top-0.5 w-4 h-4 rounded-full bg-white shadow transition-all duration-200 ${lightMode ? 'left-4' : 'left-0.5'}`} />
                  </span>
                  <LuSun size={13} />
                </button>
              </div>
            </div>
          </section>

          {/* Backups */}
          <section>
            <h2 className="text-xs uppercase tracking-widest text-ink-faint mb-4">Backups</h2>
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
          </section>

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
