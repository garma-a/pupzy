import { validateUpdatePostStatusInput } from './update-post-status.input';
import { ValidationError } from '../../common/errors/app.errors';

describe('validateUpdatePostStatusInput', () => {
  const validPostId = '01916327-0000-7000-8000-000000000001';

  it('validates correct update status inputs', () => {
    expect(validateUpdatePostStatusInput({ postId: validPostId, status: 'RESOLVED' })).toEqual({
      postId: validPostId,
      status: 'RESOLVED',
    });

    expect(validateUpdatePostStatusInput({ postId: validPostId, status: 'REUNITED' })).toEqual({
      postId: validPostId,
      status: 'REUNITED',
    });

    expect(validateUpdatePostStatusInput({ postId: validPostId, status: 'ADOPTED' })).toEqual({
      postId: validPostId,
      status: 'ADOPTED',
    });

    expect(validateUpdatePostStatusInput({ postId: validPostId, status: 'SOLD' })).toEqual({
      postId: validPostId,
      status: 'SOLD',
    });
  });

  it('throws ValidationError for invalid UUID postId', () => {
    expect(() => validateUpdatePostStatusInput({ postId: 'invalid-id', status: 'RESOLVED' })).toThrow(ValidationError);
  });

  it('throws ValidationError for unknown status value', () => {
    expect(() => validateUpdatePostStatusInput({ postId: validPostId, status: 'UNKNOWN' })).toThrow(ValidationError);
  });
});
