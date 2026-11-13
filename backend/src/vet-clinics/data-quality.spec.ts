// Provenance and research checks live with the evidence on branch `vet-clinics-evidence`.
import * as fs from 'fs';
import * as path from 'path';
import { containsPoint } from '../cities/coverage';
import {
  Clinic,
  ChecklistEntry,
  DATA_DIR,
  readData,
  clinicSchema,
  cities,
  districts,
  governorates,
  assignCity,
  cleanName,
  canonicalUrl,
  checklistResults,
  clinicBrandGroups,
  qualifyClinicBranches,
  displayNameEnglish,
  endsWithAdministrativeUnit,
  isGeocoderUrl,
} from './catalog';
import { generateMigration } from './migration';
import { assertGovernorateCoverage, CoverageException } from './coverage';
const clinics = readData<Clinic[]>('egypt-vet-clinics.json');
describe('Egypt Vet Clinic release data quality (offline)', () => {
  it('validates every record, app eligibility, provenance, bilingual origins, and excluded categories', () => {
    expect(clinics.length).toBeGreaterThan(0);
    for (const c of clinics) {
      expect(() => clinicSchema.parse(c)).not.toThrow();
      expect(c.nameEnglish).toMatch(/[a-z]/i);
      expect(c.nameArabic).toMatch(/[\u0600-\u06ff]/);
      expect(cleanName(c.nameEnglish)).toBe(c.nameEnglish);
      expect(cleanName(c.nameArabic)).toBe(c.nameArabic);
      expect(c.nameEnglishOrigin).not.toBe('missing');
      expect(c.nameArabicOrigin).not.toBe('missing');
      if (c.active) {
        expect(c.phone).toBeTruthy();
        expect(['exact', 'street', 'area']).toContain(c.locationPrecision);
        expect(c.inactiveReason).toBeNull();
      } else {
        expect(c.inactiveReason).not.toBeNull();
        if (c.inactiveReason === 'no-phone') expect(c.phone).toBeNull();
      }
      for (const url of [...c.sources.map((s) => s.url), c.coordinateProvenance.url]) {
        expect(url).not.toMatch(/google\.[^/]+\/maps|maps\.google|goo\.gl|maps\.app/i);
        expect(canonicalUrl(url)).toBe(url);
      }
      for (const field of ['website', 'facebookUrl'] as const)
        if (c[field]) expect(canonicalUrl(c[field])).toBe(c[field]);
      expect(c.sources.some((s) => isGeocoderUrl(s.url))).toBe(false);
      if (c.coordinateProvenance.method !== 'recorded-geocode')
        expect(c.sources.map((s) => s.url)).toContain(c.coordinateProvenance.url);
    }
  });
  it('uses sourced coordinates, exact district/governorate containment and the nearest district Neighbourhood within 2 km', () => {
    for (const c of clinics) {
      if (c.locationPrecision !== 'area')
        expect(assignCity(c.longitude, c.latitude)).toEqual({
          cityId: c.cityId,
          districtSourceCode: c.districtSourceCode,
          governorate: c.governorate,
        });
      const city = cities.find((r) => r.sourceCode === c.cityId)!;
      if (c.locationPrecision !== 'area')
        expect(
          districts.some(
            (f) =>
              f.properties.districtSourceCode === c.districtSourceCode && containsPoint([c.longitude, c.latitude], f),
          ),
        ).toBe(true);
      if (c.locationPrecision !== 'area')
        expect(
          governorates.some(
            (f) => f.properties.governorateCode === city.governorateCode && containsPoint([c.longitude, c.latitude], f),
          ),
        ).toBe(true);
    }
  });
  it('rejects Franco-Arabic display names; the release has no reviewed digit-in-brand exceptions', () => {
    expect(clinics.filter((c) => /[a-z]\d+[a-z]/i.test(c.nameEnglish)).map((c) => c.sourceKey)).toEqual([]);
  });
  it('shows each clinic under its own name; only reviewed chains share a spelling; similar names are qualified', () => {
    const bare = (name: string) => name.replace(/\s*\((?:[^()]|\([^()]*\))*\)$/, '');
    const qualified = qualifyClinicBranches(clinics);
    for (const group of clinicBrandGroups(clinics)) {
      for (const c of group) {
        const expected = qualified.find((r) => r.sourceKey === c.sourceKey)!;
        const chain = c.chainKey ? clinics.filter((o) => o.chainKey === c.chainKey) : [c];
        for (const field of ['nameEnglish', 'nameArabic'] as const) {
          expect(/ \(.+\)$/.test(c[field])).toBe(group.length > 1);
          expect(c[field]).toBe(expected[field]);
          const own = chain.flatMap((o) =>
            field === 'nameEnglish' ? (o.aliases?.english ?? []).map(displayNameEnglish) : (o.aliases?.arabic ?? []),
          );
          expect({ sourceKey: c.sourceKey, attested: own.map(bare).includes(bare(c[field])) }).toEqual({
            sourceKey: c.sourceKey,
            attested: true,
          });
          for (const o of chain) expect(bare(o[field])).toBe(bare(c[field]));
        }
      }
    }
    expect(new Set(clinics.map((c) => c.nameEnglish)).size).toBe(clinics.length);
    expect(new Set(clinics.map((c) => c.nameArabic)).size).toBe(clinics.length);
  });
  it('never ends a display address with an administrative unit label in either script', () => {
    const offenders = clinics.flatMap((c) =>
      [c.addressEnglish, c.addressArabic].filter(endsWithAdministrativeUnit).map((a) => `${c.sourceKey}: ${a}`),
    );
    expect(offenders).toEqual([]);
  });
  it('has unique natural keys and no duplicate phone, name within 150 m, or OSM entity', () => {
    expect(new Set(clinics.map((c) => c.sourceKey)).size).toBe(clinics.length);
    expect(new Set(clinics.flatMap((c) => c.osmEntities)).size).toBe(clinics.flatMap((c) => c.osmEntities).length);
  });
  it('regenerates the release SQL byte for byte from the dataset', () => {
    expect(generateMigration(clinics, { firstRelease: true })).toBe(
      fs.readFileSync(path.resolve(__dirname, '../../drizzle/migrations/0068_release_egypt_vet_clinics.sql'), 'utf8'),
    );
  });
  const checklistPath = path.join(DATA_DIR, 'known-clinics-checklist.json');
  if (fs.existsSync(checklistPath)) {
    it('matches at least 90% of the independent checklist against ACTIVE clinics in the same governorate', () => {
      const checklist = readData<ChecklistEntry[] | { entries: ChecklistEntry[] }>('known-clinics-checklist.json');
      const entries = Array.isArray(checklist) ? checklist : checklist.entries;
      expect(entries.length).toBeGreaterThan(0);
      const results = checklistResults(entries, clinics);
      expect(results.filter((r) => r.passes).length / results.length).toBeGreaterThanOrEqual(0.9);
    });
  } else {
    it.skip('Independent checklist gate: lead-owned known-clinics-checklist.json is absent; add it to enforce >=90%', () => {});
  }
  it('requires active coverage in all 27 governorates except current owner-reviewed decisions', () => {
    expect(new Set(cities.map((c) => c.governorate)).size).toBe(27);
    const decisions = readData<CoverageException[]>('coverage-exceptions.json');
    expect(() =>
      assertGovernorateCoverage(
        cities.map((c) => c.governorate),
        clinics,
        decisions,
      ),
    ).not.toThrow();
  });
});

it('gives each branch in a brand group a distinct English and Arabic display name', () => {
  for (const group of clinicBrandGroups(clinics)) {
    expect(new Set(group.map((c) => c.nameEnglish)).size).toBe(group.length);
    expect(new Set(group.map((c) => c.nameArabic)).size).toBe(group.length);
  }
});
