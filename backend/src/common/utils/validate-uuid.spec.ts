import { assertUuid } from './validate-uuid';
import { ValidationError } from '../errors/app.errors';

describe('validate-uuid', () => {
  it('passes for valid UUIDv4 and UUIDv7', () => {
    expect(() => assertUuid('01916327-0000-7000-8000-000000000001', 'postId')).not.toThrow();
    expect(() => assertUuid('123e4567-e89b-12d3-a456-426614174000', 'userId')).not.toThrow();
  });

  it('throws ValidationError for invalid UUID strings', () => {
    expect(() => assertUuid('not-a-uuid', 'postId')).toThrow(ValidationError);
    expect(() => assertUuid('', 'postId')).toThrow(ValidationError);
    expect(() => assertUuid('123', 'userId')).toThrow(ValidationError);
  });
});
