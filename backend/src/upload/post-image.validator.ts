import sharp from 'sharp';
import { ValidationError } from '../common/errors/app.errors';

export const MAX_POST_IMAGE_BYTES = 5_242_880;
// Current clients resize to 1600×1600; bound native memory for the shared four-slot pool.
const MAX_POST_IMAGE_PIXELS = 4_000_000;

/** Decode only allowed raster formats, then encode without location or other metadata. */
export async function sanitizePostImage(bytes: Buffer, contentType: string): Promise<Buffer> {
  const format =
    contentType === 'image/jpeg'
      ? 'jpeg'
      : contentType === 'image/png'
        ? 'png'
        : contentType === 'image/webp'
          ? 'webp'
          : undefined;
  const signatureMatches =
    format === 'jpeg'
      ? bytes.subarray(0, 3).equals(Buffer.from([0xff, 0xd8, 0xff]))
      : format === 'png'
        ? bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))
        : format === 'webp' && bytes.toString('ascii', 0, 4) === 'RIFF' && bytes.toString('ascii', 8, 12) === 'WEBP';
  if (!format || !signatureMatches || bytes.length === 0 || bytes.length > MAX_POST_IMAGE_BYTES) {
    throw new ValidationError('Upload must contain an allowed image matching its declared type and size');
  }
  try {
    const image = sharp(bytes, { failOn: 'error', limitInputPixels: MAX_POST_IMAGE_PIXELS });
    const metadata = await image.metadata();
    if (metadata.format !== format || (metadata.pages ?? 1) > 1) {
      throw new Error('Unsupported image format or animation');
    }
    const sanitized = await image.rotate().toFormat(format).timeout({ seconds: 5 }).toBuffer();
    if (sanitized.length > MAX_POST_IMAGE_BYTES) throw new Error('Encoded image too large');
    return sanitized;
  } catch {
    throw new ValidationError('Image is invalid, animated, or exceeds supported dimensions');
  }
}
