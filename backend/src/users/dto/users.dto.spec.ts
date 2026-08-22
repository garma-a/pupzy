import { validateCompleteProfileInput } from './complete-profile.input';
import { validateUpdateProfileInput } from './update-profile.input';
import { validateGeoLocationInput } from './geo-location.input';
import { ValidationError } from '../../common/errors/app.errors';

describe('User DTO Validations', () => {
  describe('validateCompleteProfileInput', () => {
    it('validates with cityId', () => {
      const result = validateCompleteProfileInput({
        fullName: 'Ahmed Ali',
        phoneNumber: '+201012345678',
        cityId: '01916327-0000-7000-8000-000000000001',
      });
      expect(result.fullName).toBe('Ahmed Ali');
      expect(result.phoneNumber).toBe('+201012345678');
    });

    it('validates with GPS location', () => {
      const result = validateCompleteProfileInput({
        fullName: 'Sara Mohamed',
        phoneNumber: '+201098765432',
        location: { latitude: 30.0444, longitude: 31.2357 },
      });
      expect(result.fullName).toBe('Sara Mohamed');
      expect(result.location?.latitude).toBe(30.0444);
    });

    it('throws ValidationError if both cityId and location are omitted', () => {
      expect(() =>
        validateCompleteProfileInput({
          fullName: 'Ahmed Ali',
          phoneNumber: '+201012345678',
        }),
      ).toThrow(ValidationError);
    });

    it('throws ValidationError for invalid phone number', () => {
      expect(() =>
        validateCompleteProfileInput({
          fullName: 'Ahmed Ali',
          phoneNumber: '01012345678', // Missing +
          cityId: '01916327-0000-7000-8000-000000000001',
        }),
      ).toThrow(ValidationError);
    });
  });

  describe('validateUpdateProfileInput', () => {
    it('validates valid update profile input', () => {
      const result = validateUpdateProfileInput({
        fullName: 'Ahmed New Name',
        phoneNumber: '+201122334455',
      });
      expect(result.fullName).toBe('Ahmed New Name');
    });

    it('throws ValidationError for short name', () => {
      expect(() => validateUpdateProfileInput({ fullName: 'A' })).toThrow(ValidationError);
    });
  });

  describe('validateGeoLocationInput', () => {
    it('validates valid coordinates', () => {
      const result = validateGeoLocationInput({ latitude: 30.0444, longitude: 31.2357 });
      expect(result.latitude).toBe(30.0444);
      expect(result.longitude).toBe(31.2357);
    });

    it('throws ValidationError for out of range coordinates', () => {
      expect(() => validateGeoLocationInput({ latitude: 95, longitude: 31.2357 })).toThrow(ValidationError);
      expect(() => validateGeoLocationInput({ latitude: 30, longitude: 200 })).toThrow(ValidationError);
    });
  });
});
