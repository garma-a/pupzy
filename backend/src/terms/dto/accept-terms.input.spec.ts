import { validateAcceptTermsInput } from './accept-terms.input';
import { ValidationError } from '../../common/errors/app.errors';

describe('validateAcceptTermsInput', () => {
  it('accepts a non-empty version and trims surrounding whitespace', () => {
    expect(validateAcceptTermsInput({ version: ' 2026-09-01 ', ageConfirmed: true })).toEqual({
      version: '2026-09-01',
      ageConfirmed: true,
    });
  });

  it('requires the person to confirm they are 18 or older', () => {
    expect(() => validateAcceptTermsInput({ version: '2026-09-01' })).toThrow(ValidationError);
    expect(() => validateAcceptTermsInput({ version: '2026-09-01', ageConfirmed: false })).toThrow(
      'You must confirm you are 18 or older',
    );
  });

  it('rejects missing, empty and oversized versions', () => {
    expect(() => validateAcceptTermsInput(undefined)).toThrow(ValidationError);
    expect(() => validateAcceptTermsInput({ ageConfirmed: true })).toThrow(ValidationError);
    expect(() => validateAcceptTermsInput({ version: '', ageConfirmed: true })).toThrow(ValidationError);
    expect(() => validateAcceptTermsInput({ version: '   ', ageConfirmed: true })).toThrow(ValidationError);
    expect(() => validateAcceptTermsInput({ version: 'v'.repeat(65), ageConfirmed: true })).toThrow(ValidationError);
  });

  it('rejects non-string versions', () => {
    expect(() => validateAcceptTermsInput({ version: 42, ageConfirmed: true })).toThrow(ValidationError);
  });
});
