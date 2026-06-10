'use client'

import { useRef, useState } from 'react'
import { LuMusic, LuUpload, LuX, LuDownload } from 'react-icons/lu'
import { formatPinTime, parsePinTime, pinLabel } from '@/lib/pinLabel'
import PinnedAudio from '@/components/PinnedAudio'
import { ConditionRow } from './conditionUI'

type Variable = { id: string; name: string; type: string; defaultValue?: string }

type Props = {
  block: { id: string; prompt?: string | null; content?: string | null; pinStart?: number | null; pinEnd?: number | null; hasAlbumArt?: boolean; condition?: string | null }
  variables: Variable[]
  onUpdateBlock: (data: { prompt?: string; content?: string | null; pinStart?: number | null; pinEnd?: number | null; condition?: string | null }) => void
}

export default function SoundtrackBlock({ block, variables, onUpdateBlock }: Props) {
  const [title, setTitle] = useState(block.prompt ?? '')
  const [audioSrc, setAudioSrc] = useState(block.content ?? null)
  const [uploading, setUploading] = useState(false)
  const [youtubeUrl, setYoutubeUrl] = useState('')
  const [downloading, setDownloading] = useState(false)
  const [ytError, setYtError] = useState<string | null>(null)
  const [pinStartInput, setPinStartInput] = useState(block.pinStart != null ? formatPinTime(block.pinStart) : '')
  const [pinEndInput, setPinEndInput] = useState(block.pinEnd != null ? formatPinTime(block.pinEnd) : '')
  const [pinStartError, setPinStartError] = useState(false)
  const [pinEndError, setPinEndError] = useState(false)
  const fileInputRef = useRef<HTMLInputElement>(null)
  // Album art: optimistic local copy so an upload renders without waiting
  // for a parent refetch. albumArtTs busts the browser cache on replace.
  const [hasAlbumArt, setHasAlbumArt] = useState(block.hasAlbumArt ?? false)
  const [albumArtTs, setAlbumArtTs] = useState(0)
  const albumArtInputRef = useRef<HTMLInputElement>(null)

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
    // The audio DELETE route also unlinks the album-art sidecar — reflect that.
    setHasAlbumArt(false)
    onUpdateBlock({ content: null })
  }

  async function handleAlbumArtChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (!file) return
    const form = new FormData()
    form.append('art', file)
    const res = await fetch(`/api/blocks/${block.id}/album-art`, { method: 'POST', body: form })
    if (res.ok) {
      setHasAlbumArt(true)
      setAlbumArtTs(Date.now())
    }
    e.target.value = ''
  }

  async function removeAlbumArt() {
    const res = await fetch(`/api/blocks/${block.id}/album-art`, { method: 'DELETE' })
    if (res.ok) setHasAlbumArt(false)
  }

  function handleTitleBlur() {
    const trimmed = title.trim()
    if (trimmed !== (block.prompt ?? '')) {
      onUpdateBlock({ prompt: trimmed })
    }
  }

  function commitPin(which: 'start' | 'end', raw: string) {
    if (raw.trim() === '') {
      if (which === 'start') { setPinStartError(false); onUpdateBlock({ pinStart: null }) }
      else { setPinEndError(false); onUpdateBlock({ pinEnd: null }) }
      return
    }
    const parsed = parsePinTime(raw)
    if (parsed == null) {
      if (which === 'start') setPinStartError(true); else setPinEndError(true)
      return
    }
    if (which === 'start') {
      setPinStartError(false)
      setPinStartInput(formatPinTime(parsed))
      onUpdateBlock({ pinStart: parsed })
    } else {
      setPinEndError(false)
      setPinEndInput(formatPinTime(parsed))
      onUpdateBlock({ pinEnd: parsed })
    }
  }

  const label = pinLabel(block.pinStart, block.pinEnd)

  // The album-art slot is shared by both layouts (audio-loaded and
  // upload-prompt) so each can stack it next to its column.
  const albumArtSlot = (
    <button
      type="button"
      onClick={() => albumArtInputRef.current?.click()}
      title={hasAlbumArt ? 'Replace album art' : 'Upload album art'}
      className={`group/art relative shrink-0 w-[72px] h-[72px] rounded overflow-hidden flex items-center justify-center transition ${
        hasAlbumArt
          ? 'border border-accent/20 hover:border-accent/50'
          : 'border border-dashed border-accent/30 hover:border-accent/60 bg-surface-muted'
      }`}
    >
      {hasAlbumArt
        ? <img src={`/music/${block.id}-art.jpg?t=${albumArtTs}`} alt="" className="w-full h-full object-cover" />
        : <LuMusic size={20} className="text-accent" />}
      {hasAlbumArt && (
        <span
          role="button"
          tabIndex={-1}
          onClick={e => { e.stopPropagation(); removeAlbumArt() }}
          title="Remove album art"
          className="absolute top-0 right-0 w-5 h-5 rounded-bl bg-black/60 text-white opacity-0 group-hover/art:opacity-100 transition flex items-center justify-center hover:bg-choice-kill/80 cursor-pointer"
        >
          <LuX size={11} />
        </span>
      )}
    </button>
  )

  return (
    <div className="flex flex-col gap-3">
      <input
        ref={albumArtInputRef}
        type="file"
        accept="image/*"
        className="hidden"
        onChange={handleAlbumArtChange}
      />

      {/* Optional visibility gate. Defaults to "always" (empty condition);
          attach variables via the + menu to make this song only play in
          some branches. Same AND/OR + searchable picker the choice block
          and conditional fragment use. */}
      <ConditionRow
        label="Plays if:"
        condition={block.condition ?? null}
        variables={variables}
        onChange={next => onUpdateBlock({ condition: next })}
      />

      {/* Audio area — album art lives in a left column, title + player stack
          in the right column so the art spans both rows (matches the book
          page's track list). */}
      {audioSrc ? (
        <>
          <div className="flex items-start gap-3">
            {albumArtSlot}
            <div className="flex-1 min-w-0 flex flex-col gap-2">
              <input
                value={title}
                onChange={e => setTitle(e.target.value)}
                onBlur={handleTitleBlur}
                placeholder="Song title…"
                className="bg-transparent border-none outline-none text-sm text-ink placeholder:text-ink-faint"
              />
              <div className="flex items-center gap-2">
                <PinnedAudio
                  src={audioSrc}
                  pinStart={block.pinStart}
                  pinEnd={block.pinEnd}
                  className="flex-1 min-w-0"
                />
                <button
                  onClick={handleRemove}
                  title="Remove audio"
                  className="shrink-0 text-ink-faint hover:text-choice-kill transition"
                >
                  <LuX size={14} />
                </button>
              </div>
            </div>
          </div>
          <div className="flex items-center gap-2 text-xs">
            <span className="text-ink-faint shrink-0">Pin:</span>
            <input
              value={pinStartInput}
              onChange={e => setPinStartInput(e.target.value)}
              onBlur={() => commitPin('start', pinStartInput)}
              placeholder="start"
              className={`w-16 bg-surface-muted border rounded px-2 py-0.5 text-ink placeholder:text-ink-faint outline-none focus:border-accent/40 ${pinStartError ? 'border-choice-kill/60' : 'border-accent/10'}`}
            />
            <span className="text-ink-faint">to</span>
            <input
              value={pinEndInput}
              onChange={e => setPinEndInput(e.target.value)}
              onBlur={() => commitPin('end', pinEndInput)}
              placeholder="end"
              className={`w-16 bg-surface-muted border rounded px-2 py-0.5 text-ink placeholder:text-ink-faint outline-none focus:border-accent/40 ${pinEndError ? 'border-choice-kill/60' : 'border-accent/10'}`}
            />
            <span className="text-ink-faint italic ml-1">
              {label ?? 'Plays the full track'}
            </span>
          </div>
        </>
      ) : (
        <div className="flex items-start gap-3">
          {albumArtSlot}
          <div className="flex-1 min-w-0 flex flex-col gap-2">
            <input
              value={title}
              onChange={e => setTitle(e.target.value)}
              onBlur={handleTitleBlur}
              placeholder="Song title…"
              className="bg-transparent border-none outline-none text-sm text-ink placeholder:text-ink-faint"
            />
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
