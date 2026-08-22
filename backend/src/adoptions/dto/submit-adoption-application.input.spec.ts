import { validateSubmitAdoptionApplicationInput } from './submit-adoption-application.input';
import { ValidationError } from '../../common/errors/app.errors';

describe('validateSubmitAdoptionApplicationInput', () => {
  const validPostId = '01916327-0000-7000-8000-000000000001';

  it('validates complete adoption application input', () => {
    const validRaw = {
      targetPostId: validPostId,
      livingSituation: 'APARTMENT',
      hasOutdoorAccess: false,
      hasOtherPetsAtHome: false,
      hasChildrenAtHome: false,
      whyAdopt: 'I have a loving home ready with plenty of time and care for this pet.',
      consentHomeVisit: true,
      canProvideVetReference: true,
    };

    const result = validateSubmitAdoptionApplicationInput(validRaw);
    expect(result.targetPostId).toBe(validPostId);
    expect(result.livingSituation).toBe('APARTMENT');
  });

  it('throws ValidationError for whyAdopt with less than 20 characters', () => {
    const invalidRaw = {
      targetPostId: validPostId,
      livingSituation: 'APARTMENT',
      hasOutdoorAccess: false,
      hasOtherPetsAtHome: false,
      hasChildrenAtHome: false,
      whyAdopt: 'Too short',
      consentHomeVisit: true,
      canProvideVetReference: true,
    };

    expect(() => validateSubmitAdoptionApplicationInput(invalidRaw)).toThrow(ValidationError);
  });
});
