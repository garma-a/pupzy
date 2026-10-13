import sharp from 'sharp';
import { MAX_POST_IMAGE_BYTES, sanitizePostImage } from './post-image.validator';

describe('post image validation', () => {
  const image = () => sharp({ create: { width: 8, height: 6, channels: 3, background: '#abcdef' } });

  it('rejects non-images and SVG without decoding them', async () => {
    await expect(sanitizePostImage(Buffer.from('not a photograph'), 'image/jpeg')).rejects.toMatchObject({
      code: 'VALIDATION_ERROR',
    });
    await expect(
      sanitizePostImage(Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"/>'), 'image/jpeg'),
    ).rejects.toMatchObject({ code: 'VALIDATION_ERROR' });
  });

  it('rejects MIME mismatches and damaged image data', async () => {
    const png = await image().png().toBuffer();
    await expect(sanitizePostImage(png, 'image/jpeg')).rejects.toMatchObject({ code: 'VALIDATION_ERROR' });
    await expect(sanitizePostImage(Buffer.from([0xff, 0xd8, 0xff, 0]), 'image/jpeg')).rejects.toMatchObject({
      code: 'VALIDATION_ERROR',
    });
  });

  it('rejects oversized bytes and images whose decoded pixel count exceeds the limit', async () => {
    await expect(sanitizePostImage(Buffer.alloc(MAX_POST_IMAGE_BYTES + 1), 'image/jpeg')).rejects.toMatchObject({
      code: 'VALIDATION_ERROR',
    });
    const large = await sharp({ create: { width: 4001, height: 4001, channels: 3, background: '#abc' } })
      .png()
      .toBuffer();
    await expect(sanitizePostImage(large, 'image/png')).rejects.toMatchObject({ code: 'VALIDATION_ERROR' });
  });

  it.each(['jpeg', 'png', 'webp'] as const)('fully decodes and preserves the allowed %s format', async (format) => {
    const bytes = await image().toFormat(format).toBuffer();
    const sanitized = await sanitizePostImage(bytes, `image/${format}`);
    expect(await sharp(sanitized).metadata()).toMatchObject({ format, width: 8, height: 6 });
    await expect(sharp(sanitized).raw().toBuffer()).resolves.toBeInstanceOf(Buffer);
  });

  it('applies EXIF orientation and removes GPS metadata before publication', async () => {
    const bytes = await image()
      .withMetadata({ orientation: 6 })
      .withExifMerge({
        IFD3: {
          GPSLatitudeRef: 'N',
          GPSLatitude: '30/1 3/1 45/1',
          GPSLongitudeRef: 'E',
          GPSLongitude: '31/1 13/1 11/1',
        },
      })
      .jpeg()
      .toBuffer();
    expect((await sharp(bytes).metadata()).exif).toBeDefined();
    const metadata = await sharp(await sanitizePostImage(bytes, 'image/jpeg')).metadata();
    expect(metadata).toMatchObject({ width: 6, height: 8 });
    expect(metadata.exif).toBeUndefined();
    expect(metadata.xmp).toBeUndefined();
  });
});
