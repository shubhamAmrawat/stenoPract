// Turns a PDF page or a picture into a JPEG small enough to upload. Runs in the browser, so the server needs no PDF software.

import type { PDFDocumentProxy } from 'pdfjs-dist'

/** Long edge of the uploaded picture. The server scales again if needed; this keeps uploads to a few hundred KB. */
export const MAX_EDGE = 2200
const QUALITY = 0.85

function canvasToJpeg(canvas: HTMLCanvasElement): Promise<Blob> {
  return new Promise((resolve, reject) => {
    canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('Could not turn the page into a picture'))), 'image/jpeg', QUALITY)
  })
}

/** Opens a PDF. pdf.js is loaded only when it is needed (it is a big library). */
export async function openPdf(file: File): Promise<PDFDocumentProxy> {
  const [pdfjs, worker] = await Promise.all([import('pdfjs-dist/legacy/build/pdf.mjs'), import('pdfjs-dist/legacy/build/pdf.worker.min.mjs?url')])
  pdfjs.GlobalWorkerOptions.workerSrc = worker.default
  const data = new Uint8Array(await file.arrayBuffer())
  try {
    return await pdfjs.getDocument({ data, wasmUrl: `${import.meta.env.BASE_URL}pdfjs-wasm/` }).promise
  } catch (err) {
    if (err instanceof Error && err.name === 'PasswordException') throw new Error(`${file.name} is password protected`)
    throw new Error(`${file.name} could not be opened as a PDF`)
  }
}

/** True when a small copy of the canvas has no dark pixel at all (real text, even faint, always leaves some). */
function isBlank(canvas: HTMLCanvasElement): boolean {
  const small = document.createElement('canvas')
  small.width = 220
  small.height = Math.max(1, Math.round((220 * canvas.height) / canvas.width))
  const ctx = small.getContext('2d', { willReadFrequently: true })
  if (!ctx) return false
  ctx.drawImage(canvas, 0, 0, small.width, small.height)
  const { data } = ctx.getImageData(0, 0, small.width, small.height)
  for (let i = 0; i < data.length; i += 4) if (data[i]! < 235) return false
  return true
}

export async function renderPdfPage(doc: PDFDocumentProxy, pageNo: number): Promise<Blob> {
  const page = await doc.getPage(pageNo)
  const base = page.getViewport({ scale: 1 })
  const scale = Math.min(MAX_EDGE / Math.max(base.width, base.height), 4)
  const viewport = page.getViewport({ scale })
  const canvas = document.createElement('canvas')
  canvas.width = Math.ceil(viewport.width)
  canvas.height = Math.ceil(viewport.height)
  const ctx = canvas.getContext('2d')
  if (!ctx) throw new Error('This browser cannot draw the page')
  ctx.fillStyle = '#ffffff'
  ctx.fillRect(0, 0, canvas.width, canvas.height)
  await page.render({ canvas, viewport }).promise
  page.cleanup()
  // A page that could not be drawn comes out plain white. Say so here instead of paying to have Claude read a blank picture.
  if (isBlank(canvas)) throw new Error(`Page ${pageNo} came out blank: this PDF could not be drawn in the browser. Export the pages as JPG pictures instead.`)
  return canvasToJpeg(canvas)
}

export async function imageToJpeg(file: File): Promise<Blob> {
  let bitmap: ImageBitmap
  try {
    bitmap = await createImageBitmap(file, { imageOrientation: 'from-image' })
  } catch {
    throw new Error(`${file.name} could not be read as a picture`)
  }
  const scale = Math.min(1, MAX_EDGE / Math.max(bitmap.width, bitmap.height))
  const canvas = document.createElement('canvas')
  canvas.width = Math.round(bitmap.width * scale)
  canvas.height = Math.round(bitmap.height * scale)
  const ctx = canvas.getContext('2d')
  if (!ctx) throw new Error('This browser cannot draw the picture')
  ctx.fillStyle = '#ffffff'
  ctx.fillRect(0, 0, canvas.width, canvas.height)
  ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height)
  bitmap.close()
  return canvasToJpeg(canvas)
}

export const isPdf = (f: File) => f.type === 'application/pdf' || /\.pdf$/i.test(f.name)
export const isPicture = (f: File) => /^image\/(jpeg|png|webp)$/.test(f.type) || /\.(jpe?g|png|webp)$/i.test(f.name)
