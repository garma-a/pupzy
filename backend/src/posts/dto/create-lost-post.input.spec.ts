import { validateCreateLostPostInput } from './create-lost-post.input';
import { ValidationError } from '../../common/errors/app.errors';

describe('validateCreateLostPostInput', () => {
  const validLostPetPayload = {
    title: 'Lost Golden Retriever',
    description: 'Wearing a red collar, ran away during fireworks.',
    coordinates: {
      latitude: 30.0444,
      longitude: 31.2357,
    },
    reportType: 'LOST_PET',
    species: 'DOG',
    petName: 'Max',
    dateLastSeen: '2026-08-01',
    hasMedicalNeeds: false,
    isElderlyOrVeryYoung: true,
    lastSeenNearHazard: true,
  };

  const validFoundStrayPayload = {
    title: 'Found stray kitten',
    description: 'Found shivering in a box near the market.',
    coordinates: {
      latitude: 30.0444,
      longitude: 31.2357,
    },
    reportType: 'FOUND_STRAY',
    species: 'CAT',
    currentCondition: 'HEALTHY',
    isCurrentlySafeWithReporter: true,
    dateFound: '2026-08-02',
  };

  it('validates a valid LOST_PET payload', () => {
    const result = validateCreateLostPostInput(validLostPetPayload);
    expect(result.reportType).toBe('LOST_PET');
    expect(result.petName).toBe('Max');
    expect(result.hasMedicalNeeds).toBe(false);
    expect(result.isElderlyOrVeryYoung).toBe(true);
    expect(result.lastSeenNearHazard).toBe(true);
  });

  it('validates a valid FOUND_STRAY payload', () => {
    const result = validateCreateLostPostInput(validFoundStrayPayload);
    expect(result.reportType).toBe('FOUND_STRAY');
    expect(result.currentCondition).toBe('HEALTHY');
    expect(result.isCurrentlySafeWithReporter).toBe(true);
  });

  it('throws ValidationError for LOST_PET if dateLastSeen is missing', () => {
    const invalid = { ...validLostPetPayload };
    delete (invalid as Record<string, unknown>).dateLastSeen;
    expect(() => validateCreateLostPostInput(invalid)).toThrow(ValidationError);
  });

  it('throws ValidationError for LOST_PET if urgency signals are missing', () => {
    const invalid = { ...validLostPetPayload };
    delete (invalid as Record<string, unknown>).hasMedicalNeeds;
    expect(() => validateCreateLostPostInput(invalid)).toThrow(ValidationError);
  });

  it('throws ValidationError for LOST_PET if FOUND_STRAY fields are provided', () => {
    expect(() =>
      validateCreateLostPostInput({
        ...validLostPetPayload,
        currentCondition: 'INJURED',
      }),
    ).toThrow(ValidationError);
  });

  it('throws ValidationError for FOUND_STRAY if LOST_PET fields are provided', () => {
    expect(() =>
      validateCreateLostPostInput({
        ...validFoundStrayPayload,
        petName: 'Some Name',
      }),
    ).toThrow(ValidationError);
  });

  it('throws ValidationError for FOUND_STRAY if urgency signals from LOST_PET are provided', () => {
    expect(() =>
      validateCreateLostPostInput({
        ...validFoundStrayPayload,
        hasMedicalNeeds: true,
      }),
    ).toThrow(ValidationError);
  });
});
