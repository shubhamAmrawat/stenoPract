const ACCEPTED = /^image\/(jpeg|png|webp)$/
const MAX_INPUT_BYTES = 25 * 1024 * 1024

/**
 * Crops a photo to a centred square and shrinks it, right in the browser, before it is uploaded.
 * A phone photo of 6 MB becomes about 60 KB, so the upload is quick even on a weak connection.
 */
export async function squarePhoto(file: File, size = 512): Promise<Blob> {
  if (!ACCEPTED.test(file.type)) throw new Error('Choose a JPG, PNG or WebP photo.')
  if (file.size > MAX_INPUT_BYTES) throw new Error('That photo is too large. Choose one under 25 MB.')

  let bitmap: ImageBitmap
  try {
    bitmap = await createImageBitmap(file, { imageOrientation: 'from-image' })
  } catch {
    throw new Error('That file could not be read as a photo.')
  }
  try {
    const side = Math.min(bitmap.width, bitmap.height)
    const out = Math.min(size, side)
    const canvas = document.createElement('canvas')
    canvas.width = out
    canvas.height = out
    const ctx = canvas.getContext('2d')
    if (!ctx) throw new Error('Your browser could not process the photo.')
    ctx.fillStyle = '#fff' // a transparent PNG would otherwise turn black as a JPEG
    ctx.fillRect(0, 0, out, out)
    ctx.imageSmoothingQuality = 'high'
    ctx.drawImage(bitmap, (bitmap.width - side) / 2, (bitmap.height - side) / 2, side, side, 0, 0, out, out)
    const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/jpeg', 0.88))
    if (!blob) throw new Error('Your browser could not process the photo.')
    return blob
  } finally {
    bitmap.close()
  }
}
