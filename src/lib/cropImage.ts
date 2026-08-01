import type { Area } from 'react-easy-crop'

/**
 * Render the selected crop region to a JPEG blob.
 *
 * Extracted from settings/page.tsx and book/[bookId]/page.tsx, which had
 * identical copies — a third was about to be written for character portraits.
 * The quality (0.92) and format matter: they are what every already-uploaded
 * avatar was produced with, so keeping one implementation keeps new uploads
 * looking like old ones.
 */
export async function cropImageToBlob(imageSrc: string, pixelCrop: Area): Promise<Blob> {
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
  ctx.drawImage(
    image,
    pixelCrop.x,
    pixelCrop.y,
    pixelCrop.width,
    pixelCrop.height,
    0,
    0,
    pixelCrop.width,
    pixelCrop.height,
  )
  return new Promise((resolve, reject) =>
    canvas.toBlob(b => (b ? resolve(b) : reject(new Error('Canvas empty'))), 'image/jpeg', 0.92),
  )
}
