'use client'

import { useCallback, useState } from 'react'
import { createPortal } from 'react-dom'
import Cropper from 'react-easy-crop'
import type { Area } from 'react-easy-crop'
import { LuCheck, LuX } from 'react-icons/lu'
import { cropImageToBlob } from '@/lib/cropImage'
import { portalHost } from '@/lib/portalHost'

/**
 * Frame a portrait before it is uploaded (LOOM-33 / LOOM-46).
 *
 * A photo is almost never the right crop straight off disk — the face is
 * off-centre, or it is a landscape shot that a circular avatar would slice
 * through. Uploading raw and hoping is how the Plan page ends up full of
 * portraits with someone's forehead missing.
 *
 * Round crop at 1:1 because that is exactly how every avatar renders. Matches
 * the dialog Loom already uses for the writer's own photo and for book covers,
 * so it is the same gesture in a third place rather than a new one.
 */
export function PhotoCropDialog({
  file,
  onCancel,
  onCropped,
}: {
  file: File
  onCancel: () => void
  onCropped: (blob: Blob) => void | Promise<void>
}) {
  const [imageSrc] = useState(() => URL.createObjectURL(file))
  const [crop, setCrop] = useState({ x: 0, y: 0 })
  const [zoom, setZoom] = useState(1)
  const [area, setArea] = useState<Area | null>(null)
  const [busy, setBusy] = useState(false)

  const onCropComplete = useCallback((_: Area, pixels: Area) => setArea(pixels), [])

  function cancel() {
    URL.revokeObjectURL(imageSrc)
    onCancel()
  }

  async function accept() {
    if (!area) return
    setBusy(true)
    try {
      const blob = await cropImageToBlob(imageSrc, area)
      URL.revokeObjectURL(imageSrc)
      await onCropped(blob)
    } finally {
      setBusy(false)
    }
  }

  // z-[300] so it sits above the character modal, which opens it.
  //
  // Centred and modest rather than a full-height sheet: a dialog that fills
  // the window to crop a 40px avatar reads as something having gone wrong.
  return createPortal(
    <div className="fixed inset-0 z-[300] flex items-center justify-center bg-black/70 px-4" onMouseDown={cancel}>
      <div
        className="flex w-full max-w-[320px] flex-col overflow-hidden rounded-xl bg-surface-raised shadow-2xl"
        onMouseDown={e => e.stopPropagation()}
      >
        <div className="flex items-center justify-between border-b border-accent/10 px-4 py-2.5">
          <span className="text-xs font-medium text-ink">Adjust photo</span>
          <button onClick={cancel} aria-label="Cancel" className="text-ink-faint transition hover:text-ink">
            <LuX size={14} />
          </button>
        </div>
        <div className="relative h-[240px] bg-black">
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
        <div className="flex items-center gap-2.5 border-t border-accent/10 px-4 py-2.5">
          <span className="text-[10px] text-ink-faint">Zoom</span>
          <input
            type="range"
            min={1}
            max={3}
            step={0.01}
            value={zoom}
            onChange={e => setZoom(Number(e.target.value))}
            aria-label="Zoom"
            className="flex-1 accent-accent"
          />
        </div>
        <div className="flex justify-end gap-2 px-4 pb-4">
          <button onClick={cancel} className="rounded px-3 py-1.5 text-xs text-ink-muted transition hover:text-ink">
            Cancel
          </button>
          <button
            onClick={accept}
            disabled={busy || !area}
            className="flex items-center gap-1.5 rounded bg-accent px-3 py-1.5 text-xs font-medium text-white transition hover:opacity-90 disabled:opacity-50"
          >
            <LuCheck size={12} />
            {busy ? 'Saving…' : 'Save'}
          </button>
        </div>
      </div>
    </div>,
    portalHost(),
  )
}
