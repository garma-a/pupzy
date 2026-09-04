import { validateRequestCommentImageUploadInput } from './request-comment-image-upload.input';
import { ValidationError } from '../../common/errors/app.errors';

describe('validateRequestCommentImageUploadInput', () => {
  it('validates a valid input payload', () => {
    const result = validateRequestCommentImageUploadInput({
      contentType: 'image/webp',
      fileSizeBytes: 80_000,
    });

    expect(result).toEqual({
      contentType: 'image/webp',
      fileSizeBytes: 80_000,
    });
  });

  it('accepts exact boundary file size 100,000 bytes', () => {
    const result = validateRequestCommentImageUploadInput({
      contentType: 'image/webp',
      fileSizeBytes: 100_000,
    });

    expect(result.fileSizeBytes).toBe(100_000);
  });

  it('rejects content type other than image/webp with COMMENT_MEDIA_INVALID_FORMAT', () => {
    expect(() =>
      validateRequestCommentImageUploadInput({
        contentType: 'image/jpeg',
        fileSizeBytes: 50_000,
      }),
    ).toThrow(
      expect.objectContaining({
        code: 'COMMENT_MEDIA_INVALID_FORMAT',
        message: 'Only static WebP images are allowed',
      }),
    );

    expect(() =>
      validateRequestCommentImageUploadInput({
        contentType: 'image/png',
        fileSizeBytes: 50_000,
      }),
    ).toThrow(
      expect.objectContaining({
        code: 'COMMENT_MEDIA_INVALID_FORMAT',
      }),
    );
  });

  it('rejects fileSizeBytes exceeding 100,000 bytes with COMMENT_MEDIA_TOO_LARGE', () => {
    expect(() =>
      validateRequestCommentImageUploadInput({
        contentType: 'image/webp',
        fileSizeBytes: 100_001,
      }),
    ).toThrow(
      expect.objectContaining({
        code: 'COMMENT_MEDIA_TOO_LARGE',
        message: 'File size exceeds 100,000 bytes',
      }),
    );
  });

  it('rejects non-positive or non-integer fileSizeBytes with ValidationError', () => {
    expect(() =>
      validateRequestCommentImageUploadInput({
        contentType: 'image/webp',
        fileSizeBytes: 0,
      }),
    ).toThrow(ValidationError);

    expect(() =>
      validateRequestCommentImageUploadInput({
        contentType: 'image/webp',
        fileSizeBytes: -100,
      }),
    ).toThrow(ValidationError);

    expect(() =>
      validateRequestCommentImageUploadInput({
        contentType: 'image/webp',
        fileSizeBytes: 50.5,
      }),
    ).toThrow(ValidationError);
  });

  it('rejects invalid or missing inputs with ValidationError', () => {
    expect(() => validateRequestCommentImageUploadInput(null)).toThrow(ValidationError);
    expect(() => validateRequestCommentImageUploadInput({})).toThrow(ValidationError);
    expect(() =>
      validateRequestCommentImageUploadInput({
        contentType: 123,
        fileSizeBytes: 500,
      }),
    ).toThrow(ValidationError);
  });
});
