import { validateRequestContactInput } from './request-contact.input';
import { ValidationError } from '../../common/errors/app.errors';

describe('validateRequestContactInput', () => {
  const validPostId = '01916327-0000-7000-8000-000000000001';

  it('validates correct request contact input', () => {
    const result = validateRequestContactInput({
      postId: validPostId,
      message: 'Hello, I can foster this animal!',
    });
    expect(result.postId).toBe(validPostId);
    expect(result.message).toBe('Hello, I can foster this animal!');
  });

  it('throws ValidationError for invalid UUID', () => {
    expect(() => validateRequestContactInput({ postId: 'not-a-uuid', message: 'Hello there!' })).toThrow(
      ValidationError,
    );
  });

  it('throws ValidationError for message less than 10 characters', () => {
    expect(() => validateRequestContactInput({ postId: validPostId, message: 'Hi' })).toThrow(ValidationError);
  });
});
