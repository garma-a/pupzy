import { validateRequestMediaUploadInput } from './request-media-upload.input';
import { ValidationError } from '../../common/errors/app.errors';

describe('validateRequestMediaUploadInput', () => {
  it('validates correct image MIME types and file sizes', () => {
    expect(validateRequestMediaUploadInput({ contentType: 'image/webp', fileSizeBytes: 1024 })).toEqual({
      contentType: 'image/webp',
      fileSizeBytes: 1024,
    });

    expect(validateRequestMediaUploadInput({ contentType: 'image/jpeg', fileSizeBytes: 5_242_880 })).toEqual({
      contentType: 'image/jpeg',
      fileSizeBytes: 5_242_880,
    });
  });

  it('throws ValidationError for unapproved MIME types', () => {
    expect(() => validateRequestMediaUploadInput({ contentType: 'application/pdf', fileSizeBytes: 1024 })).toThrow(
      ValidationError,
    );
    expect(() => validateRequestMediaUploadInput({ contentType: 'video/mp4', fileSizeBytes: 1024 })).toThrow(
      ValidationError,
    );
  });

  it('throws ValidationError for file sizes exceeding 5MB or below 1 byte', () => {
    expect(() => validateRequestMediaUploadInput({ contentType: 'image/png', fileSizeBytes: 0 })).toThrow(
      ValidationError,
    );
    expect(() => validateRequestMediaUploadInput({ contentType: 'image/png', fileSizeBytes: 6_000_000 })).toThrow(
      ValidationError,
    );
  });
});
