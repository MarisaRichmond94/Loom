'use client'

import { useRef, useState } from 'react'
import { LuMusic, LuUpload, LuX, LuDownload } from 'react-icons/lu'

type Props = {
  block: { id: string; prompt?: string | null; content?: string | null }
  onUpdateBlock: (data: { prompt?: string; content?: string | null }) => void
}

export default function SoundtrackBlock({ block, onUpdateBlock }: Props) {
  const [title, setTitle] = useState(block.prompt ?? '')
  const [audioSrc, setAudioSrc] = useState(block.content ?? null)
  const [uploading, setUploading] = useState(false)
  const [youtubeUrl, setYoutubeUrl] = useState('')
  const [downloading, setDownloading] = useState(false)
  const [ytError, setYtError] = useState<string | null>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)

  async function handleFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (!file) return
    setUploading(true)
    const form = new FormData()
    form.append('audio', file)
    const res = await fetch(`/api/blocks/${block.id}/audio`, { method: 'POST', body: form })
    if (res.ok) {
      const { audioPath } = await res.json()
      const src = `${audioPath}?t=${Date.now()}`
      setAudioSrc(src)
      onUpdateBlock({ content: src })
    }
    setUploading(false)
    e.target.value = ''
  }

  async function handleYoutubeDownload() {
    if (!youtubeUrl.trim()) return
    setDownloading(true)
    setYtError(null)
    const res = await fetch(`/api/blocks/${block.id}/audio/youtube`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ url: youtubeUrl.trim() }),
    })
    const data = await res.json()
    if (res.ok) {
      const src = `${data.audioPath}?t=${Date.now()}`
      setAudioSrc(src)
      setYoutubeUrl('')
      onUpdateBlock({ content: src })
    } else {
      setYtError(data.error ?? 'Download failed')
    }
    setDownloading(false)
  }

  async function handleRemove() {
    await fetch(`/api/blocks/${block.id}/audio`, { method: 'DELETE' })
    setAudioSrc(null)
    onUpdateBlock({ content: null })
  }

  function handleTitleBlur() {
    const trimmed = title.trim()
    if (trimmed !== (block.prompt ?? '')) {
      onUpdateBlock({ prompt: trimmed })
    }
  }

  return (
    <div className="flex flex-col gap-3">
      {/* Title row */}
      <div className="flex items-center gap-2">
        <LuMusic size={14} className="text-accent shrink-0" />
        <input
          value={title}
          onChange={e => setTitle(e.target.value)}
          onBlur={handleTitleBlur}
          placeholder="Song title…"
          className="flex-1 bg-transparent border-none outline-none text-sm text-ink placeholder:text-ink-faint"
        />
      </div>

      {/* Audio area */}
      {audioSrc ? (
        <div className="flex items-center gap-2">
          <audio controls src={audioSrc} className="flex-1 h-8 min-w-0" />
          <button
            onClick={handleRemove}
            title="Remove audio"
            className="shrink-0 text-ink-faint hover:text-choice-kill transition"
          >
            <LuX size={14} />
          </button>
        </div>
      ) : (
        <div className="flex flex-col gap-2">
          {/* File upload */}
          <button
            onClick={() => fileInputRef.current?.click()}
            disabled={uploading || downloading}
            className="flex items-center justify-center gap-2 w-full py-3 rounded-lg border border-dashed border-accent/30 text-xs text-ink-faint hover:border-accent/60 hover:text-ink transition disabled:opacity-50"
          >
            <LuUpload size={12} />
            {uploading ? 'Uploading…' : 'Upload audio file'}
          </button>

          {/* Divider */}
          <div className="flex items-center gap-2 text-ink-faint text-xs">
            <span className="flex-1 h-px bg-accent/10" />
            <span>or</span>
            <span className="flex-1 h-px bg-accent/10" />
          </div>

          {/* YouTube URL */}
          <div className="flex gap-2">
            <input
              value={youtubeUrl}
              onChange={e => { setYoutubeUrl(e.target.value); setYtError(null) }}
              onKeyDown={e => e.key === 'Enter' && handleYoutubeDownload()}
              placeholder="Paste YouTube URL…"
              disabled={downloading || uploading}
              className="flex-1 min-w-0 px-2.5 py-1.5 rounded-lg bg-surface-muted border border-accent/10 text-xs text-ink placeholder:text-ink-faint outline-none focus:border-accent/30 transition disabled:opacity-50"
            />
            <button
              onClick={handleYoutubeDownload}
              disabled={!youtubeUrl.trim() || downloading || uploading}
              title="Download audio from YouTube"
              className="shrink-0 px-2.5 py-1.5 rounded-lg bg-surface-muted border border-accent/10 text-xs text-ink-faint hover:text-ink hover:border-accent/30 transition disabled:opacity-40 flex items-center gap-1.5"
            >
              <LuDownload size={12} />
              {downloading ? 'Downloading…' : 'Download'}
            </button>
          </div>

          {ytError && (
            <p className="text-xs text-choice-kill leading-snug">{ytError}</p>
          )}
        </div>
      )}

      <input
        ref={fileInputRef}
        type="file"
        accept=".mp3,.m4a,.aac,.wav,.ogg,.flac,audio/*"
        className="hidden"
        onChange={handleFileChange}
      />
    </div>
  )
}
