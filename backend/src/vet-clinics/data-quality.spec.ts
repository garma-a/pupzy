import * as fs from 'fs';
import * as path from 'path';
import { createHash } from 'crypto';
import { containsPoint } from '../cities/coverage';
import {
  Clinic,
  OsmElement,
  Review,
  ChecklistEntry,
  DATA_DIR,
  readData,
  clinicSchema,
  cities,
  districts,
  governorates,
  assignCity,
  cleanName,
  duplicate,
  exclusionRule,
  canonicalUrl,
  checklistResults,
  assertReviewedSharedPhones,
  SharedPhoneDecision,
  DistinctAddressDecision,
  clinicBrandGroups,
  qualifyClinicBranches,
  displayNameEnglish,
  endsWithAdministrativeUnit,
  isGeocoderUrl,
  hasDoubleArabicDescriptor,
} from './catalog';
import { addressStreet, GeocodeSnapshot, matchStreetPoint } from './geocoding';
import { buildBaseline } from './pipeline';
import { generateMigration } from './migration';
import { assertGovernorateCoverage, CoverageException } from './coverage';
const clinics = readData<Clinic[]>('egypt-vet-clinics.json');
const raw = readData<{ elements: OsmElement[] }>('osm-egypt.json.gz').elements;
const reviews = readData<Review[]>('reviewed-decisions.json');
describe('Egypt Vet Clinic data quality (offline)', () => {
  it('binds the complete raw snapshot to its manifest and reviews every source exactly once', () => {
    const manifest = readData<{ sha256: string; elements: number; query: string }>('osm-manifest.json');
    expect(
      createHash('sha256')
        .update(fs.readFileSync(path.join(DATA_DIR, 'osm-egypt.json.gz')))
        .digest('hex'),
    ).toBe(manifest.sha256);
    expect(readData<{ sourceSha256: string }>('review-metadata.json').sourceSha256).toBe(manifest.sha256);
    expect(manifest.elements).toBe(raw.length);
    expect(manifest.query).toBe(fs.readFileSync(path.join(__dirname, 'scripts/egypt-vets.overpass'), 'utf8'));
    expect(new Set(reviews.map((r) => r.sourceKey)).size).toBe(raw.length);
    expect(reviews.map((r) => r.sourceKey).sort()).toEqual(raw.map((e) => `OSM:${e.type}/${e.id}`).sort());
  });
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
      for (const entity of c.osmEntities) {
        const el = raw.find((r) => `${r.type}/${r.id}` === entity)!;
        expect(el).toBeDefined();
        expect(exclusionRule(el.tags ?? {})).toBeNull();
        const review = reviews.find((r) => r.sourceKey === `OSM:${entity}`)!;
        expect(review.decision).toBe('include');
        for (const [field, tag, script] of [
          ['nameEnglish', 'name:en', /[a-z]/i],
          ['nameArabic', 'name:ar', /[\u0600-\u06ff]/],
        ] as const) {
          const sourced = el.tags?.[tag] ?? (script.test(el.tags?.name ?? '') ? el.tags?.name : undefined);
          if (c.source === 'OSM' && (!sourced || cleanName(sourced) !== c[field])) {
            const bare = (name: string) => name.replace(/\s*\([^()]*\)\s*$/, '');
            const onlyBranchChanged = sourced && bare(cleanName(sourced)) === bare(c[field]);
            expect(c[`${field}Origin`]).toBe(onlyBranchChanged ? 'authored' : 'transliterated');
          }
        }
      }
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
      if (c.locationPrecision === 'street') {
        const evidence = readData<GeocodeSnapshot>(c.coordinateProvenance.responseFile!);
        expect(evidence.userAgent).toBe('PupzyDataReview/1.0');
        expect(evidence.httpStatus).toBe(200);
        const point = matchStreetPoint(c, evidence.response);
        expect(point).not.toBeNull();
        expect(point?.latitude).toBe(c.latitude);
        expect(point?.longitude).toBe(c.longitude);
        expect(point?.matchedStreet).toBe(c.coordinateProvenance.matchedStreet);
      }
      if (c.source === 'OSM') {
        const el = raw.find((r) => `https://www.openstreetmap.org/${r.type}/${r.id}` === c.coordinateProvenance.url)!;
        expect(c.latitude).toBe(el.lat ?? el.center?.lat);
        expect(c.longitude).toBe(el.lon ?? el.center?.lon);
      }
    }
  });
  it('reviews shared phones before deduplication and rejects Franco-Arabic display names', () => {
    assertReviewedSharedPhones(
      readData<Clinic[]>('web-reviewed-clinics.json'),
      readData<SharedPhoneDecision[]>('shared-phone-decisions.json'),
    );
    const realNames = readData<Array<{ nameEnglish: string; evidence: string; sources: string[] }>>(
      'real-digit-brand-decisions.json',
    );
    for (const c of clinics) {
      if (/[a-z]\d+[a-z]/i.test(c.nameEnglish)) {
        const decision = realNames.find((d) => d.nameEnglish === c.nameEnglish);
        expect(decision?.evidence).toBeTruthy();
        expect(decision?.sources.length).toBeGreaterThan(0);
      }
    }
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
  it('translates authored Arabic descriptors once, preserving documented source spellings', () => {
    const inputs = readData<Clinic[]>('web-reviewed-clinics.json');
    for (const group of clinicBrandGroups(clinics)) {
      const keys = new Set(group.map((c) => c.sourceKey));
      const sourceNames = inputs
        .filter((c) => keys.has(c.sourceKey) && c.nameArabicOrigin === 'source')
        .map((c) => c.nameArabic.replace(/\s*\((?:[^()]|\([^()]*\))*\)\s*$/, ''));
      for (const c of group) expect(hasDoubleArabicDescriptor(c, sourceNames)).toBe(false);
    }
  });
  it('keeps reviewed shop satellites excluded from the import and release', () => {
    const exclusions = readData<Array<{ reason: string; entry: { key: string } }>>('research-stage2-e-exclusions.json');
    const inputs = readData<Clinic[]>('web-reviewed-clinics.json');
    for (const exclusion of exclusions) {
      expect(exclusion.reason).toBe('part-time-satellite-in-shop');
      expect([...inputs, ...clinics].some((c) => c.sourceKey === `WEB:${exclusion.entry.key}`)).toBe(false);
    }
  });
  it('records an Arabic then English Nominatim attempt for every researched street address', () => {
    for (const c of readData<Clinic[]>('web-reviewed-clinics.json')) {
      for (const language of ['ar', 'en']) {
        if (!addressStreet(language === 'ar' ? c.addressArabic : c.addressEnglish)) continue;
        const evidence = readData<GeocodeSnapshot>(`geocodes/${c.sourceKey.slice(4)}-${language}.json`);
        expect(evidence.userAgent).toBe('PupzyDataReview/1.0');
        expect(evidence.query).toBeTruthy();
        expect(evidence.fetchedAt).toBeTruthy();
      }
    }
  });
  it('has unique natural keys and no duplicate phone, name within 150 m, or OSM entity', () => {
    expect(new Set(clinics.map((c) => c.sourceKey)).size).toBe(clinics.length);
    const phoneDecisions = readData<SharedPhoneDecision[]>('shared-phone-decisions.json');
    const distinctAddresses = readData<DistinctAddressDecision[]>('distinct-address-decisions.json');
    clinics.forEach((a, i) =>
      clinics.slice(i + 1).forEach((b) => expect(duplicate(a, b, phoneDecisions, distinctAddresses)).toBe(false)),
    );
  });
  it('binds distinct-address name-collision decisions to different sourced addresses and contacts', () => {
    for (const d of readData<DistinctAddressDecision[]>('distinct-address-decisions.json')) {
      const [a, b] = d.sourceKeys.map((key) => clinics.find((c) => c.sourceKey === key)!);
      expect(a).toBeDefined();
      expect(b).toBeDefined();
      expect(d.reviewedAt).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      expect(d.evidence).toBeTruthy();
      expect(a.addressArabic).not.toBe(b.addressArabic);
      expect(
        [a.phone, ...a.additionalPhones].some((phone) => phone && [b.phone, ...b.additionalPhones].includes(phone)),
      ).toBe(false);
      for (const c of [a, b]) expect(c.sources.some((s) => d.sources.includes(s.url))).toBe(true);
    }
  });
  it('reproduces the reviewed dataset, exclusions, merges and release SQL byte for byte', () => {
    const built = buildBaseline();
    expect(built.clinics).toEqual(clinics);
    expect(built.report).toEqual(readData('baseline-report.json'));
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
    for (const decision of decisions) {
      const ledger = readData<{ governorate: string }>(decision.ledger);
      expect(ledger.governorate).toBe(decision.governorate);
    }
    expect(() =>
      assertGovernorateCoverage(
        cities.map((c) => c.governorate),
        clinics,
        decisions,
      ),
    ).not.toThrow();
  });
});

it('keeps every reviewed branch candidate explicit and binds retained branches to imported identities', () => {
  const audit = readData<
    Array<{ brand: string; branches: Array<{ status: string; sourceKey?: string; evidence: string }> }>
  >('depth-multibranch-review.json');
  for (const page of audit) {
    expect(page.brand).toBeTruthy();
    expect(page.branches.length).toBeGreaterThan(1);
    for (const branch of page.branches) {
      expect(['retained', 'held', 'excluded', 'moved']).toContain(branch.status);
      expect(branch.evidence).toBeTruthy();
      if (branch.status === 'retained') expect(clinics.some((c) => c.sourceKey === branch.sourceKey)).toBe(true);
    }
  }
  for (const group of clinicBrandGroups(clinics)) {
    expect(new Set(group.map((c) => c.nameEnglish)).size).toBe(group.length);
    expect(new Set(group.map((c) => c.nameArabic)).size).toBe(group.length);
  }
});
it('retains every accepted depth candidate and records a disposition for each discovered listing', () => {
  const rawInputs = readData<Clinic[]>('web-reviewed-clinics.json');
  for (const group of ['D1', 'D2', 'D3', 'D4']) {
    const decisions = Object.values(
      readData<Record<string, { url: string; status: string; reason: string; evidence: string }>>(
        `depth-${group}-decisions.json`,
      ),
    );
    const discovery = readData<Record<string, { entries: Array<{ url: string }> }>>(`depth-${group}-discovery.json`);
    for (const city of Object.values(discovery))
      for (const entry of city.entries) expect(decisions.some((d) => d.url === entry.url)).toBe(true);
    for (const d of decisions)
      if (d.status === 'retained') {
        expect(d.evidence).toBeTruthy();
        expect(rawInputs.some((c) => c.sourceKey === `WEB:${d.reason}`)).toBe(true);
      }
  }
});
