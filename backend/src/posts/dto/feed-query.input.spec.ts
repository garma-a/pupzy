import { validateMySavedPostsInput, validateMyPostsInput, validateHelpFeedInput } from './feed-query.input';
import { ValidationError } from '../../common/errors/app.errors';

describe('feed-query.input', () => {
  describe('validateMySavedPostsInput', () => {
    it('validates empty args (defaults applied downstream)', () => {
      const result = validateMySavedPostsInput({});
      expect(result.first).toBeUndefined();
      expect(result.after).toBeUndefined();
    });

    it('validates pagination parameters', () => {
      const result = validateMySavedPostsInput({
        first: 25,
        after: 'cursor123',
      });
      expect(result.first).toBe(25);
      expect(result.after).toBe('cursor123');
    });

    it('rejects first > 50', () => {
      expect(() => validateMySavedPostsInput({ first: 51 })).toThrow(ValidationError);
    });

    it('rejects first < 1', () => {
      expect(() => validateMySavedPostsInput({ first: 0 })).toThrow(ValidationError);
    });
  });

  describe('validateMyPostsInput', () => {
    it('validates valid postType', () => {
      const result = validateMyPostsInput({
        postType: 'RESCUE',
        first: 10,
      });
      expect(result.postType).toBe('RESCUE');
      expect(result.first).toBe(10);
    });

    it('rejects missing postType', () => {
      expect(() => validateMyPostsInput({})).toThrow(ValidationError);
    });

    it('rejects invalid postType', () => {
      expect(() => validateMyPostsInput({ postType: 'INVALID' })).toThrow(ValidationError);
    });
  });

  describe('validateHelpFeedInput', () => {
    it('requires at least one location filter', () => {
      expect(() => validateHelpFeedInput({})).toThrow(ValidationError);
    });

    it('accepts governorate filter', () => {
      const result = validateHelpFeedInput({ governorate: 'Cairo' });
      expect(result.governorate).toBe('Cairo');
    });
  });
});
