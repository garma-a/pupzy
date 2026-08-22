import { validateCreateAdoptionPostInput } from './create-adoption-post.input';
import { ValidationError } from '../../common/errors/app.errors';

describe('validateCreateAdoptionPostInput', () => {
  const validCoordinates = { latitude: 30.0444, longitude: 31.2357 };

  it('validates a correct adoption post input with age and personality tags', () => {
    const validRaw = {
      title: 'Loving Labrador Puppy',
      description: 'Healthy and vaccinated Labrador looking for a good home.',
      coordinates: validCoordinates,
      petName: 'Bella',
      species: 'DOG',
      breed: 'Labrador',
      ageValue: 6,
      ageUnit: 'MONTHS',
      gender: 'FEMALE',
      vaccinated: true,
      neutered: false,
      personalityTags: ['GOOD_WITH_KIDS', 'PLAYFUL'],
      priorPetExperienceRequired: false,
    };

    const parsed = validateCreateAdoptionPostInput(validRaw);
    expect(parsed.title).toBe('Loving Labrador Puppy');
    expect(parsed.petName).toBe('Bella');
    expect(parsed.ageValue).toBe(6);
    expect(parsed.ageUnit).toBe('MONTHS');
  });

  it('validates adoption input when age is completely omitted', () => {
    const validRaw = {
      title: 'Adult Cat for Adoption',
      description: 'Calm adult cat looking for a quiet home.',
      coordinates: validCoordinates,
      petName: 'Whiskers',
      species: 'CAT',
      gender: 'MALE',
      vaccinated: true,
      neutered: true,
      priorPetExperienceRequired: false,
    };

    const parsed = validateCreateAdoptionPostInput(validRaw);
    expect(parsed.ageValue).toBeUndefined();
    expect(parsed.ageUnit).toBeUndefined();
  });

  it('throws ValidationError when ageValue is provided without ageUnit', () => {
    const invalidRaw = {
      title: 'Puppy for Adoption',
      description: 'Healthy puppy looking for a home.',
      coordinates: validCoordinates,
      petName: 'Max',
      species: 'DOG',
      ageValue: 2,
      gender: 'MALE',
      vaccinated: true,
      neutered: false,
      priorPetExperienceRequired: false,
    };

    expect(() => validateCreateAdoptionPostInput(invalidRaw)).toThrow(ValidationError);
  });

  it('throws ValidationError when ageUnit is provided without ageValue', () => {
    const invalidRaw = {
      title: 'Puppy for Adoption',
      description: 'Healthy puppy looking for a home.',
      coordinates: validCoordinates,
      petName: 'Max',
      species: 'DOG',
      ageUnit: 'YEARS',
      gender: 'MALE',
      vaccinated: true,
      neutered: false,
      priorPetExperienceRequired: false,
    };

    expect(() => validateCreateAdoptionPostInput(invalidRaw)).toThrow(ValidationError);
  });

  it('throws ValidationError when required fields are missing', () => {
    expect(() => validateCreateAdoptionPostInput({})).toThrow(ValidationError);
  });
});
