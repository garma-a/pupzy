import { validateAcceptTermsInput } from './accept-terms.input';
import { ValidationError } from '../../common/errors/app.errors';

describe('validateAcceptTermsInput', () => {
  it('accepts a non-empty version and trims surrounding whitespace', () => {
    expect(validateAcceptTermsInput({ version: ' 2026-09-01 ' })).toEqual({ version: '2026-09-01' });
  });

  it('rejects missing, empty and oversized versions', () => {
    expect(() => validateAcceptTermsInput(undefined)).toThrow(ValidationError);
    expect(() => validateAcceptTermsInput({})).toThrow(ValidationError);
    expect(() => validateAcceptTermsInput({ version: '' })).toThrow(ValidationError);
    expect(() => validateAcceptTermsInput({ version: '   ' })).toThrow(ValidationError);
    expect(() => validateAcceptTermsInput({ version: 'v'.repeat(65) })).toThrow(ValidationError);
  });

  it('rejects non-string versions', () => {
    expect(() => validateAcceptTermsInput({ version: 42 })).toThrow(ValidationError);
  });
});
