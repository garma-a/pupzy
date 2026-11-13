import { generateMigration } from './migration';
import {
  normalizePhones,
  canonicalUrl,
  cleanName,
  checklistResults,
  readData,
  Clinic,
  duplicate,
  assignCity,
  clinicSchema,
  cities,
  normalizeClinicBrand,
  assertReviewedSharedPhones,
  qualifyClinicBranches,
  endsWithAdministrativeUnit,
  clinicCityQualifier,
  validBranchQualifier,
  validDisplayNameEnglish,
  addressEndsAtGovernorate,
  displayNameEnglish,
  hasDoubleArabicDescriptor,
  DistinctAddressDecision,
} from './catalog';
import phoneFixtures from './data/phone-fixtures.json';
describe('Vet Clinic normalization and release rules', () => {
  it.each([
    ['01013779994', '+201013779994'],
    ['+20 106 469 3169', '+201064693169'],
    ['0020 2 2345 6789', '+20223456789'],
    ['٠٣٤٨٦٠١٨٢', '+2034860182'],
    ['040 2345678', '+20402345678'],
    ['013 3221412', '+20133221412'],
    ['+01016106277', null],
    ['12345', null],
    ['+201312345678', null],
    ['01000000000', null],
  ])('normalizes or rejects %s', (raw, phone) => expect(normalizePhones(raw).phone).toBe(phone));
  it.each(phoneFixtures)('shared admin phone fixture %s', (raw, phone) => {
    expect(normalizePhones(raw!).phone).toBe(phone);
  });
  it('keeps only the first valid phone and reports extra/invalid numbers', () => {
    expect(normalizePhones('junk;01013779994;+201060099011;01013779994')).toEqual({
      phone: '+201013779994',
      additionalPhones: ['+201060099011'],
      rejected: ['junk'],
    });
  });
  it('cleans names and canonicalizes URLs without inventing telephone prefixes', () => {
    expect(cleanName('  PET VET 🐶 01013779994 ')).toBe('Pet Vet');
    expect(canonicalUrl('EXAMPLE.com/clinic?utm_source=test#fragment')).toBe('https://example.com/clinic');
    expect(canonicalUrl('javascript:alert(1)')).toBeNull();
    expect(canonicalUrl('https://user:password@example.com')).toBeNull();
    expect(assignCity(0, 0)).toBeNull();
  });
  const clinics = readData<Clinic[]>('egypt-vet-clinics.json');
  it('checks exact article-insensitive bilingual names only against active same-governorate clinics', () => {
    const c = clinics.find((r) => r.active)!;
    const entry = { nameEnglish: 'El ' + c.nameEnglish, nameArabic: '', governorate: c.governorate, area: 'test' };
    expect(checklistResults([entry], clinics)[0].passes).toBe(true);
    expect(checklistResults([{ ...entry, nameEnglish: c.nameEnglish.slice(0, 5) }], clinics)[0].passes).toBe(false);
    expect(checklistResults([{ ...entry, governorate: 'not the governorate' }], clinics)[0].passes).toBe(false);
    expect(
      checklistResults(
        [entry],
        clinics.map((r) => ({ ...r, active: false })),
      )[0].passes,
    ).toBe(false);
  });
  it('defaults future releases to INSERT only', () => {
    expect(generateMigration(clinics)).not.toContain('UPDATE vet_clinics');
  });
  it('detects shared phone regardless of distance, shared entity, and nearby normalized names', () => {
    const a = clinics[0],
      b = { ...clinics[1], osmEntities: [], phone: null };
    expect(duplicate(a, { ...b, phone: a.phone })).toBe(true);
    expect(duplicate(a, { ...b, additionalPhones: [a.phone!] })).toBe(true);
    expect(duplicate(a, { ...b, osmEntities: a.osmEntities })).toBe(true);
    expect(
      duplicate(a, { ...b, nameEnglish: 'El ' + a.nameEnglish, latitude: a.latitude, longitude: a.longitude }),
    ).toBe(true);
    expect(
      duplicate(a, { ...b, nameEnglish: a.nameEnglish, latitude: a.latitude + 0.01, longitude: a.longitude }),
    ).toBe(false);
  });
});

it.each([
  ['Al-Qadi Veterinary Clinic', 'qadi'],
  ['Freedom Veterinary Clinics (Ibrahimia)', 'freedom'],
  ['Freedom Vet Center - Cleopatra', 'freedom'],
  ['عيادات الحرية البيطرية (الإبراهيمية)', 'حريه'],
  ['مركز الحرية البيطري - كليوباترا', 'حريه'],
  ['Pet Animal Hospital', 'pet'],
  ['Pets Veterinary Centre', 'pets'],
  ['Dr. Monem Pet Hospital', 'dr monem pet'],
])('normalizes checklist brand %s without discarding pets', (name, expected) => {
  expect(normalizeClinicBrand(name)).toBe(expected);
});

it('matches aliases in either script, strips only one branch and requires a nonempty same-governorate active brand', () => {
  const first = readData<Clinic[]>('egypt-vet-clinics.json')[0];
  const clinic = {
    ...first,
    active: true,
    nameEnglish: 'Published Pet Clinic (East)',
    nameArabic: 'عيادة بت البيطرية',
    aliases: { english: ['Pets Haven Clinic'], arabic: ['عيادات الحرية البيطرية'] },
  };
  const entry = {
    nameEnglish: 'Pets Haven Veterinary Centre - West',
    nameArabic: '',
    governorate: clinic.governorate,
    area: '',
  };
  expect(checklistResults([entry], [clinic])[0].passes).toBe(true);
  expect(
    checklistResults([{ ...entry, nameEnglish: '', nameArabic: 'مركز الحرية البيطري (غرب)' }], [clinic])[0].passes,
  ).toBe(true);
  for (const patch of [
    { nameEnglish: 'Pet Haven Clinic' },
    { nameEnglish: 'Haven Clinic' },
    { nameEnglish: 'Veterinary Clinic' },
    { governorate: 'elsewhere' },
  ])
    expect(checklistResults([{ ...entry, ...patch }], [clinic])[0].passes).toBe(false);
  expect(checklistResults([entry], [{ ...clinic, active: false }])[0].passes).toBe(false);
  expect(normalizeClinicBrand('Pets Haven (East) (West)')).toBe('pets haven east');
  expect(normalizeClinicBrand('Pets Haven (4th District (Sheikh Zayed))')).toBe('pets haven');
});

it('fails an unrelated shared phone before merging unless a reviewed decision records evidence', () => {
  const a = { ...readData<Clinic[]>('egypt-vet-clinics.json')[0], phone: '+201012345678' };
  const b = {
    ...a,
    sourceKey: 'WEB:other',
    nameEnglish: 'Different Pet Clinic',
    nameArabic: 'عيادة اخرى',
    aliases: undefined,
  };
  expect(() => assertReviewedSharedPhones([a, b], [])).toThrow('Unreviewed shared phone');
  expect(() =>
    assertReviewedSharedPhones(
      [a, b],
      [
        {
          phone: a.phone,
          sourceKeys: [a.sourceKey, b.sourceKey],
          action: 'separate',
          reviewedAt: '2026-11-12',
          sources: ['https://example.org/branches'],
          evidence: 'Both named locations explicitly published together.',
        },
      ],
    ),
  ).not.toThrow();
  expect(() => assertReviewedSharedPhones([a, { ...a, sourceKey: 'WEB:same-brand' }], [])).not.toThrow();
});

it('accepts only the recorded address City centre for area precision', () => {
  const first = readData<Clinic[]>('egypt-vet-clinics.json')[0];
  const city = cities.find((c) => c.governorate === 'Alexandria' && c.districtSourceCode)!;
  const clinic = {
    ...first,
    locationPrecision: 'area',
    latitude: city.latitude,
    longitude: city.longitude,
    cityId: city.sourceCode,
    districtSourceCode: city.districtSourceCode,
    governorate: city.governorate,
    addressArabic: 'شارع الاختبار، ' + city.nameArabic,
    coordinateProvenance: {
      url: first.sources[0].url,
      method: 'catalog-city-center',
      precision: 'area',
      citySourceCode: city.sourceCode,
      matchedArea: city.nameArabic,
    },
  };
  expect(clinicSchema.safeParse(clinic).success).toBe(true);
  for (const patch of [
    { latitude: city.latitude + 0.001 },
    { cityId: 'unknown' },
    { addressArabic: 'عنوان بلا منطقة', addressEnglish: null },
    { coordinateProvenance: { ...clinic.coordinateProvenance, matchedArea: 'invented' } },
  ]) {
    expect(clinicSchema.safeParse({ ...clinic, ...patch }).success).toBe(false);
  }
  expect(clinicSchema.safeParse({ ...clinic, locationPrecision: 'street' }).success).toBe(false);
});

it('keeps separately documented chain branches with shared reception contacts', () => {
  const a = readData<Clinic[]>('egypt-vet-clinics.json')[0];
  expect(
    duplicate(
      { ...a, chainKey: 'chain', branchQualifier: 'Smouha' },
      { ...a, sourceKey: 'WEB:branch', chainKey: 'chain', branchQualifier: 'Miami' },
    ),
  ).toBe(false);
  expect(
    duplicate(
      { ...a, chainKey: 'chain', branchQualifier: 'Smouha' },
      { ...a, sourceKey: 'WEB:duplicate', chainKey: 'chain', branchQualifier: 'Smouha' },
    ),
  ).toBe(true);
});

it('qualifies every repeated branch after merging and leaves unique names unqualified', () => {
  const first = readData<Clinic[]>('egypt-vet-clinics.json')[0];
  const city = cities.find((c) => c.sourceCode === first.cityId)!;
  const rows = qualifyClinicBranches([
    {
      ...first,
      nameEnglish: 'Freedom Veterinary Clinic',
      nameArabic: 'عيادة الحرية البيطرية',
      nameEnglishOrigin: 'source',
      nameArabicOrigin: 'source',
    },
    {
      ...first,
      sourceKey: 'WEB:another',
      nameEnglish: 'Freedom Veterinary Clinic (West)',
      nameArabic: 'عيادة الحرية البيطرية (غرب)',
    },
    {
      ...first,
      sourceKey: 'WEB:unique',
      nameEnglish: 'Unique Veterinary Clinic (East)',
      nameArabic: 'عيادة يونيك البيطرية (شرق)',
    },
  ]);
  expect(rows[0].nameEnglish).toBe(`Freedom Veterinary Clinic (${clinicCityQualifier(city.nameEnglish)})`);
  expect(rows[0].nameEnglishOrigin).toBe('authored');
  expect(rows[0].nameArabicOrigin).toBe('authored');
  expect(rows[1].nameEnglish).toBe(`Freedom Veterinary Clinic (${clinicCityQualifier(city.nameEnglish)})`);
  expect(rows[2].nameEnglish).toBe('Unique Veterinary Clinic');
  expect(rows[2].aliases?.english).toContain('Unique Veterinary Clinic (East)');
});

it.each([
  ['PetZone Clinic', 'Pet Zone Veterinary Center'],
  ['Paws & Claws Clinic', 'Paws and Claws Hospital'],
  ['Paws and Claws Clinic', 'Paws & Claws Center'],
  ['عيادات الحرية البيطرية', 'عيادة الحرية'],
])('matches checklist alternative %s against %s with spaces and ampersands folded', (accept, nameEnglish) => {
  const first = readData<Clinic[]>('egypt-vet-clinics.json')[0];
  const clinic = { ...first, active: true, nameEnglish, nameArabic: 'عيادة مختلفة', aliases: undefined };
  const entry = {
    nameEnglish: 'Unrelated',
    nameArabic: '',
    governorate: first.governorate,
    area: '',
    accept: [accept],
  };
  expect(checklistResults([entry], [clinic])[0].passes).toBe(true);
  expect(checklistResults([{ ...entry, accept: ['Other'] }], [clinic])[0].passes).toBe(false);
  expect(checklistResults([{ ...entry, governorate: 'elsewhere' }], [clinic])[0].passes).toBe(false);
  expect(checklistResults([entry], [{ ...clinic, active: false }])[0].passes).toBe(false);
});

it('unifies an explicit chain across governorates even when its English and Arabic names differ', () => {
  const first = readData<Clinic[]>('egypt-vet-clinics.json')[0];
  const elsewhere = cities.find((c) => c.governorate !== first.governorate)!;
  const rows = qualifyClinicBranches([
    { ...first, chainKey: 'vital', nameEnglish: 'Vital Pets New Cairo', nameArabic: 'مستشفى فيتال بيتس' },
    {
      ...first,
      sourceKey: 'WEB:other',
      chainKey: 'vital',
      governorate: elsewhere.governorate,
      cityId: elsewhere.sourceCode,
      nameEnglish: 'Vital Pets Veterinary Center',
      nameArabic: 'مركز فيتال بيتس البيطري',
    },
  ]);
  expect(rows[0].nameEnglish).toMatch(/ \([^()]+\)$/);
  expect(rows[1].nameEnglish).toBe(`Vital Pets New Cairo (${clinicCityQualifier(elsewhere.nameEnglish)})`);
  expect(rows[1].aliases?.english).toContain('Vital Pets Veterinary Center');
  expect(rows[1].nameArabic).toBe(`مستشفى فيتال بيتس (${clinicCityQualifier(elsewhere.nameArabic, true)})`);
});

it('rejects geocoder clinic sources, Latin address commas and authored double descriptors', () => {
  const first = readData<Clinic[]>('egypt-vet-clinics.json')[0];
  for (const url of [
    'https://nominatim.openstreetmap.org/search?q=Cairo',
    'https://www.openstreetmap.org/search?query=Cairo',
    'not-a-url',
  ])
    expect(
      clinicSchema.safeParse({ ...first, sources: [{ url, accessedAt: '2026-11-12', kind: 'WEB' }] }).success,
    ).toBe(false);
  expect(clinicSchema.safeParse({ ...first, addressArabic: 'شارع راغب, حلوان' }).success).toBe(false);
  const name = { ...first, nameArabic: 'مركز بيت كير سنتر البيطري', nameArabicOrigin: 'authored' };
  expect(hasDoubleArabicDescriptor({ ...name, nameArabicOrigin: 'authored' })).toBe(true);
  expect(hasDoubleArabicDescriptor({ ...name, nameArabicOrigin: 'source' })).toBe(false);
  expect(
    hasDoubleArabicDescriptor({ ...name, nameArabicOrigin: 'authored', nameArabic: name.nameArabic + ' (القاهرة)' }, [
      name.nameArabic,
    ]),
  ).toBe(false);
});

it.each([
  ['Galal Street, Damanhour, Damanhur (Kism)', true],
  ['Eye Hospital Street, Minya, Kesm Al-minya', true],
  ['Cairo Street, El Arish 3', true],
  ['شارع القاهرة، قسم ثالث العريش', true],
  ['Galal Street, Damanhour', false],
  ['Fifth Settlement, Al Banafseg 8', false],
  ['شارع القاهرة، العريش', false],
])('recognizes administrative unit labels at the end of %s', (address, expected) => {
  expect(endsWithAdministrativeUnit(address)).toBe(expected);
});

it('never gives an unrelated clinic another business name; similar names only earn place qualifiers', () => {
  const first = readData<Clinic[]>('egypt-vet-clinics.json')[0];
  const elsewhere = cities.find((c) => c.governorate !== first.governorate)!;
  const other = { sourceKey: 'WEB:other', governorate: elsewhere.governorate, cityId: elsewhere.sourceCode };
  const rows = qualifyClinicBranches([
    { ...first, chainKey: undefined, nameEnglish: 'Animal Care Clinic', nameArabic: 'عيادة أنيمال كير' },
    {
      ...first,
      ...other,
      chainKey: undefined,
      nameEnglish: 'Veterinary Care Center',
      nameArabic: 'مركز الرعاية البيطرية',
    },
  ]);
  expect(rows[0].nameEnglish).toMatch(/^Animal Care Clinic \([^()]+\)$/);
  expect(rows[1].nameEnglish).toBe(`Veterinary Care Center (${clinicCityQualifier(elsewhere.nameEnglish)})`);
  expect(rows[1].nameArabic).toBe(`مركز الرعاية البيطرية (${clinicCityQualifier(elsewhere.nameArabic, true)})`);
  const arabicOnly = qualifyClinicBranches([
    { ...first, chainKey: undefined, nameEnglish: 'Nile Pet Clinic', nameArabic: 'عيادة النيل البيطرية' },
    {
      ...first,
      ...other,
      chainKey: undefined,
      nameEnglish: 'Nile Veterinary Clinic',
      nameArabic: 'عيادة النيل البيطرية',
    },
  ]);
  expect(arabicOnly[0].nameArabic).not.toBe(arabicOnly[1].nameArabic);
  expect(arabicOnly[1].nameEnglish).toBe(`Nile Veterinary Clinic (${clinicCityQualifier(elsewhere.nameEnglish)})`);
});

it('requires a reviewed identity decision for same-name area points and never exempts shared contacts or OSM identities', () => {
  const first = readData<Clinic[]>('egypt-vet-clinics.json')[0];
  const other = {
    ...first,
    sourceKey: 'WEB:distinct',
    phone: '+201012345678',
    additionalPhones: [],
    osmEntities: [],
    website: null,
    facebookUrl: null,
  };
  const a = { ...first, phone: '+201013779994', osmEntities: ['node/123'], website: null, facebookUrl: null };
  const decision: DistinctAddressDecision = {
    sourceKeys: [a.sourceKey, other.sourceKey],
    reviewedAt: '2026-11-12',
    evidence: 'Distinct sourced addresses and disjoint contacts',
    sources: ['https://example.org/a', 'https://example.org/b'],
  };
  expect(duplicate(a, other)).toBe(true);
  expect(duplicate(a, other, [], [decision])).toBe(false);
  expect(duplicate(a, { ...other, phone: a.phone }, [], [decision])).toBe(true);
  expect(duplicate(a, { ...other, osmEntities: a.osmEntities }, [], [decision])).toBe(a.osmEntities.length > 0);
  expect(duplicate(a, other, [], [{ ...decision, evidence: '' }])).toBe(true);
});

it('flattens subarea qualifiers and rejects nested names and mixed aliases', () => {
  expect(clinicCityQualifier('Banha (Kism)')).toBe('Banha');
  expect(clinicCityQualifier('الحي السابع (الشيخ زايد)', true)).toBe('الشيخ زايد، الحي السابع');
  const first = readData<Clinic[]>('egypt-vet-clinics.json')[0];
  const city = cities.find((c) => c.nameEnglish === '7th District (Sheikh Zayed)')!;
  expect(city).toBeDefined();
  const rows = qualifyClinicBranches([
    { ...first, cityId: city.sourceCode },
    { ...first, sourceKey: 'WEB:branch', cityId: city.sourceCode },
  ]);
  expect(rows[0].nameEnglish).toContain('(Sheikh Zayed, 7th District)');
  expect(rows[0].nameArabic).not.toMatch(/\([^)]*\(/);
  for (const patch of [
    { nameEnglish: 'Clinic (District (City))' },
    { nameArabic: 'عيادة (الحي (المدينة))' },
    { aliases: { english: ['عيادة Clinic'], arabic: [] } },
    { aliases: { english: [], arabic: ['عيادة Clinic'] } },
  ])
    expect(clinicSchema.safeParse({ ...first, ...patch }).success).toBe(false);
  expect(clinicSchema.safeParse({ ...first, active: false, inactiveReason: 'unconfirmed-branch' }).success).toBe(true);
});

it('uses plain bilingual city qualifiers across administrative units and preserves numbered neighbourhoods', () => {
  for (const [en, ar, expected, expectedAr] of [
    ['E Mansora 2', 'قسم ثان المنصورة', 'Mansoura', 'المنصورة'],
    ['Zaqaziq 2', 'قسم ثان الزقازيق', 'Zagazig', 'الزقازيق'],
    ['Damanhur (Kism)', 'قسم دمنهور', 'Damanhour', 'دمنهور'],
    ['Kafr Al-Dawwar (Kism)', 'كفر الدوار (قسم)', 'Kafr El Dawwar', 'كفر الدوار'],
    ['Minuf City', 'قسم مدينة منوف', 'Menouf', 'منوف'],
    ['Shibin al-Kum (Markaz)', 'مركز شبين الكوم', 'Shebin El Kom', 'شبين الكوم'],
    ['Tanta 2', 'مركز طنطا', 'Tanta', 'طنطا'],
    ['Al Banafseg 8', 'البنفسج 8', 'Al Banafseg 8', 'البنفسج 8'],
  ]) {
    expect(clinicCityQualifier(en)).toBe(expected);
    expect(clinicCityQualifier(ar, true)).toBe(expectedAr);
  }
  for (const q of ['Kism', 'Markaz', 'Qism', 'قسم', 'مركز', 'Tanta 2', 'E Mansora 2', 'Zaqaziq 2', 'طنطا ٢'])
    expect(validBranchQualifier(`Clinic (${q})`)).toBe(false);
});
it('gates display casing without losing source spellings or deliberate brand styling', () => {
  for (const name of ['kit Cat veterinary clinic', 'Your vet clinic', 'MISR PET center'])
    expect(validDisplayNameEnglish(name)).toBe(false);
  for (const name of ['LaClinica Pet&Vet Peticare KMT ACO MVC', "Pet's Choice", 'Vets for Pets', 'Al Banafseg 8'])
    expect(validDisplayNameEnglish(name)).toBe(true);
  expect(displayNameEnglish('MISR PET center')).toBe('Misr Pet Center');
  expect(displayNameEnglish('Damnhour pet clinic and pet shop')).toBe('Damnhour Pet Clinic and Pet Shop');
});
it('rejects trailing units after either governorate script while retaining ordinary street addresses', () => {
  expect(addressEndsAtGovernorate('Street, Tanta, Gharbia, Tanta 2', 'Gharbia')).toBe(false);
  expect(addressEndsAtGovernorate('شارع، طنطا، الغربية، قسم ثان طنطا', 'Gharbia')).toBe(false);
  expect(addressEndsAtGovernorate('Street, Tanta, Gharbia', 'Gharbia')).toBe(true);
});
