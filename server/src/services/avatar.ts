import { ApiError } from '../middleware/errors.js';

export const AVATAR_SIZE = 512;
export const AVATAR_CONTENT_TYPE = 'image/webp';
/** What the upload route accepts as a request body. */
export const AVATAR_INPUT_TYPES = ['image/jpeg', 'image/png', 'image/webp'];
export const AVATAR_MAX_BYTES = 2 * 1024 * 1024;

/**
 * Turns whatever the student sent into a clean square WebP.
 * Decoding and re-encoding is the safety step: only real pixels come out, with no metadata (GPS, camera), no scripts, and a
 * fixed size and format, whatever the original file claimed to be.
 */
export async function processAvatar(input: Buffer): Promise<Buffer> {
  const { default: sharp } = await import('sharp');
  try {
    const image = sharp(input, { limitInputPixels: 40_000_000, failOn: 'error' });
    const meta = await image.metadata();
    if (!meta.format || !['jpeg', 'png', 'webp'].includes(meta.format)) throw new Error('unsupported format');
    return await image
      .rotate() // apply the phone's orientation flag before the metadata is dropped
      .resize(AVATAR_SIZE, AVATAR_SIZE, { fit: 'cover', position: 'centre' })
      .webp({ quality: 82 })
      .toBuffer();
  } catch {
    throw new ApiError(400, 'That file could not be read as a photo. Use a JPG, PNG or WebP picture.', 'INVALID_IMAGE');
  }
}
