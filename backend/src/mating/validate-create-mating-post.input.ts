import { ValidationError } from '../common/errors/app.errors';
import { assertUuid } from '../common/utils/validate-uuid';

export interface ValidatedMatingPostInput {
  petName: string;
  species: 'DOG' | 'CAT' | 'BIRD' | 'RABBIT' | 'OTHER';
  breed: string;
  gender: 'MALE' | 'FEMALE';
  ageValue: number;
  ageUnit: 'DAYS' | 'WEEKS' | 'MONTHS' | 'YEARS';
  isPurebred: boolean;
  hasPedigreeCertificate: boolean;
  vaccinated: boolean;
  dewormed: boolean;
  termsSummary: string | null;
  matingConditions: string | null;
  cityId: string;
  mediaIds: string[];
}

export function validateCreateMatingPostInput(raw: Record<string, unknown>): ValidatedMatingPostInput {
  const str = (v: unknown, name: string, max: number): string => {
    if (typeof v !== 'string') throw new ValidationError(`${name} is required`);
    const s = v.trim();
    if (s.length === 0) throw new ValidationError(`${name} must not be empty`);
    if (s.length > max) throw new ValidationError(`${name} must be at most ${max} characters`);
    return s;
  };

  const petName = str(raw.petName, 'petName', 100);
  const breed = str(raw.breed, 'breed', 100);

  // species/ageUnit are already GraphQL-enum-validated by the time this runs;
  // typeof guards here are defense-in-depth for direct unit-test calls only.
  const species = String(raw.species) as 'DOG' | 'CAT' | 'BIRD' | 'RABBIT' | 'OTHER';
  const ageUnit = String(raw.ageUnit) as 'DAYS' | 'WEEKS' | 'MONTHS' | 'YEARS';

  // gender: GraphQL's GenderType allows MALE | FEMALE | UNKNOWN (shared with ADOPTION).
  // MATING rejects UNKNOWN specifically — see plan §0.3 decision 3.
  const gender = String(raw.gender);
  if (gender !== 'MALE' && gender !== 'FEMALE') {
    throw new ValidationError('gender must be MALE or FEMALE for a mating post (UNKNOWN is not allowed)');
  }

  const ageValue = Number(raw.ageValue);
  if (!Number.isInteger(ageValue) || ageValue < 0 || ageValue > 50) {
    throw new ValidationError('ageValue must be an integer between 0 and 50');
  }
  if (typeof raw.isPurebred !== 'boolean') throw new ValidationError('isPurebred must be a boolean');

  if (!Array.isArray(raw.mediaIds) || raw.mediaIds.length === 0) {
    throw new ValidationError('At least one photo of the pet is required');
  }
  for (const id of raw.mediaIds) assertUuid(String(id), 'mediaIds');
  // Upper bound (max 4) is enforced by MatingService.prepareMedia, matching every
  // other post type — not duplicated here, see plan §2.1.

  const optionalText = (v: unknown): string | null =>
    typeof v === 'string' && v.trim() ? v.trim().slice(0, 500) : null;

  const cityId = str(raw.cityId, 'cityId', 64);
  assertUuid(cityId, 'cityId');

  return {
    petName,
    breed,
    species,
    gender,
    ageValue,
    ageUnit,
    isPurebred: raw.isPurebred,
    hasPedigreeCertificate: raw.hasPedigreeCertificate === true,
    vaccinated: raw.vaccinated !== false, // default true
    dewormed: raw.dewormed !== false, // default true
    termsSummary: optionalText(raw.termsSummary),
    matingConditions: optionalText(raw.matingConditions),
    cityId,
    mediaIds: raw.mediaIds as string[],
  };
}
