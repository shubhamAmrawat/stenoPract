import { ApiError } from '../../middleware/errors.js';

export const SCAN_INPUT_TYPES = ['image/jpeg', 'image/png', 'image/webp'];
export const SCAN_MAX_BYTES = 8 * 1024 * 1024;
/** Long edge sent to Claude. Bigger pages are scaled down (fine print stays readable at this size); smaller ones are left alone. */
export const SCAN_MAX_EDGE = 2200;

/** Decodes and re-encodes the upload as a clean JPEG of a sensible size: only real pixels go on to Claude and into storage. */
export async function prepareScanImage(input: Buffer): Promise<Buffer> {
  const { default: sharp } = await import('sharp');
  try {
    const image = sharp(input, { limitInputPixels: 80_000_000, failOn: 'error' });
    const meta = await image.metadata();
    if (!meta.format || !['jpeg', 'png', 'webp'].includes(meta.format)) throw new Error('unsupported format');
    return await image
      .rotate()
      .flatten({ background: '#ffffff' })
      .resize({ width: SCAN_MAX_EDGE, height: SCAN_MAX_EDGE, fit: 'inside', withoutEnlargement: true })
      .jpeg({ quality: 85, mozjpeg: true })
      .toBuffer();
  } catch {
    throw new ApiError(400, 'That file could not be read as an image. Use a JPG, PNG or WebP picture of the page.', 'INVALID_IMAGE');
  }
}
