import * as crypto from 'crypto';
import sharp from 'sharp';
import { AppError } from '../../common/errors/app.errors';

export const MAX_COMMENT_IMAGE_BYTES = 100_000;
export const MAX_COMMENT_IMAGE_WIDTH = 480;
export const MAX_COMMENT_IMAGE_HEIGHT = 480;
export const MAX_COMMENT_IMAGE_PIXELS = 480 * 480; // 230,400

export interface ValidatedCommentImage {
  width: number;
  height: number;
  fileSizeBytes: number;
  fileContentType: string;
  sha256: string;
}

// Global sharp configuration for bounded resource consumption on 512MB RAM
sharp.cache({ memory: 32, items: 20 });
sharp.concurrency(1);

let maxConcurrentDecodes = 4;
let maxQueueLength = 16;
let acquireTimeoutMs = 1000;
let decoderTimeoutMs = 2000;

let activeDecodes = 0;
const waitingQueue: Array<{
  resolve: () => void;
  reject: (err: Error) => void;
  timer: NodeJS.Timeout;
}> = [];

export function _setDecoderConcurrencyLimits(options: {
  maxConcurrent?: number;
  maxQueue?: number;
  acquireTimeoutMs?: number;
  decoderTimeoutMs?: number;
}): void {
  if (options.maxConcurrent !== undefined) maxConcurrentDecodes = options.maxConcurrent;
  if (options.maxQueue !== undefined) maxQueueLength = options.maxQueue;
  if (options.acquireTimeoutMs !== undefined) acquireTimeoutMs = options.acquireTimeoutMs;
  if (options.decoderTimeoutMs !== undefined) decoderTimeoutMs = options.decoderTimeoutMs;
}

export function _resetDecoderConcurrency(): void {
  maxConcurrentDecodes = 4;
  maxQueueLength = 16;
  acquireTimeoutMs = 1000;
  decoderTimeoutMs = 2000;
  for (const item of waitingQueue) {
    clearTimeout(item.timer);
    item.reject(new AppError('Decoder reset', 'COMMENT_MEDIA_PROCESSING_FAILED', { retryable: true }));
  }
  waitingQueue.length = 0;
  activeDecodes = 0;
}

async function acquireDecoderSlot(): Promise<() => void> {
  if (activeDecodes < maxConcurrentDecodes) {
    activeDecodes++;
    return () => releaseDecoderSlot();
  }

  if (waitingQueue.length >= maxQueueLength) {
    throw new AppError('Image decoder capacity exceeded', 'COMMENT_MEDIA_PROCESSING_FAILED', {
      retryable: true,
    });
  }

  return new Promise<() => void>((resolve, reject) => {
    const timer = setTimeout(() => {
      const idx = waitingQueue.findIndex((w) => w.resolve === onSlotAcquired);
      if (idx !== -1) waitingQueue.splice(idx, 1);
      reject(
        new AppError('Image decoder acquisition timed out', 'COMMENT_MEDIA_PROCESSING_FAILED', {
          retryable: true,
        }),
      );
    }, acquireTimeoutMs);

    function onSlotAcquired() {
      clearTimeout(timer);
      activeDecodes++;
      resolve(() => releaseDecoderSlot());
    }

    waitingQueue.push({ resolve: onSlotAcquired, reject, timer });
  });
}

function releaseDecoderSlot(): void {
  activeDecodes = Math.max(0, activeDecodes - 1);
  if (waitingQueue.length > 0 && activeDecodes < maxConcurrentDecodes) {
    const next = waitingQueue.shift();
    if (next) {
      next.resolve();
    }
  }
}

/**
 * Binary validator and decoder for Comment image uploads.
 *
 * Enforces strict authoritative constraints on raw WebP bytes:
 * - Exact byte size <= 100,000 bytes
 * - Canonical RIFF WebP header ('RIFF', size, 'WEBP')
 * - Single-frame, static image only (rejects animation flag, ANIM/ANMF chunks, and multi-page streams)
 * - Stripped metadata (rejects EXIF and XMP flags and chunks)
 * - Maximum dimensions of 480x480 pixels and <= 230,400 pixels
 * - Actual WebP decoding of the full compressed payload (VP8/VP8L) via libwebp
 * - Rejection of 30-byte header-only VP8X, truncated/corrupt payloads, and canvas/frame dimension mismatches
 * - Decoder bounds: explicit input-pixel (230,400), memory (32MB cache), timeout (2000ms), and concurrency limiting
 * - Computes SHA-256 hash for exact-match moderation
 */
export async function validateCommentImage(
  buffer: Buffer,
  blockedHashes?: Set<string> | Iterable<string>,
): Promise<ValidatedCommentImage> {
  // 1. Byte limit check: exact bytes <= 100,000
  if (buffer.length > MAX_COMMENT_IMAGE_BYTES) {
    throw new AppError('File size exceeds 100,000 bytes', 'COMMENT_MEDIA_TOO_LARGE');
  }

  if (buffer.length < 12) {
    throw new AppError('Invalid image format', 'COMMENT_MEDIA_INVALID_FORMAT');
  }

  // 2. Header check: 'RIFF', size, 'WEBP'
  const riffHeader = buffer.toString('ascii', 0, 4);
  const webpHeader = buffer.toString('ascii', 8, 12);

  if (riffHeader !== 'RIFF' || webpHeader !== 'WEBP') {
    throw new AppError('Invalid image format', 'COMMENT_MEDIA_INVALID_FORMAT');
  }

  const riffSize = buffer.readUInt32LE(4);
  // Truncated if buffer is smaller than declared RIFF payload + 8
  if (riffSize + 8 > buffer.length) {
    throw new AppError('Invalid image format', 'COMMENT_MEDIA_INVALID_FORMAT');
  }

  let offset = 12;
  let frameCount = 0;
  let isVp8x = false;
  let vp8xWidth = 0;
  let vp8xHeight = 0;
  let frameWidth = 0;
  let frameHeight = 0;

  while (offset < buffer.length) {
    // Need at least 8 bytes for chunk header (4 bytes FourCC + 4 bytes size)
    if (offset + 8 > buffer.length) {
      throw new AppError('Invalid image format', 'COMMENT_MEDIA_INVALID_FORMAT');
    }

    const fourCC = buffer.toString('ascii', offset, offset + 4);
    const chunkSize = buffer.readUInt32LE(offset + 4);
    const payloadOffset = offset + 8;
    const nextOffset = payloadOffset + chunkSize + (chunkSize & 1); // 2-byte chunk padding

    if (payloadOffset + chunkSize > buffer.length) {
      throw new AppError('Invalid image format', 'COMMENT_MEDIA_INVALID_FORMAT');
    }

    // Check for forbidden animation chunks
    if (fourCC === 'ANIM' || fourCC === 'ANMF') {
      throw new AppError('Animated images are not supported', 'COMMENT_MEDIA_INVALID_FORMAT');
    }

    // Check for forbidden metadata chunks
    if (fourCC === 'EXIF' || fourCC === 'XMP ') {
      throw new AppError('Embedded metadata is not permitted', 'COMMENT_MEDIA_METADATA_FORBIDDEN');
    }

    if (fourCC === 'VP8X') {
      if (isVp8x) {
        throw new AppError('Invalid image format', 'COMMENT_MEDIA_INVALID_FORMAT');
      }
      isVp8x = true;
      if (chunkSize < 10) {
        throw new AppError('Invalid image format', 'COMMENT_MEDIA_INVALID_FORMAT');
      }

      const flags = buffer.readUInt8(payloadOffset);

      // Bit 1: Animation flag
      if ((flags & 0x02) !== 0) {
        throw new AppError('Animated images are not supported', 'COMMENT_MEDIA_INVALID_FORMAT');
      }

      // Bit 3: EXIF, Bit 2: XMP
      if ((flags & 0x08) !== 0 || (flags & 0x04) !== 0) {
        throw new AppError('Embedded metadata is not permitted', 'COMMENT_MEDIA_METADATA_FORBIDDEN');
      }

      // 24-bit canvas width minus one at payloadOffset + 4
      const canvasWidthMinusOne =
        buffer[payloadOffset + 4] | (buffer[payloadOffset + 5] << 8) | (buffer[payloadOffset + 6] << 16);
      // 24-bit canvas height minus one at payloadOffset + 7
      const canvasHeightMinusOne =
        buffer[payloadOffset + 7] | (buffer[payloadOffset + 8] << 8) | (buffer[payloadOffset + 9] << 16);

      vp8xWidth = canvasWidthMinusOne + 1;
      vp8xHeight = canvasHeightMinusOne + 1;
    } else if (fourCC === 'VP8 ') {
      frameCount++;
      if (chunkSize < 10) {
        throw new AppError('Invalid image format', 'COMMENT_MEDIA_INVALID_FORMAT');
      }

      // First 3 bytes: frame tag
      const b0 = buffer.readUInt8(payloadOffset);
      // Bit 0: 0 for keyframe, 1 for interframe
      if ((b0 & 0x01) !== 0) {
        throw new AppError('Invalid image format', 'COMMENT_MEDIA_INVALID_FORMAT');
      }

      // Bytes 3, 4, 5: Start code 0x9d, 0x01, 0x2a
      if (
        buffer[payloadOffset + 3] !== 0x9d ||
        buffer[payloadOffset + 4] !== 0x01 ||
        buffer[payloadOffset + 5] !== 0x2a
      ) {
        throw new AppError('Invalid image format', 'COMMENT_MEDIA_INVALID_FORMAT');
      }

      // Bytes 6-7: 16-bit little-endian width code (14-bit width)
      const rawWidth = buffer.readUInt16LE(payloadOffset + 6);
      frameWidth = rawWidth & 0x3fff;

      // Bytes 8-9: 16-bit little-endian height code (14-bit height)
      const rawHeight = buffer.readUInt16LE(payloadOffset + 8);
      frameHeight = rawHeight & 0x3fff;
    } else if (fourCC === 'VP8L') {
      frameCount++;
      if (chunkSize < 5) {
        throw new AppError('Invalid image format', 'COMMENT_MEDIA_INVALID_FORMAT');
      }

      // Byte 0: 1-byte signature 0x2f
      if (buffer[payloadOffset] !== 0x2f) {
        throw new AppError('Invalid image format', 'COMMENT_MEDIA_INVALID_FORMAT');
      }

      const b0 = buffer[payloadOffset + 1];
      const b1 = buffer[payloadOffset + 2];
      const b2 = buffer[payloadOffset + 3];
      const b3 = buffer[payloadOffset + 4];

      // 14 bits width (bits 0..13)
      frameWidth = 1 + (b0 | ((b1 & 0x3f) << 8));
      // 14 bits height (bits 14..27)
      frameHeight = 1 + (((b1 & 0xc0) >> 6) | (b2 << 2) | ((b3 & 0x0f) << 10));
      // Version (bits 29..31)
      const version = (b3 & 0xe0) >> 5;
      if (version !== 0) {
        throw new AppError('Invalid image format', 'COMMENT_MEDIA_INVALID_FORMAT');
      }
    }

    offset = nextOffset;
  }

  // Exactly one frame chunk must exist (rejects 30-byte header-only VP8X)
  if (frameCount === 0 || frameWidth <= 0 || frameHeight <= 0) {
    throw new AppError('Invalid image format', 'COMMENT_MEDIA_INVALID_FORMAT');
  }

  if (frameCount > 1) {
    throw new AppError('Animated images are not supported', 'COMMENT_MEDIA_INVALID_FORMAT');
  }

  // If VP8X container was present, canvas dimensions must match nested frame dimensions
  if (isVp8x) {
    if (vp8xWidth !== frameWidth || vp8xHeight !== frameHeight) {
      throw new AppError('Invalid image format', 'COMMENT_MEDIA_INVALID_FORMAT');
    }
  }

  const checkWidth = isVp8x ? vp8xWidth : frameWidth;
  const checkHeight = isVp8x ? vp8xHeight : frameHeight;

  // Dimension bounds check: <= 480 pixels per dimension
  if (checkWidth > MAX_COMMENT_IMAGE_WIDTH || checkHeight > MAX_COMMENT_IMAGE_HEIGHT) {
    throw new AppError('Dimensions exceed 480x480 pixels', 'COMMENT_MEDIA_DIMENSIONS_EXCEEDED');
  }

  // Input pixel bound: width * height <= 480 * 480 = 230,400
  if (checkWidth * checkHeight > MAX_COMMENT_IMAGE_PIXELS) {
    throw new AppError('Dimensions exceed 480x480 pixels', 'COMMENT_MEDIA_DIMENSIONS_EXCEEDED');
  }

  // 3. Actual WebP decoding with sharp within concurrency, memory, and execution limits
  const releaseSlot = await acquireDecoderSlot();
  let decodedWidth = 0;
  let decodedHeight = 0;

  try {
    const decodePromise = (async () => {
      const img = sharp(buffer, {
        failOn: 'error',
        limitInputPixels: MAX_COMMENT_IMAGE_PIXELS,
        sequentialRead: true,
      });
      const meta = await img.metadata();
      if (meta.format !== 'webp') {
        throw new AppError('Invalid image format', 'COMMENT_MEDIA_INVALID_FORMAT');
      }
      if (meta.pages && meta.pages > 1) {
        throw new AppError('Animated images are not supported', 'COMMENT_MEDIA_INVALID_FORMAT');
      }
      decodedWidth = meta.width ?? 0;
      decodedHeight = meta.height ?? 0;

      // Fully decode compressed bitstream into raw pixel buffer
      const raw = await img.raw().toBuffer();
      if (!raw || raw.length === 0) {
        throw new AppError('Invalid image format', 'COMMENT_MEDIA_INVALID_FORMAT');
      }
    })();

    let timeoutId: NodeJS.Timeout;
    const timeoutPromise = new Promise<never>((_, reject) => {
      timeoutId = setTimeout(() => {
        reject(
          new AppError('Decoder execution limit exceeded', 'COMMENT_MEDIA_PROCESSING_FAILED', {
            retryable: true,
          }),
        );
      }, decoderTimeoutMs);
    });

    try {
      await Promise.race([decodePromise, timeoutPromise]);
    } finally {
      clearTimeout(timeoutId!);
    }
  } catch (err) {
    if (err instanceof AppError) throw err;
    throw new AppError('Invalid image format', 'COMMENT_MEDIA_INVALID_FORMAT');
  } finally {
    releaseSlot();
  }

  // Verify decoded dimensions match container dimensions
  if (decodedWidth !== checkWidth || decodedHeight !== checkHeight) {
    throw new AppError('Invalid image format', 'COMMENT_MEDIA_INVALID_FORMAT');
  }

  if (decodedWidth > MAX_COMMENT_IMAGE_WIDTH || decodedHeight > MAX_COMMENT_IMAGE_HEIGHT) {
    throw new AppError('Dimensions exceed 480x480 pixels', 'COMMENT_MEDIA_DIMENSIONS_EXCEEDED');
  }

  if (decodedWidth * decodedHeight > MAX_COMMENT_IMAGE_PIXELS) {
    throw new AppError('Dimensions exceed 480x480 pixels', 'COMMENT_MEDIA_DIMENSIONS_EXCEEDED');
  }

  // 4. Compute SHA-256 digest
  const sha256 = crypto.createHash('sha256').update(buffer).digest('hex');

  // Exact-match blocked-media set check (if passed)
  if (blockedHashes) {
    const isBlocked = blockedHashes instanceof Set ? blockedHashes.has(sha256) : new Set(blockedHashes).has(sha256);
    if (isBlocked) {
      throw new AppError('Invalid image format', 'COMMENT_MEDIA_INVALID_FORMAT');
    }
  }

  return {
    width: decodedWidth,
    height: decodedHeight,
    fileSizeBytes: buffer.length,
    fileContentType: 'image/webp',
    sha256,
  };
}
