/** Convert individually authored research entries into reproducible area-level imports. */
import * as fs from 'fs';
import * as path from 'path';
import {
  DATA_DIR,
  cities,
  normalizeName,
  normalizePhones,
  canonicalUrl,
  clinicCityQualifier,
  clinicSchema,
  Clinic,
} from '../catalog';

import { applyCachedGeocodes } from '../geocoding';
import { normalizeArabicAddress } from '../catalog';

interface ResearchEntry {
  key: string;
  inactiveReason?: Clinic['inactiveReason'];
  aliases?: Clinic['aliases'];
  nameEnglish: string;
  nameArabic: string;
  nameEnglishOrigin?: Clinic['nameEnglishOrigin'];
  nameArabicOrigin?: Clinic['nameArabicOrigin'];
  addressEnglish: string;
  addressArabic: string;
  addressEnglishOrigin?: Clinic['addressEnglishOrigin'];
  addressArabicOrigin?: Clinic['addressArabicOrigin'];
  area: string;
  citySourceCode?: string;
  phones: string[];
  sources: Clinic['sources'];
  website: string | null;
  facebookUrl: string | null;
  is24Hours: boolean;
  hoursEvidence: string | null;
  lastSeenActive: string | null;
  classificationEvidence: string;
  chainKey?: string;
  branchQualifier?: string;
}
const governorate = process.argv[2];
if (!governorate) throw new Error('Specify governorate: Alexandria, Cairo, Giza, or Port Said');
const slug = governorate.toLowerCase().replace(/ /g, '-');
const entries = ['', '-extra', '-primary'].flatMap((suffix) => {
  const file = path.join(DATA_DIR, `research-${slug}${suffix}.json`);
  return fs.existsSync(file) ? (JSON.parse(fs.readFileSync(file, 'utf8')) as ResearchEntry[]) : [];
});
if (!entries.length) throw new Error('No reviewed research input for ' + governorate);
const records: Clinic[] = [];
const excluded: Array<{ key: string; reason: string; area: string }> = [];
for (const e of entries) {
  const area = normalizeName(e.area);
  const matches = cities.filter(
    (c) =>
      c.governorate === governorate &&
      (!e.citySourceCode || c.sourceCode === e.citySourceCode) &&
      [c.nameArabic, c.nameEnglish, ...(c.aliases ?? [])].some((n) => normalizeName(n) === area),
  );
  // Prefer the specifically named Neighbourhood over its containing district.
  const neighbourhoods = matches.filter((c) => c.districtSourceCode);
  const choices = neighbourhoods.length ? neighbourhoods : matches;
  if (choices.length !== 1) {
    excluded.push({ key: e.key, reason: choices.length ? 'ambiguous-catalog-area' : 'no-catalog-area', area: e.area });
    continue;
  }
  const city = choices[0];
  const phones = normalizePhones(e.phones.join(';'));
  const sources = e.sources.map((s) => ({ ...s, url: canonicalUrl(s.url)! }));
  const stale =
    !!e.lastSeenActive &&
    e.lastSeenActive < '2022-01-01' &&
    new Set(sources.map((s) => new URL(s.url).hostname)).size < 2;
  const record: Clinic = {
    sourceKey: 'WEB:' + e.key,
    source: 'WEB_RESEARCH',
    osmEntities: [],
    ...(e.chainKey ? { chainKey: e.chainKey, branchQualifier: e.branchQualifier } : {}),
    aliases: {
      english: [...new Set([e.nameEnglish, ...(e.aliases?.english ?? [])])],
      arabic: [...new Set([e.nameArabic, ...(e.aliases?.arabic ?? [])])],
    },
    nameEnglish: e.nameEnglish,
    nameArabic: e.nameArabic,
    nameEnglishOrigin: e.nameEnglishOrigin ?? 'transliterated',
    nameArabicOrigin: e.nameArabicOrigin ?? 'transliterated',
    addressEnglish: e.addressEnglish,
    addressArabic: normalizeArabicAddress(e.addressArabic),
    addressEnglishOrigin: e.addressEnglishOrigin ?? 'authored',
    addressArabicOrigin: e.addressArabicOrigin ?? 'source',
    latitude: city.latitude,
    longitude: city.longitude,
    locationPrecision: 'area',
    coordinateProvenance: {
      url: sources[0].url,
      method: 'catalog-city-center',
      precision: 'area',
      citySourceCode: city.sourceCode,
      matchedArea:
        [
          city.nameArabic,
          city.nameEnglish,
          clinicCityQualifier(city.nameEnglish),
          clinicCityQualifier(city.nameArabic, true),
          ...(city.aliases ?? []),
        ]
          .filter((name) => normalizeName(e.addressArabic + ' ' + e.addressEnglish).includes(normalizeName(name)))
          .sort((a, b) => b.length - a.length)[0] ?? e.area,
    },
    phone: phones.phone,
    additionalPhones: phones.additionalPhones,
    website: canonicalUrl(e.website ?? undefined),
    facebookUrl: canonicalUrl(e.facebookUrl ?? undefined),
    is24Hours: e.is24Hours,
    hoursEvidence: e.hoursEvidence,
    lastSeenActive: e.lastSeenActive,
    governorate,
    cityId: city.sourceCode,
    districtSourceCode: city.districtSourceCode ?? city.sourceCode,
    category: /hospital|مستشفى/i.test(e.nameEnglish) ? 'animal-hospital' : 'private-clinic',
    classificationEvidence: e.classificationEvidence,
    sources,
    active: !!phones.phone && !stale && !e.inactiveReason,
    inactiveReason: e.inactiveReason ?? (!phones.phone ? 'no-phone' : stale ? 'stale-evidence' : null),
  };
  const validation = clinicSchema.safeParse(record);
  if (!validation.success) throw new Error(e.key + ': ' + validation.error.message);
  records.push(applyCachedGeocodes(record));
}
const file = path.join(DATA_DIR, 'web-reviewed-clinics.json');
const existing = JSON.parse(fs.readFileSync(file, 'utf8')) as Clinic[];
fs.writeFileSync(
  file,
  JSON.stringify(
    [...existing.filter((c) => c.governorate !== governorate), ...records].sort((a, b) =>
      a.sourceKey.localeCompare(b.sourceKey),
    ),
    null,
    2,
  ) + '\n',
);
fs.writeFileSync(
  path.join(DATA_DIR, `research-${slug}-import-report.json`),
  JSON.stringify({ candidates: entries.length, imported: records.length, excluded }, null, 2) + '\n',
);
console.log(`${governorate}: ${records.length} reviewed entries imported; run build.ts and data-quality.spec.ts next.`);
