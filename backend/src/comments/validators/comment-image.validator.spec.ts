import sharp from 'sharp';
import { AppError } from '../../common/errors/app.errors';
import {
  validateCommentImage,
  MAX_COMMENT_IMAGE_BYTES,
  MAX_COMMENT_IMAGE_WIDTH,
  MAX_COMMENT_IMAGE_HEIGHT,
  _setDecoderConcurrencyLimits,
  _resetDecoderConcurrency,
} from './comment-image.validator';

async function createValidLossyWebp(width: number, height: number, totalSize?: number): Promise<Buffer> {
  const base = await sharp({
    create: {
      width,
      height,
      channels: 3,
      background: { r: 120, g: 80, b: 40 },
    },
  })
    .webp({ lossless: false, quality: 80 })
    .toBuffer();

  if (totalSize && totalSize > base.length) {
    const extraLen = totalSize - base.length - 8;
    const junkChunk = Buffer.alloc(8 + extraLen);
    junkChunk.write('JUNK', 0, 'ascii');
    junkChunk.writeUInt32LE(extraLen, 4);

    const riff = Buffer.alloc(12);
    riff.write('RIFF', 0, 'ascii');
    riff.writeUInt32LE(base.length - 8 + junkChunk.length, 4);
    riff.write('WEBP', 8, 'ascii');

    return Buffer.concat([riff, base.subarray(12), junkChunk]);
  }

  return base;
}

async function createValidLosslessWebp(width: number, height: number): Promise<Buffer> {
  return sharp({
    create: {
      width,
      height,
      channels: 3,
      background: { r: 50, g: 150, b: 200 },
    },
  })
    .webp({ lossless: true })
    .toBuffer();
}

async function createValidVp8xWebp(options: {
  width: number;
  height: number;
  animation?: boolean;
  xmp?: boolean;
  exif?: boolean;
  extraChunks?: Array<{ fourCC: string; payload: Buffer }>;
  frameOverride?: Buffer;
}): Promise<Buffer> {
  const frameChunk =
    options.frameOverride ?? (await createValidLosslessWebp(options.width, options.height)).subarray(12);

  const flags = (options.animation ? 0x02 : 0) | (options.xmp ? 0x04 : 0) | (options.exif ? 0x08 : 0);

  const vp8xPayload = Buffer.alloc(10);
  vp8xPayload[0] = flags;
  const w = options.width - 1;
  const h = options.height - 1;
  vp8xPayload[4] = w & 0xff;
  vp8xPayload[5] = (w >> 8) & 0xff;
  vp8xPayload[6] = (w >> 16) & 0xff;
  vp8xPayload[7] = h & 0xff;
  vp8xPayload[8] = (h >> 8) & 0xff;
  vp8xPayload[9] = (h >> 16) & 0xff;

  const vp8xChunk = Buffer.alloc(18);
  vp8xChunk.write('VP8X', 0, 'ascii');
  vp8xChunk.writeUInt32LE(10, 4);
  vp8xPayload.copy(vp8xChunk, 8);

  const chunks: Buffer[] = [vp8xChunk];

  if (options.extraChunks) {
    for (const chunk of options.extraChunks) {
      const ch = Buffer.alloc(8);
      ch.write(chunk.fourCC, 0, 'ascii');
      ch.writeUInt32LE(chunk.payload.length, 4);
      const pad = chunk.payload.length % 2 === 1 ? Buffer.alloc(1) : Buffer.alloc(0);
      chunks.push(Buffer.concat([ch, chunk.payload, pad]));
    }
  }

  chunks.push(frameChunk);

  const allChunks = Buffer.concat(chunks);
  const header = Buffer.alloc(12);
  header.write('RIFF', 0, 'ascii');
  header.writeUInt32LE(allChunks.length + 4, 4);
  header.write('WEBP', 8, 'ascii');

  return Buffer.concat([header, allChunks]);
}

describe('CommentImageValidator', () => {
  afterEach(() => {
    _resetDecoderConcurrency();
  });

  describe('Happy path validation', () => {
    it('validates a valid simple VP8 WebP within constraints', async () => {
      const buffer = await createValidLossyWebp(400, 300);
      const result = await validateCommentImage(buffer);

      expect(result.width).toBe(400);
      expect(result.height).toBe(300);
      expect(result.fileSizeBytes).toBe(buffer.length);
      expect(result.fileContentType).toBe('image/webp');
      expect(result.sha256).toMatch(/^[a-f0-9]{64}$/);
    });

    it('validates a valid lossless VP8L WebP', async () => {
      const buffer = await createValidLosslessWebp(320, 240);
      const result = await validateCommentImage(buffer);

      expect(result.width).toBe(320);
      expect(result.height).toBe(240);
      expect(result.fileSizeBytes).toBe(buffer.length);
      expect(result.fileContentType).toBe('image/webp');
      expect(result.sha256).toMatch(/^[a-f0-9]{64}$/);
    });

    it('validates a valid static VP8X WebP without metadata', async () => {
      const buffer = await createValidVp8xWebp({ width: 480, height: 480 });
      const result = await validateCommentImage(buffer);

      expect(result.width).toBe(480);
      expect(result.height).toBe(480);
      expect(result.fileSizeBytes).toBe(buffer.length);
      expect(result.fileContentType).toBe('image/webp');
    });

    it('accepts exact boundary dimensions 480x480', async () => {
      const buffer = await createValidLossyWebp(MAX_COMMENT_IMAGE_WIDTH, MAX_COMMENT_IMAGE_HEIGHT);
      const result = await validateCommentImage(buffer);
      expect(result.width).toBe(480);
      expect(result.height).toBe(480);
    });

    it('accepts exact boundary byte size 100,000 bytes', async () => {
      const buffer = await createValidLossyWebp(200, 200, MAX_COMMENT_IMAGE_BYTES);
      expect(buffer.length).toBe(100_000);
      const result = await validateCommentImage(buffer);
      expect(result.fileSizeBytes).toBe(100_000);
    });
  });

  describe('Size and dimension constraints', () => {
    it('rejects file exceeding 100,000 bytes with COMMENT_MEDIA_TOO_LARGE', async () => {
      const buffer = Buffer.alloc(100_001);
      buffer.write('RIFF', 0);
      buffer.writeUInt32LE(100_001 - 8, 4);
      buffer.write('WEBP', 8);

      await expect(validateCommentImage(buffer)).rejects.toMatchObject({
        code: 'COMMENT_MEDIA_TOO_LARGE',
        message: 'File size exceeds 100,000 bytes',
      });
    });

    it('rejects image with width > 480 with COMMENT_MEDIA_DIMENSIONS_EXCEEDED', async () => {
      const buffer = await createValidLossyWebp(481, 300);
      await expect(validateCommentImage(buffer)).rejects.toMatchObject({
        code: 'COMMENT_MEDIA_DIMENSIONS_EXCEEDED',
        message: 'Dimensions exceed 480x480 pixels',
      });
    });

    it('rejects image with height > 480 with COMMENT_MEDIA_DIMENSIONS_EXCEEDED', async () => {
      const buffer = await createValidLossyWebp(300, 481);
      await expect(validateCommentImage(buffer)).rejects.toMatchObject({
        code: 'COMMENT_MEDIA_DIMENSIONS_EXCEEDED',
        message: 'Dimensions exceed 480x480 pixels',
      });
    });

    it('rejects VP8X image with dimensions > 480', async () => {
      const buffer = await createValidVp8xWebp({ width: 500, height: 200 });
      await expect(validateCommentImage(buffer)).rejects.toMatchObject({
        code: 'COMMENT_MEDIA_DIMENSIONS_EXCEEDED',
      });
    });

    it('rejects input pixels exceeding 230,400', async () => {
      // 481 * 480 = 230,880
      const buffer = await createValidLossyWebp(481, 480);
      await expect(validateCommentImage(buffer)).rejects.toMatchObject({
        code: 'COMMENT_MEDIA_DIMENSIONS_EXCEEDED',
      });
    });
  });

  describe('Actual Decoding: 30-byte header, corrupt/truncated payloads, and canvas mismatch (Ticket 02 Spec 2)', () => {
    it('rejects a 30-byte header-only VP8X object by actual decoding and container validation', async () => {
      const riffHeader = Buffer.alloc(12);
      riffHeader.write('RIFF', 0, 'ascii');
      riffHeader.writeUInt32LE(22, 4);
      riffHeader.write('WEBP', 8, 'ascii');

      const vp8xChunk = Buffer.alloc(18);
      vp8xChunk.write('VP8X', 0, 'ascii');
      vp8xChunk.writeUInt32LE(10, 4);

      const headerOnly30 = Buffer.concat([riffHeader, vp8xChunk]);
      expect(headerOnly30.length).toBe(30);

      await expect(validateCommentImage(headerOnly30)).rejects.toMatchObject({
        code: 'COMMENT_MEDIA_INVALID_FORMAT',
        message: 'Invalid image format',
      });
    });

    it('rejects a truncated compressed VP8 payload by actual decoding', async () => {
      const valid = await createValidLossyWebp(200, 200);
      // Cut off half the compressed payload
      const truncated = valid.subarray(0, Math.floor(valid.length / 2));
      // Fix up RIFF size header to pretend it ends here
      truncated.writeUInt32LE(truncated.length - 8, 4);

      await expect(validateCommentImage(truncated)).rejects.toMatchObject({
        code: 'COMMENT_MEDIA_INVALID_FORMAT',
      });
    });

    it('rejects a corrupt compressed payload where bitstream is damaged', async () => {
      const valid = await createValidLossyWebp(200, 200);
      const corrupt = Buffer.from(valid);
      // Corrupt compressed payload bytes
      for (let i = 25; i < Math.min(corrupt.length, 60); i++) {
        corrupt[i] = 0xff;
      }

      await expect(validateCommentImage(corrupt)).rejects.toMatchObject({
        code: 'COMMENT_MEDIA_INVALID_FORMAT',
      });
    });

    it('rejects inconsistent canvas and frame dimensions in VP8X container', async () => {
      // Create a 200x200 frame chunk
      const frame200 = await createValidLosslessWebp(200, 200);
      // Wrap it in a VP8X container that claims canvas is 400x400
      const mismatched = await createValidVp8xWebp({
        width: 400,
        height: 400,
        frameOverride: frame200.subarray(12),
      });

      await expect(validateCommentImage(mismatched)).rejects.toMatchObject({
        code: 'COMMENT_MEDIA_INVALID_FORMAT',
      });
    });
  });

  describe('Animation rejection', () => {
    it('rejects VP8X with animation flag bit set', async () => {
      const buffer = await createValidVp8xWebp({ width: 200, height: 200, animation: true });
      await expect(validateCommentImage(buffer)).rejects.toMatchObject({
        code: 'COMMENT_MEDIA_INVALID_FORMAT',
        message: 'Animated images are not supported',
      });
    });

    it('rejects WebP containing ANIM chunk', async () => {
      const buffer = await createValidVp8xWebp({
        width: 200,
        height: 200,
        extraChunks: [{ fourCC: 'ANIM', payload: Buffer.alloc(6) }],
      });
      await expect(validateCommentImage(buffer)).rejects.toMatchObject({
        code: 'COMMENT_MEDIA_INVALID_FORMAT',
        message: 'Animated images are not supported',
      });
    });

    it('rejects WebP containing ANMF chunk', async () => {
      const buffer = await createValidVp8xWebp({
        width: 200,
        height: 200,
        extraChunks: [{ fourCC: 'ANMF', payload: Buffer.alloc(16) }],
      });
      await expect(validateCommentImage(buffer)).rejects.toMatchObject({
        code: 'COMMENT_MEDIA_INVALID_FORMAT',
        message: 'Animated images are not supported',
      });
    });
  });

  describe('Forbidden metadata rejection', () => {
    it('rejects VP8X with EXIF flag bit set', async () => {
      const buffer = await createValidVp8xWebp({ width: 200, height: 200, exif: true });
      await expect(validateCommentImage(buffer)).rejects.toMatchObject({
        code: 'COMMENT_MEDIA_METADATA_FORBIDDEN',
        message: 'Embedded metadata is not permitted',
      });
    });

    it('rejects VP8X with XMP flag bit set', async () => {
      const buffer = await createValidVp8xWebp({ width: 200, height: 200, xmp: true });
      await expect(validateCommentImage(buffer)).rejects.toMatchObject({
        code: 'COMMENT_MEDIA_METADATA_FORBIDDEN',
        message: 'Embedded metadata is not permitted',
      });
    });

    it('rejects WebP containing EXIF chunk even if flag was forged/unset', async () => {
      const buffer = await createValidVp8xWebp({
        width: 200,
        height: 200,
        extraChunks: [{ fourCC: 'EXIF', payload: Buffer.from('exif data') }],
      });
      await expect(validateCommentImage(buffer)).rejects.toMatchObject({
        code: 'COMMENT_MEDIA_METADATA_FORBIDDEN',
        message: 'Embedded metadata is not permitted',
      });
    });

    it('rejects WebP containing XMP chunk even if flag was forged/unset', async () => {
      const buffer = await createValidVp8xWebp({
        width: 200,
        height: 200,
        extraChunks: [{ fourCC: 'XMP ', payload: Buffer.from('<xmp>') }],
      });
      await expect(validateCommentImage(buffer)).rejects.toMatchObject({
        code: 'COMMENT_MEDIA_METADATA_FORBIDDEN',
        message: 'Embedded metadata is not permitted',
      });
    });
  });

  describe('Malformed and forged files', () => {
    it('rejects empty buffer with COMMENT_MEDIA_INVALID_FORMAT', async () => {
      await expect(validateCommentImage(Buffer.alloc(0))).rejects.toMatchObject({
        code: 'COMMENT_MEDIA_INVALID_FORMAT',
      });
    });

    it('rejects non-WebP files (e.g. JPEG signature disguised as WebP)', async () => {
      const jpeg = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46, 0x00, 0x01]);
      await expect(validateCommentImage(jpeg)).rejects.toMatchObject({
        code: 'COMMENT_MEDIA_INVALID_FORMAT',
      });
    });

    it('rejects truncated RIFF WebP header', async () => {
      const truncated = Buffer.from('RIFF\x20\x00\x00\x00WEBP');
      await expect(validateCommentImage(truncated)).rejects.toMatchObject({
        code: 'COMMENT_MEDIA_INVALID_FORMAT',
      });
    });

    it('rejects truncated VP8 chunk', async () => {
      const header = Buffer.alloc(20);
      header.write('RIFF', 0);
      header.writeUInt32LE(12, 4);
      header.write('WEBP', 8);
      header.write('VP8 ', 12);
      header.writeUInt32LE(10, 16); // promises 10 bytes, but ends here

      await expect(validateCommentImage(header)).rejects.toMatchObject({
        code: 'COMMENT_MEDIA_INVALID_FORMAT',
      });
    });

    it('rejects VP8 with non-keyframe bit set', async () => {
      const buffer = await createValidLossyWebp(200, 200);
      // Byte 20 is first byte of VP8 payload
      buffer[20] = 0x01; // bit 0 = 1 (interframe)
      await expect(validateCommentImage(buffer)).rejects.toMatchObject({
        code: 'COMMENT_MEDIA_INVALID_FORMAT',
      });
    });

    it('rejects VP8 with corrupted start code', async () => {
      const buffer = await createValidLossyWebp(200, 200);
      buffer[23] = 0x00; // corrupt 0x9d
      await expect(validateCommentImage(buffer)).rejects.toMatchObject({
        code: 'COMMENT_MEDIA_INVALID_FORMAT',
      });
    });
  });

  describe('blocked media hashes exact matching (Ticket 09)', () => {
    it('rejects an image whose exact sha256 matches a blocked hash with COMMENT_MEDIA_INVALID_FORMAT', async () => {
      const buffer = await createValidLossyWebp(200, 200);
      const validResult = await validateCommentImage(buffer);
      const blockedSet = new Set([validResult.sha256]);

      await expect(validateCommentImage(buffer, blockedSet)).rejects.toMatchObject({
        code: 'COMMENT_MEDIA_INVALID_FORMAT',
        message: 'Invalid image format',
      });
    });

    it('permits an image when blockedHashes contains unrelated hashes', async () => {
      const buffer = await createValidLossyWebp(200, 200);
      const unrelatedSet = new Set(['e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855']);
      const result = await validateCommentImage(buffer, unrelatedSet);
      expect(result.sha256).toBeDefined();
    });

    it('permits a modified image with a distinct hash even if original is blocked', async () => {
      const original = await createValidLossyWebp(200, 200);
      const blockedHash = (await validateCommentImage(original)).sha256;
      const modified = await createValidLossyWebp(201, 200);

      const result = await validateCommentImage(modified, new Set([blockedHash]));
      expect(result.sha256).not.toBe(blockedHash);
    });
  });

  describe('Resource and Concurrency Bounding (Ticket 02 Criterion 4)', () => {
    it('enforces decoder execution timeout bound safely with retryable error', async () => {
      const buffer = await createValidLossyWebp(200, 200);
      _setDecoderConcurrencyLimits({ decoderTimeoutMs: 1 }); // 1ms timeout

      try {
        await validateCommentImage(buffer);
        throw new Error('Expected to throw');
      } catch (err) {
        expect(err).toBeInstanceOf(AppError);
        if (err instanceof AppError) {
          expect(err.code).toBe('COMMENT_MEDIA_PROCESSING_FAILED');
          expect(err.message).toMatch(/execution limit exceeded|timed out/i);
        }
      }
    });

    it('enforces concurrency queue bounds safely when decoder capacity is exceeded', async () => {
      const buffer = await createValidLossyWebp(100, 100);
      _setDecoderConcurrencyLimits({ maxConcurrent: 1, maxQueue: 1, acquireTimeoutMs: 10 });

      // Run multiple concurrent decodes
      const promises = [
        validateCommentImage(buffer),
        validateCommentImage(buffer),
        validateCommentImage(buffer),
        validateCommentImage(buffer),
      ];

      const results = await Promise.allSettled(promises);
      const rejections = results.filter((r) => r.status === 'rejected');
      expect(rejections.length).toBeGreaterThan(0);
      for (const rej of rejections) {
        if (rej.status === 'rejected') {
          expect(rej.reason).toMatchObject({
            code: 'COMMENT_MEDIA_PROCESSING_FAILED',
          });
        }
      }
    });
  });
});
