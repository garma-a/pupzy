import { validateDeleteMyAccountInput } from './delete-my-account.input';
import { ValidationError } from '../../common/errors/app.errors';

describe('validateDeleteMyAccountInput', () => {
  it('accepts confirm: true', () => {
    const res = validateDeleteMyAccountInput({ confirm: true });
    expect(res).toEqual({ confirm: true });
  });

  it('rejects confirm: false', () => {
    expect(() => validateDeleteMyAccountInput({ confirm: false })).toThrow(ValidationError);
  });

  it('rejects missing confirm', () => {
    expect(() => validateDeleteMyAccountInput({})).toThrow(ValidationError);
  });

  it('accepts confirm: true with optional progressToken', () => {
    const res = validateDeleteMyAccountInput({ confirm: true, progressToken: 'a-custom-progress-token-12345' });
    expect(res).toEqual({ confirm: true, progressToken: 'a-custom-progress-token-12345' });
  });

  it('rejects non-boolean confirm', () => {
    expect(() => validateDeleteMyAccountInput({ confirm: 'true' })).toThrow(ValidationError);
  });

  it('rejects too short progressToken', () => {
    expect(() => validateDeleteMyAccountInput({ confirm: true, progressToken: 'short' })).toThrow(ValidationError);
  });
});
