import { validateCreateRescuePostInput } from './create-rescue-post.input';
import { ValidationError } from '../../common/errors/app.errors';

describe('validateCreateRescuePostInput', () => {
  const validPayload = {
    title: 'Injured puppy needs rescue',
    description: 'Found near the train station with a hurt paw.',
    coordinates: {
      latitude: 30.0444,
      longitude: 31.2357,
    },
    species: 'DOG',
    conditionSummary: 'Limping and unable to walk properly',
    reporterRole: 'ON_SITE',
    isLifeThreatening: false,
    hasVisibleSeriousInjury: true,
    isInDangerousLocation: true,
    canAnimalMoveOrEscape: false,
  };

  it('validates a valid rescue post payload', () => {
    const result = validateCreateRescuePostInput(validPayload);
    expect(result.title).toBe(validPayload.title);
    expect(result.isLifeThreatening).toBe(false);
    expect(result.hasVisibleSeriousInjury).toBe(true);
    expect(result.isInDangerousLocation).toBe(true);
    expect(result.canAnimalMoveOrEscape).toBe(false);
  });

  it('throws ValidationError if title is too short', () => {
    expect(() =>
      validateCreateRescuePostInput({
        ...validPayload,
        title: 'ab',
      }),
    ).toThrow(ValidationError);
  });

  it('throws ValidationError if an urgency signal is missing', () => {
    const incomplete = { ...validPayload };
    delete (incomplete as Record<string, unknown>).isLifeThreatening;
    expect(() => validateCreateRescuePostInput(incomplete)).toThrow(ValidationError);
  });

  it('throws ValidationError if coordinates are invalid', () => {
    expect(() =>
      validateCreateRescuePostInput({
        ...validPayload,
        coordinates: {
          latitude: 100, // Invalid latitude > 90
          longitude: 31.2357,
        },
      }),
    ).toThrow(ValidationError);
  });
});
