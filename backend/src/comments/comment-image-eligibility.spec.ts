import { AppError } from '../common/errors/app.errors';
import {
  COMMENT_MEDIA_NOT_ALLOWED,
  IMAGE_COMMENT_ALLOWED_POST_TYPES,
  assertImageCommentAllowed,
  canPublishImageComment,
} from './comment-image-eligibility';

describe('Comment image Post type eligibility', () => {
  it('allows image Comments only on RESCUE and LOST and rejects every other Post type', () => {
    expect(IMAGE_COMMENT_ALLOWED_POST_TYPES).toEqual(['RESCUE', 'LOST']);
    expect(canPublishImageComment('RESCUE')).toBe(true);
    expect(canPublishImageComment('LOST')).toBe(true);
    expect(canPublishImageComment('ADOPTION')).toBe(false);
    expect(canPublishImageComment('PRODUCT')).toBe(false);
    expect(canPublishImageComment('MATING')).toBe(false);
  });

  it('treats missing or unknown Post types as disallowed', () => {
    expect(canPublishImageComment(null)).toBe(false);
    expect(canPublishImageComment(undefined)).toBe(false);
    expect(canPublishImageComment('')).toBe(false);
    expect(canPublishImageComment('UNKNOWN')).toBe(false);
  });

  it('throws the stable COMMENT_MEDIA_NOT_ALLOWED error for disallowed Post types', () => {
    expect(() => assertImageCommentAllowed('RESCUE')).not.toThrow();
    expect(() => assertImageCommentAllowed('LOST')).not.toThrow();

    for (const postType of ['ADOPTION', 'PRODUCT', 'MATING', 'UNKNOWN']) {
      try {
        assertImageCommentAllowed(postType);
        fail(`Expected image Comments to be rejected on ${postType}`);
      } catch (err) {
        expect(err).toBeInstanceOf(AppError);
        expect((err as AppError).code).toBe(COMMENT_MEDIA_NOT_ALLOWED);
      }
    }
  });
});
