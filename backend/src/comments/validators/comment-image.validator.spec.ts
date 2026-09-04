import {
  validateCommentImage,
  MAX_COMMENT_IMAGE_BYTES,
  MAX_COMMENT_IMAGE_WIDTH,
  MAX_COMMENT_IMAGE_HEIGHT,
} from './comment-image.validator';

function createVp8Webp(width: number, height: number, totalSize?: number): Buffer {
  const payloadLen = totalSize ? totalSize - 20 : 10;
  const vp8Payload = Buffer.alloc(payloadLen);
  vp8Payload[0] = 0x00; // keyframe
  vp8Payload[3] = 0x9d;
  vp8Payload[4] = 0x01;
  vp8Payload[5] = 0x2a;
  vp8Payload.writeUInt16LE(width & 0x3fff, 6);
  vp8Payload.writeUInt16LE(height & 0x3fff, 8);

  const chunkHeader = Buffer.alloc(8);
  chunkHeader.write('VP8 ', 0, 'ascii');
  chunkHeader.writeUInt32LE(vp8Payload.length, 4);

  const body = Buffer.concat([chunkHeader, vp8Payload]);
  const header = Buffer.alloc(12);
  header.write('RIFF', 0, 'ascii');
  header.writeUInt32LE(body.length + 4, 4);
  header.write('WEBP', 8, 'ascii');

  return Buffer.concat([header, body]);
}

function createVp8lWebp(width: number, height: number): Buffer {
  const payload = Buffer.alloc(5);
  payload[0] = 0x2f; // signature
  const w = width - 1;
  const h = height - 1;
  payload[1] = w & 0xff;
  payload[2] = ((w >> 8) & 0x3f) | ((h & 0x03) << 6);
  payload[3] = (h >> 2) & 0xff;
  payload[4] = (h >> 10) & 0x0f;

  const chunkHeader = Buffer.alloc(8);
  chunkHeader.write('VP8L', 0, 'ascii');
  chunkHeader.writeUInt32LE(payload.length, 4);

  const body = Buffer.concat([chunkHeader, payload, Buffer.alloc(1)]); // padded to even
  const header = Buffer.alloc(12);
  header.write('RIFF', 0, 'ascii');
  header.writeUInt32LE(body.length + 4, 4);
  header.write('WEBP', 8, 'ascii');

  return Buffer.concat([header, body]);
}

function createVp8xWebp(options: {
  width: number;
  height: number;
  animation?: boolean;
  xmp?: boolean;
  exif?: boolean;
  extraChunks?: Array<{ fourCC: string; payload: Buffer }>;
}): Buffer {
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

  const allChunks = Buffer.concat(chunks);
  const header = Buffer.alloc(12);
  header.write('RIFF', 0, 'ascii');
  header.writeUInt32LE(allChunks.length + 4, 4);
  header.write('WEBP', 8, 'ascii');

  return Buffer.concat([header, allChunks]);
}

describe('CommentImageValidator', () => {
  describe('Happy path validation', () => {
    it('validates a valid simple VP8 WebP within constraints', () => {
      const buffer = createVp8Webp(400, 300);
      const result = validateCommentImage(buffer);

      expect(result.width).toBe(400);
      expect(result.height).toBe(300);
      expect(result.fileSizeBytes).toBe(buffer.length);
      expect(result.fileContentType).toBe('image/webp');
      expect(result.sha256).toMatch(/^[a-f0-9]{64}$/);
    });

    it('validates a valid lossless VP8L WebP', () => {
      const buffer = createVp8lWebp(320, 240);
      const result = validateCommentImage(buffer);

      expect(result.width).toBe(320);
      expect(result.height).toBe(240);
      expect(result.fileSizeBytes).toBe(buffer.length);
      expect(result.fileContentType).toBe('image/webp');
      expect(result.sha256).toMatch(/^[a-f0-9]{64}$/);
    });

    it('validates a valid static VP8X WebP without metadata', () => {
      const buffer = createVp8xWebp({ width: 480, height: 480 });
      const result = validateCommentImage(buffer);

      expect(result.width).toBe(480);
      expect(result.height).toBe(480);
      expect(result.fileSizeBytes).toBe(buffer.length);
      expect(result.fileContentType).toBe('image/webp');
    });

    it('accepts exact boundary dimensions 480x480', () => {
      const buffer = createVp8Webp(MAX_COMMENT_IMAGE_WIDTH, MAX_COMMENT_IMAGE_HEIGHT);
      const result = validateCommentImage(buffer);
      expect(result.width).toBe(480);
      expect(result.height).toBe(480);
    });

    it('accepts exact boundary byte size 100,000 bytes', () => {
      const buffer = createVp8Webp(200, 200, MAX_COMMENT_IMAGE_BYTES);
      expect(buffer.length).toBe(100_000);
      const result = validateCommentImage(buffer);
      expect(result.fileSizeBytes).toBe(100_000);
    });
  });

  describe('Size and dimension constraints', () => {
    it('rejects file exceeding 100,000 bytes with COMMENT_MEDIA_TOO_LARGE', () => {
      const buffer = Buffer.alloc(100_001);
      buffer.write('RIFF', 0);
      buffer.writeUInt32LE(100_001 - 8, 4);
      buffer.write('WEBP', 8);

      expect(() => validateCommentImage(buffer)).toThrow(
        expect.objectContaining({
          code: 'COMMENT_MEDIA_TOO_LARGE',
          message: 'File size exceeds 100,000 bytes',
        }),
      );
    });

    it('rejects image with width > 480 with COMMENT_MEDIA_DIMENSIONS_EXCEEDED', () => {
      const buffer = createVp8Webp(481, 300);
      expect(() => validateCommentImage(buffer)).toThrow(
        expect.objectContaining({
          code: 'COMMENT_MEDIA_DIMENSIONS_EXCEEDED',
          message: 'Dimensions exceed 480x480 pixels',
        }),
      );
    });

    it('rejects image with height > 480 with COMMENT_MEDIA_DIMENSIONS_EXCEEDED', () => {
      const buffer = createVp8Webp(300, 481);
      expect(() => validateCommentImage(buffer)).toThrow(
        expect.objectContaining({
          code: 'COMMENT_MEDIA_DIMENSIONS_EXCEEDED',
          message: 'Dimensions exceed 480x480 pixels',
        }),
      );
    });

    it('rejects VP8X image with dimensions > 480', () => {
      const buffer = createVp8xWebp({ width: 500, height: 200 });
      expect(() => validateCommentImage(buffer)).toThrow(
        expect.objectContaining({
          code: 'COMMENT_MEDIA_DIMENSIONS_EXCEEDED',
        }),
      );
    });
  });

  describe('Animation rejection', () => {
    it('rejects VP8X with animation flag bit set', () => {
      const buffer = createVp8xWebp({ width: 200, height: 200, animation: true });
      expect(() => validateCommentImage(buffer)).toThrow(
        expect.objectContaining({
          code: 'COMMENT_MEDIA_INVALID_FORMAT',
          message: 'Animated images are not supported',
        }),
      );
    });

    it('rejects WebP containing ANIM chunk', () => {
      const buffer = createVp8xWebp({
        width: 200,
        height: 200,
        extraChunks: [{ fourCC: 'ANIM', payload: Buffer.alloc(6) }],
      });
      expect(() => validateCommentImage(buffer)).toThrow(
        expect.objectContaining({
          code: 'COMMENT_MEDIA_INVALID_FORMAT',
          message: 'Animated images are not supported',
        }),
      );
    });

    it('rejects WebP containing ANMF chunk', () => {
      const buffer = createVp8xWebp({
        width: 200,
        height: 200,
        extraChunks: [{ fourCC: 'ANMF', payload: Buffer.alloc(16) }],
      });
      expect(() => validateCommentImage(buffer)).toThrow(
        expect.objectContaining({
          code: 'COMMENT_MEDIA_INVALID_FORMAT',
          message: 'Animated images are not supported',
        }),
      );
    });
  });

  describe('Forbidden metadata rejection', () => {
    it('rejects VP8X with EXIF flag bit set', () => {
      const buffer = createVp8xWebp({ width: 200, height: 200, exif: true });
      expect(() => validateCommentImage(buffer)).toThrow(
        expect.objectContaining({
          code: 'COMMENT_MEDIA_METADATA_FORBIDDEN',
          message: 'Embedded metadata is not permitted',
        }),
      );
    });

    it('rejects VP8X with XMP flag bit set', () => {
      const buffer = createVp8xWebp({ width: 200, height: 200, xmp: true });
      expect(() => validateCommentImage(buffer)).toThrow(
        expect.objectContaining({
          code: 'COMMENT_MEDIA_METADATA_FORBIDDEN',
          message: 'Embedded metadata is not permitted',
        }),
      );
    });

    it('rejects WebP containing EXIF chunk even if flag was forged/unset', () => {
      const buffer = createVp8xWebp({
        width: 200,
        height: 200,
        extraChunks: [{ fourCC: 'EXIF', payload: Buffer.from('exif data') }],
      });
      expect(() => validateCommentImage(buffer)).toThrow(
        expect.objectContaining({
          code: 'COMMENT_MEDIA_METADATA_FORBIDDEN',
          message: 'Embedded metadata is not permitted',
        }),
      );
    });

    it('rejects WebP containing XMP chunk even if flag was forged/unset', () => {
      const buffer = createVp8xWebp({
        width: 200,
        height: 200,
        extraChunks: [{ fourCC: 'XMP ', payload: Buffer.from('<xmp>') }],
      });
      expect(() => validateCommentImage(buffer)).toThrow(
        expect.objectContaining({
          code: 'COMMENT_MEDIA_METADATA_FORBIDDEN',
          message: 'Embedded metadata is not permitted',
        }),
      );
    });
  });

  describe('Malformed and forged files', () => {
    it('rejects empty buffer with COMMENT_MEDIA_INVALID_FORMAT', () => {
      expect(() => validateCommentImage(Buffer.alloc(0))).toThrow(
        expect.objectContaining({ code: 'COMMENT_MEDIA_INVALID_FORMAT' }),
      );
    });

    it('rejects non-WebP files (e.g. JPEG signature disguised as WebP)', () => {
      const jpeg = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46, 0x00, 0x01]);
      expect(() => validateCommentImage(jpeg)).toThrow(
        expect.objectContaining({ code: 'COMMENT_MEDIA_INVALID_FORMAT' }),
      );
    });

    it('rejects truncated RIFF WebP header', () => {
      const truncated = Buffer.from('RIFF\x20\x00\x00\x00WEBP');
      expect(() => validateCommentImage(truncated)).toThrow(
        expect.objectContaining({ code: 'COMMENT_MEDIA_INVALID_FORMAT' }),
      );
    });

    it('rejects truncated VP8 chunk', () => {
      const header = Buffer.alloc(20);
      header.write('RIFF', 0);
      header.writeUInt32LE(12, 4);
      header.write('WEBP', 8);
      header.write('VP8 ', 12);
      header.writeUInt32LE(10, 16); // promises 10 bytes, but ends here

      expect(() => validateCommentImage(header)).toThrow(
        expect.objectContaining({ code: 'COMMENT_MEDIA_INVALID_FORMAT' }),
      );
    });

    it('rejects VP8 with non-keyframe bit set', () => {
      const buffer = createVp8Webp(200, 200);
      // Byte 20 is the first byte of VP8 payload (offset 12 + 8)
      buffer[20] = 0x01; // bit 0 = 1 (interframe)
      expect(() => validateCommentImage(buffer)).toThrow(
        expect.objectContaining({ code: 'COMMENT_MEDIA_INVALID_FORMAT' }),
      );
    });

    it('rejects VP8 with corrupted start code', () => {
      const buffer = createVp8Webp(200, 200);
      buffer[23] = 0x00; // corrupt 0x9d
      expect(() => validateCommentImage(buffer)).toThrow(
        expect.objectContaining({ code: 'COMMENT_MEDIA_INVALID_FORMAT' }),
      );
    });
  });

  describe('blocked media hashes exact matching (Ticket 09)', () => {
    it('rejects an image whose exact sha256 matches a blocked hash with COMMENT_MEDIA_INVALID_FORMAT', () => {
      const buffer = createVp8Webp(200, 200);
      const validResult = validateCommentImage(buffer);
      const blockedSet = new Set([validResult.sha256]);

      expect(() => validateCommentImage(buffer, blockedSet)).toThrow(
        expect.objectContaining({
          code: 'COMMENT_MEDIA_INVALID_FORMAT',
          message: 'Invalid image format',
        }),
      );
    });

    it('permits an image when blockedHashes contains unrelated hashes', () => {
      const buffer = createVp8Webp(200, 200);
      const unrelatedSet = new Set(['e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855']);
      const result = validateCommentImage(buffer, unrelatedSet);
      expect(result.sha256).toBeDefined();
    });

    it('permits a modified image with a distinct hash even if original is blocked', () => {
      const original = createVp8Webp(200, 200);
      const blockedHash = validateCommentImage(original).sha256;
      const modified = createVp8Webp(201, 200);

      const result = validateCommentImage(modified, new Set([blockedHash]));
      expect(result.sha256).not.toBe(blockedHash);
    });
  });
});
