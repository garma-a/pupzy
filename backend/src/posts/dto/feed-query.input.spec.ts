import {
  validateMySavedPostsInput,
  validateMyPostsInput,
  validateHelpFeedInput,
  validateAdoptFeedInput,
  validateMarketFeedInput,
} from './feed-query.input';
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

    it('validates MATING for owner history', () => {
      const result = validateMyPostsInput({ postType: 'MATING' });
      expect(result.postType).toBe('MATING');
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

  describe('validateAdoptFeedInput', () => {
    it('accepts the optional search alongside sort and location', () => {
      const result = validateAdoptFeedInput({
        cityId: '01916327-0000-7000-8000-000000000001',
        sort: 'HOT',
        search: 'dog',
      });
      expect(result.sort).toBe('HOT');
      expect(result.search).toBe('dog');
    });

    it('leaves search undefined when omitted', () => {
      const result = validateAdoptFeedInput({ governorate: 'Cairo' });
      expect(result.search).toBeUndefined();
    });

    it('still rejects an unknown sort', () => {
      expect(() => validateAdoptFeedInput({ governorate: 'Cairo', sort: 'CHEAPEST' })).toThrow(ValidationError);
    });
  });

  describe('validateMarketFeedInput', () => {
    it('accepts the optional search alongside category, sort and location', () => {
      const result = validateMarketFeedInput({
        cityId: '01916327-0000-7000-8000-000000000001',
        category: 'FOOD',
        sort: 'NEWEST',
        search: 'bowl',
      });
      expect(result.category).toBe('FOOD');
      expect(result.sort).toBe('NEWEST');
      expect(result.search).toBe('bowl');
    });

    it('still rejects an unknown category', () => {
      expect(() => validateMarketFeedInput({ governorate: 'Cairo', category: 'TOYS' })).toThrow(ValidationError);
    });
  });
});
