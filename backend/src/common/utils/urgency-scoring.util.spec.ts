import { computeRescueUrgency, computeLostPetUrgency, computeFoundStrayUrgency } from './urgency-scoring.util';

describe('urgency-scoring.util', () => {
  describe('computeRescueUrgency', () => {
    it('returns CRITICAL if situation is life-threatening', () => {
      const result = computeRescueUrgency({
        isLifeThreatening: true,
        hasVisibleSeriousInjury: false,
        isInDangerousLocation: false,
        canAnimalMoveOrEscape: true,
        reporterRole: 'ON_SITE',
      });
      expect(result).toBe('CRITICAL');
    });

    it('returns CRITICAL if injury (3) + cannot move (3) = 6 >= 5', () => {
      const result = computeRescueUrgency({
        isLifeThreatening: false,
        hasVisibleSeriousInjury: true,
        isInDangerousLocation: false,
        canAnimalMoveOrEscape: false,
        reporterRole: 'ON_SITE',
      });
      expect(result).toBe('CRITICAL');
    });

    it('returns URGENT if only serious injury (3) is present', () => {
      const result = computeRescueUrgency({
        isLifeThreatening: false,
        hasVisibleSeriousInjury: true,
        isInDangerousLocation: false,
        canAnimalMoveOrEscape: true,
        reporterRole: 'ON_SITE',
      });
      expect(result).toBe('URGENT');
    });

    it('returns URGENT if only dangerous location (2) is present', () => {
      const result = computeRescueUrgency({
        isLifeThreatening: false,
        hasVisibleSeriousInjury: false,
        isInDangerousLocation: true,
        canAnimalMoveOrEscape: true,
        reporterRole: 'ON_SITE',
      });
      expect(result).toBe('URGENT');
    });

    it('returns MODERATE if all signals are false and reporter is on site', () => {
      const result = computeRescueUrgency({
        isLifeThreatening: false,
        hasVisibleSeriousInjury: false,
        isInDangerousLocation: false,
        canAnimalMoveOrEscape: true,
        reporterRole: 'ON_SITE',
      });
      expect(result).toBe('MODERATE');
    });

    it('returns MODERATE if only reporter not on site (1 < 2)', () => {
      const result = computeRescueUrgency({
        isLifeThreatening: false,
        hasVisibleSeriousInjury: false,
        isInDangerousLocation: false,
        canAnimalMoveOrEscape: true,
        reporterRole: 'REPORTING',
      });
      expect(result).toBe('MODERATE');
    });
  });

  describe('computeLostPetUrgency', () => {
    it('returns CRITICAL if medical needs (3) + near hazard (3) = 6 >= 5', () => {
      const result = computeLostPetUrgency({
        hasMedicalNeeds: true,
        isElderlyOrVeryYoung: false,
        lastSeenNearHazard: true,
      });
      expect(result).toBe('CRITICAL');
    });

    it('returns CRITICAL if all 3 signals are true (3 + 2 + 3 = 8 >= 5)', () => {
      const result = computeLostPetUrgency({
        hasMedicalNeeds: true,
        isElderlyOrVeryYoung: true,
        lastSeenNearHazard: true,
      });
      expect(result).toBe('CRITICAL');
    });

    it('returns URGENT if only medical needs (3) is true', () => {
      const result = computeLostPetUrgency({
        hasMedicalNeeds: true,
        isElderlyOrVeryYoung: false,
        lastSeenNearHazard: false,
      });
      expect(result).toBe('URGENT');
    });

    it('returns URGENT if only elderly or very young (2) is true', () => {
      const result = computeLostPetUrgency({
        hasMedicalNeeds: false,
        isElderlyOrVeryYoung: true,
        lastSeenNearHazard: false,
      });
      expect(result).toBe('URGENT');
    });

    it('returns MODERATE if no urgency signals are true', () => {
      const result = computeLostPetUrgency({
        hasMedicalNeeds: false,
        isElderlyOrVeryYoung: false,
        lastSeenNearHazard: false,
      });
      expect(result).toBe('MODERATE');
    });
  });

  describe('computeFoundStrayUrgency', () => {
    it('returns CRITICAL if animal is injured (4) and not safe (3) = 7 >= 5', () => {
      const result = computeFoundStrayUrgency({
        currentCondition: 'INJURED',
        isCurrentlySafeWithReporter: false,
      });
      expect(result).toBe('CRITICAL');
    });

    it('returns CRITICAL if condition unknown (2) and not safe (3) = 5 >= 5', () => {
      const result = computeFoundStrayUrgency({
        currentCondition: 'UNKNOWN',
        isCurrentlySafeWithReporter: false,
      });
      expect(result).toBe('CRITICAL');
    });

    it('returns URGENT if animal is injured (4) but safe with reporter', () => {
      const result = computeFoundStrayUrgency({
        currentCondition: 'INJURED',
        isCurrentlySafeWithReporter: true,
      });
      expect(result).toBe('URGENT');
    });

    it('returns URGENT if animal is healthy but not safe with reporter (3)', () => {
      const result = computeFoundStrayUrgency({
        currentCondition: 'HEALTHY',
        isCurrentlySafeWithReporter: false,
      });
      expect(result).toBe('URGENT');
    });

    it('returns MODERATE if animal is healthy and safe with reporter', () => {
      const result = computeFoundStrayUrgency({
        currentCondition: 'HEALTHY',
        isCurrentlySafeWithReporter: true,
      });
      expect(result).toBe('MODERATE');
    });
  });
});
