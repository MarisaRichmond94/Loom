'use client'

// Cover preparation and upload, shared by the book page and the book settings
// dialog (LOOM-156).
//
// Extracted rather than copied: the size cap and JPEG quality below are tuned
// values with a history (LOOM-143), and a second copy would drift from the one
// that got tuned.

/**
 * Covers arrive straight from art tools as multi-MB PNGs; downscale to a
 * display-appropriate JPEG before upload so /covers never accumulates 15MB
 * originals.
 *
 * 2400px on the long edge is still several times the largest size any view
 * renders a cover at (220x320, ~440x640 at 2x retina), leaving headroom the old
 * 1600px cap didn't have. Quality 0.95 rather than 0.85 (LOOM-143) — 0.85 was
 * visibly introducing JPEG blocking artifacts on cover art with gradients or
 * fine texture, which read as "grainy" once object-fit:cover resampled it into
 * the series page's smaller card.
 */
export async function downscaleCoverToBlob(file: File, maxEdge = 2400): Promise<Blob> {
  const url = URL.createObjectURL(file)
  try {
    const image = await new Promise<HTMLImageElement>((resolve, reject) => {
      const img = new Image()
      img.onload = () => resolve(img)
      img.onerror = reject
      img.src = url
    })
    const scale = Math.min(1, maxEdge / Math.max(image.width, image.height))
    const canvas = document.createElement('canvas')
    canvas.width = Math.round(image.width * scale)
    canvas.height = Math.round(image.height * scale)
    const ctx = canvas.getContext('2d')!
    // JPEG has no alpha channel — flatten any transparency to white instead of
    // the black canvas default.
    ctx.fillStyle = '#fff'
    ctx.fillRect(0, 0, canvas.width, canvas.height)
    ctx.drawImage(image, 0, 0, canvas.width, canvas.height)
    return new Promise((resolve, reject) =>
      canvas.toBlob(b => b ? resolve(b) : reject(new Error('Canvas empty')), 'image/jpeg', 0.95),
    )
  } finally {
    URL.revokeObjectURL(url)
  }
}

/**
 * Upload a cover for a book that already exists.
 *
 * Needs a bookId because the stored filename IS the book id — which is why the
 * add flow holds the file until after the book is created rather than
 * uploading first.
 */
export async function uploadBookCover(
  seriesId: string,
  bookId: string,
  file: File,
): Promise<boolean> {
  // Downscale before upload; fall back to the original if the browser can't
  // decode it (the server accepts either).
  let upload: File = file
  try {
    const blob = await downscaleCoverToBlob(file)
    upload = new File([blob], 'cover.jpg', { type: 'image/jpeg' })
  } catch { /* keep original */ }
  const form = new FormData()
  form.append('cover', upload)
  const res = await fetch(`/api/series/${seriesId}/books/${bookId}/cover`, {
    method: 'POST',
    body: form,
  })
  return res.ok
}
