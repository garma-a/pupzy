import { validateCreateMatingPostInput } from './validate-create-mating-post.input';
import { ValidationError } from '../common/errors/app.errors';

describe('validateCreateMatingPostInput', () => {
  const valid = {
    petName: 'Bella',
    species: 'CAT',
    breed: 'Persian',
    gender: 'FEMALE',
    ageValue: 3,
    ageUnit: 'YEARS',
    isPurebred: true,
    hasPedigreeCertificate: false,
    vaccinated: true,
    dewormed: true,
    termsSummary: 'Free mating',
    matingConditions: 'At our house',
    cityId: '01916327-0000-7000-8000-000000000001',
    mediaIds: ['01916327-0000-7000-8000-000000000002'],
  };

  it('validates a complete valid input', () => {
    const result = validateCreateMatingPostInput(valid);
    expect(result.petName).toBe('Bella');
    expect(result.gender).toBe('FEMALE');
    expect(result.termsSummary).toBe('Free mating');
  });

  it('rejects UNKNOWN gender', () => {
    expect(() => validateCreateMatingPostInput({ ...valid, gender: 'UNKNOWN' })).toThrow(ValidationError);
  });

  it('rejects missing or empty petName', () => {
    expect(() => validateCreateMatingPostInput({ ...valid, petName: '' })).toThrow(ValidationError);
    expect(() => validateCreateMatingPostInput({ ...valid, petName: '   ' })).toThrow(ValidationError);
  });

  it('rejects invalid ageValue', () => {
    expect(() => validateCreateMatingPostInput({ ...valid, ageValue: -1 })).toThrow(ValidationError);
    expect(() => validateCreateMatingPostInput({ ...valid, ageValue: 100 })).toThrow(ValidationError);
  });

  it('rejects non-boolean isPurebred', () => {
    expect(() => validateCreateMatingPostInput({ ...valid, isPurebred: 'yes' })).toThrow(ValidationError);
  });

  it('rejects empty mediaIds array', () => {
    expect(() => validateCreateMatingPostInput({ ...valid, mediaIds: [] })).toThrow(ValidationError);
  });

  it('rejects invalid UUID in mediaIds or cityId', () => {
    expect(() => validateCreateMatingPostInput({ ...valid, cityId: 'not-a-uuid' })).toThrow(ValidationError);
    expect(() => validateCreateMatingPostInput({ ...valid, mediaIds: ['not-a-uuid'] })).toThrow(ValidationError);
  });
});
