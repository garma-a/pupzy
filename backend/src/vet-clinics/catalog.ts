import * as fs from 'fs';
import * as path from 'path';
import { gunzipSync } from 'zlib';
import { z } from 'zod';
import { containsPoint, distanceMeters, hydratePolygons } from '../cities/coverage';
import type { CityCatalog } from '../cities/catalog';
import { readCityData } from '../cities/data-files';
import { normalizeCitySearch } from '../cities/search';

export const DATA_DIR = path.resolve(__dirname, 'data');
export const phonePattern =
  /^\+20(1[0125][0-9]{8}|2[0-9]{8}|3[0-9]{7}|(13|40|45|46|47|48|50|55|57|62|64|65|66|68|69|82|84|86|88|92|93|95|96|97)[0-9]{7})$/;
export const normalizeName = normalizeCitySearch;
export const httpUrl = z
  .string()
  .url()
  .refine((s) => /^https?:\/\//.test(s) && !/\s/.test(s));
const origin = z.enum(['source', 'transliterated', 'authored', 'missing']);
/** Search/geocoding endpoints locate an address; they do not attest a clinic. */
export function isGeocoderUrl(value: string): boolean {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return false; // httpUrl reports invalid URL syntax separately.
  }
  return (
    /(^|\.)nominatim\./i.test(url.hostname) ||
    (/(^|\.)openstreetmap\.org$/i.test(url.hostname) && /^\/(search|geocoder)(\/|$)/i.test(url.pathname))
  );
}
export function normalizeArabicAddress(value: string | null): string | null {
  return value?.replace(/\s*[,،](?:\s*[,،])*\s*/g, '، ').trim() ?? null;
}
export const clinicSchema = z
  .object({
    sourceKey: z.string().regex(/^(OSM:(node|way|relation)\/\d+|WEB:[a-z0-9-]+)$/),
    source: z.enum(['OSM', 'WEB_RESEARCH']),
    chainKey: z.string().optional(),
    branchQualifier: z.string().optional(),
    osmEntities: z.array(z.string().regex(/^(node|way|relation)\/\d+$/)),
    aliases: z.object({ english: z.array(z.string()), arabic: z.array(z.string()) }).optional(),
    nameEnglish: z.string().min(1).max(200),
    nameArabic: z.string().min(1).max(200),
    nameEnglishOrigin: origin,
    nameArabicOrigin: origin,
    latitude: z.number().min(22).max(32),
    longitude: z.number().min(24).max(37),
    locationPrecision: z.enum(['exact', 'street', 'area']),
    lastSeenActive: z.iso.date().nullable(),
    hoursEvidence: z.string().nullable(),
    coordinateProvenance: z.object({
      url: httpUrl,
      method: z.enum(['osm-node', 'osm-center', 'recorded-geocode', 'clinic-published', 'catalog-city-center']),
      precision: z.enum(['exact', 'street', 'area']),
      citySourceCode: z.string().optional(),
      matchedArea: z.string().optional(),
      responseFile: z
        .string()
        .regex(/^geocodes\/[a-z0-9-]+\.json$/)
        .optional(),
      matchedStreet: z.string().optional(),
    }),
    phone: z.string().regex(phonePattern).nullable(),
    additionalPhones: z.array(z.string().regex(phonePattern)),
    addressEnglish: z.string().nullable(),
    addressArabic: z.string().nullable(),
    addressEnglishOrigin: origin,
    addressArabicOrigin: origin,
    website: httpUrl.nullable(),
    facebookUrl: httpUrl.nullable(),
    is24Hours: z.boolean(),
    governorate: z.string().min(1),
    districtSourceCode: z.string().min(1),
    cityId: z.string().min(1),
    category: z.enum(['private-clinic', 'animal-hospital', 'emergency-clinic']),
    classificationEvidence: z.string().min(1),
    sources: z.array(z.object({ url: httpUrl, accessedAt: z.iso.date(), kind: z.enum(['OSM', 'WEB']) })).min(1),
    active: z.boolean(),
    inactiveReason: z.enum(['no-phone', 'imprecise-point', 'stale-evidence', 'unconfirmed-branch']).nullable(),
  })
  .strict()
  .superRefine((c, ctx) => {
    const fail = (message: string) => ctx.addIssue({ code: 'custom', message });
    if (!validDisplayNameEnglish(c.nameEnglish)) fail('English display-name casing must be reviewed');
    if (![c.nameEnglish, c.nameArabic].every(validBranchQualifier)) fail('Branch qualifiers must name a place');
    if (![c.addressEnglish, c.addressArabic].every((a) => addressEndsAtGovernorate(a, c.governorate)))
      fail('Addresses must end at the governorate');
    if ([c.nameEnglish, c.nameArabic].some((name) => /\([^)]*\(/.test(name)))
      fail('Display names cannot contain nested parentheses');
    if (
      c.aliases?.english.some((name) => /\p{Script=Arabic}/u.test(name)) ||
      c.aliases?.arabic.some((name) => /[a-z]/i.test(name))
    )
      fail('Aliases must use their declared script');
    if (c.sources.some((s) => isGeocoderUrl(s.url))) fail('Clinic sources cannot be geocoder URLs');
    if (c.addressArabic !== normalizeArabicAddress(c.addressArabic))
      fail('Arabic address comma spacing must be normalized');
    if (c.locationPrecision !== c.coordinateProvenance.precision) fail('Precision must agree with provenance');
    if (c.active && (!c.phone || c.inactiveReason)) fail('Active clinic requires phone and no inactive reason');
    if (c.is24Hours && !c.hoursEvidence) fail('24-hour operation requires explicit evidence');
    if (
      c.locationPrecision === 'exact' &&
      !['osm-node', 'osm-center', 'clinic-published'].includes(c.coordinateProvenance.method)
    )
      fail('Exact point requires first-party or OSM provenance');
    if (
      c.locationPrecision === 'street' &&
      (c.coordinateProvenance.method !== 'recorded-geocode' ||
        !c.coordinateProvenance.responseFile ||
        !c.coordinateProvenance.matchedStreet)
    )
      fail('Street point requires cached geocoder evidence');
    if (c.locationPrecision === 'area') {
      const city = cities.find((r) => r.sourceCode === c.cityId);
      const proof = c.coordinateProvenance;
      if (
        !city ||
        city.governorate !== c.governorate ||
        c.districtSourceCode !== (city.districtSourceCode ?? city.sourceCode) ||
        proof.method !== 'catalog-city-center' ||
        proof.citySourceCode !== c.cityId ||
        c.latitude !== city.latitude ||
        c.longitude !== city.longitude
      )
        fail('Area point must equal the recorded catalog City centre');
      const area = normalizeName(proof.matchedArea ?? '');
      const address = normalizeName([c.addressArabic, c.addressEnglish].filter(Boolean).join(' '));
      if (
        !area ||
        !address.includes(area) ||
        !city ||
        ![
          city.nameArabic,
          city.nameEnglish,
          clinicCityQualifier(city.nameEnglish),
          clinicCityQualifier(city.nameArabic, true),
          ...(city.aliases ?? []),
        ].some((name) => normalizeName(name) === area)
      )
        fail('Area requires a named City match in the recorded address');
    }
    if (
      c.active &&
      c.lastSeenActive &&
      c.lastSeenActive < '2022-01-01' &&
      new Set(c.sources.map((s) => new URL(s.url).hostname)).size < 2
    )
      fail('Stale single-source evidence must remain inactive');
  });
export type Clinic = z.infer<typeof clinicSchema>;
/** A catalog qualifier is authored even when the underlying clinic name is sourced. */
export function hasDoubleArabicDescriptor(
  c: Pick<Clinic, 'nameArabic' | 'nameArabicOrigin'>,
  sourceNames: string[] = [],
): boolean {
  const bare = c.nameArabic.replace(/\s*\((?:[^()]|\([^()]*\))*\)\s*$/, '');
  if (c.nameArabicOrigin === 'source' || sourceNames.includes(bare)) return false;
  return (
    /(?:مركز|عياد[ةه]|مستشفى|بيطري)/.test(bare) && /(?:^|\s)(?:سنتر|كليني?ك|هوسبيتال|فيتيريناري)(?:$|\s)/.test(bare)
  );
}
export interface OsmElement {
  type: 'node' | 'way' | 'relation';
  id: number;
  lat?: number;
  lon?: number;
  center?: { lat: number; lon: number };
  tags?: Record<string, string>;
}
export interface Review {
  sourceKey: string;
  decision: 'include' | 'exclude';
  reason: string;
  category?: Clinic['category'];
  nameEnglish?: string;
  nameArabic?: string;
  nameEnglishOrigin?: Clinic['nameEnglishOrigin'];
  nameArabicOrigin?: Clinic['nameArabicOrigin'];
}
export function readData<T>(file: string): T {
  const bytes = fs.readFileSync(path.join(DATA_DIR, file));
  return JSON.parse((file.endsWith('.gz') ? gunzipSync(bytes) : bytes).toString()) as T;
}
export const cities = readCityData<CityCatalog>('egypt-cities-catalog.json').records;
const polygons = (level: 1 | 2) =>
  hydratePolygons({
    sourcePath: `neighbourhoods/ocha-cod-ab/egy_admin${level}.geojson.gz`,
    ochaLevel: level,
    metadata: { reviewed: true, notes: 'Existing OCHA source snapshot; exact polygon containment.' },
    features: [],
  }).features;
export const districts = polygons(2);
export const governorates = polygons(1);
export function assignCity(longitude: number, latitude: number) {
  const district = districts.find((f) => containsPoint([longitude, latitude], f));
  if (!district) return null;
  const parent = cities.find((c) => c.sourceCode === district.properties.districtSourceCode && !c.districtSourceCode);
  if (!parent) return null; // Zemam Out is not a selectable City; never silently assign a neighbouring district.
  const neighbourhood = cities
    .filter((c) => c.districtSourceCode === parent.sourceCode)
    .map((city) => ({ city, distance: distanceMeters([longitude, latitude], [city.longitude, city.latitude]) }))
    .filter((v) => v.distance <= 2000)
    .sort((a, b) => a.distance - b.distance || a.city.sourceCode.localeCompare(b.city.sourceCode))[0]?.city;
  return {
    cityId: (neighbourhood ?? parent).sourceCode,
    districtSourceCode: parent.sourceCode,
    governorate: parent.governorate,
  };
}
export function normalizePhones(value: string) {
  const valid: string[] = [],
    rejected: string[] = [];
  for (const original of value.split(/[;,/|\n]/).filter((v) => v.trim())) {
    let p = original
      .trim()
      .replace(/[٠-٩]/g, (c) => String(c.charCodeAt(0) - 1632))
      .replace(/[۰-۹]/g, (c) => String(c.charCodeAt(0) - 1776))
      .replace(/^tel:/i, '')
      .replace(/[\s().-]/g, '');
    if (p.startsWith('0020')) p = '+' + p.slice(2);
    else if (/^20\d+$/.test(p)) p = '+' + p;
    else if (/^0\d+$/.test(p)) p = '+20' + p.slice(1);
    if (phonePattern.test(p) && !/([0-9])\1{6}/.test(p)) {
      if (!valid.includes(p)) valid.push(p);
    } else rejected.push(original.trim());
  }
  return { phone: valid[0] ?? null, additionalPhones: valid.slice(1), rejected };
}
export function cleanName(s: string) {
  const value = s
    .replace(/[\p{Extended_Pictographic}\uFE0F\u200D]/gu, '')
    .replace(/\+?[\d٠-٩۰-۹][\d٠-٩۰-۹\s()-]{7,}[\d٠-٩۰-۹]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
  return /[A-Z]/.test(value) && !/[a-z]/.test(value)
    ? value.toLowerCase().replace(/\b[a-z]/g, (c) => c.toUpperCase())
    : value;
}
export function canonicalUrl(value?: string): string | null {
  if (!value) return null;
  try {
    const u = new URL(/^https?:\/\//i.test(value) ? value : 'https://' + value);
    if (
      !['https:', 'http:'].includes(u.protocol) ||
      u.username ||
      u.password ||
      /\s/.test(value) ||
      !u.hostname.includes('.')
    )
      return null;
    u.hash = '';
    for (const key of [...u.searchParams.keys()]) if (/^(utm_|fbclid)/.test(key)) u.searchParams.delete(key);
    return u.toString();
  } catch {
    return null;
  }
}
export function exclusionRule(tags: Record<string, string>): string | null {
  const text = Object.values(tags).join(' ').toLowerCase();
  if (/home[ -]visits?[ -]only|home[ -]visit[ -]only|mobile[ -]only|زيارات منزلي[هة] فقط/.test(text))
    return 'home-visit-only';
  if (
    ['dentist', 'physiotherapist', 'optometrist'].includes(tags.healthcare) ||
    /human clinic|عياد[هة] بشري/.test(text)
  )
    return 'human-healthcare';
  if (
    /الوحد[هة]|وحد[هة] بيطر|مديري[هة]|الطب البيطري|govern[em]*ent|livestock|animal health research|بحوث الصح[هة] الحيواني/.test(
      text,
    )
  )
    return 'government-or-livestock';
  if (/pharmacy|صيدلي|supply|supplies|مستلزمات/.test(text)) return 'pharmacy-or-supplies';
  if (/boarding|groom|hotel|شالي|شالية|chalet|cat food/.test(text)) return 'shop-grooming-or-boarding';
  if (/faculty|كلي[هة]/.test(text) && !/hospital|مستشف/.test(text)) return 'faculty-administration';
  if (tags.shop === 'pet' && tags.amenity !== 'veterinary' && tags.healthcare !== 'veterinary')
    return 'pet-shop-without-clinic-evidence';
  return null;
}
export interface DistinctAddressDecision {
  sourceKeys: [string, string];
  reviewedAt: string;
  evidence: string;
  sources: string[];
}
export function duplicate(
  a: Clinic,
  b: Clinic,
  decisions: SharedPhoneDecision[] = [],
  distinctAddresses: DistinctAddressDecision[] = [],
): boolean {
  if (a.sourceKey === b.sourceKey) return true;
  if (
    decisions.some(
      (d) =>
        d.action === 'separate' &&
        d.sourceKeys.includes(a.sourceKey) &&
        d.sourceKeys.includes(b.sourceKey) &&
        [a.phone, ...a.additionalPhones].includes(d.phone) &&
        [b.phone, ...b.additionalPhones].includes(d.phone),
    )
  )
    return false;
  // Shared reception numbers and brand pages do not collapse documented branches.
  if (
    a.chainKey &&
    a.chainKey === b.chainKey &&
    a.branchQualifier &&
    b.branchQualifier &&
    a.branchQualifier !== b.branchQualifier
  )
    return false;
  return (
    (!!a.website && a.website === b.website && a.cityId === b.cityId) ||
    (!!a.facebookUrl && a.facebookUrl === b.facebookUrl && a.cityId === b.cityId) ||
    a.osmEntities.some((e) => b.osmEntities.includes(e)) ||
    [a.phone, ...a.additionalPhones].some((p) => !!p && [b.phone, ...b.additionalPhones].includes(p)) ||
    (!distinctAddresses.some(
      (d) =>
        d.sourceKeys.includes(a.sourceKey) && d.sourceKeys.includes(b.sourceKey) && d.evidence && d.sources.length >= 2,
    ) &&
      (a.cityId === b.cityId || distanceMeters([a.longitude, a.latitude], [b.longitude, b.latitude]) <= 150) &&
      (normalizeName(a.nameEnglish) === normalizeName(b.nameEnglish) ||
        normalizeName(a.nameArabic) === normalizeName(b.nameArabic)))
  );
}
export interface ChecklistEntry {
  nameEnglish: string | null;
  nameArabic: string | null;
  governorate: string;
  area: string;
  accept?: string[];
}
/** Strip one final branch label before punctuation folding; pets remain part of the brand. */
export function normalizeClinicBrand(value: string): string {
  const unbranched = value.replace(/(?:\s*\((?:[^()]|\([^()]*\))*\)|\s+[–—-]\s+[^–—-]+)\s*$/, '');
  const descriptors = new Set([
    'vet',
    'veterinary',
    'clinic',
    'clinics',
    'center',
    'centre',
    'hospital',
    'animal',
    'animals',
    'عياده',
    'عيادات',
    'بيطري',
    'بيطريه',
    'البيطري',
    'البيطريه',
    'مركز',
    'مستشفي',
  ]);
  return normalizeName(
    normalizeName(unbranched.replace(/&/g, ' and '))
      .replace(/[^\p{L}\p{N}\s]/gu, ' ')
      .split(/\s+/)
      .filter((word) => word && !descriptors.has(word))
      .join(' '),
  );
}
export function clinicBrandsMatch(a: Clinic, b: Clinic): boolean {
  const names = (c: Clinic) =>
    [c.nameEnglish, c.nameArabic, ...(c.aliases?.english ?? []), ...(c.aliases?.arabic ?? [])]
      .map(normalizeClinicBrand)
      .filter(Boolean);
  return names(a).some((name) => names(b).includes(name));
}
/**
 * Group similar display brands nationwide (in either script) plus explicit chains. A group decides
 * which records need a place qualifier; it does not make unrelated clinics share a name.
 */
export function clinicBrandGroups(records: Clinic[]): Clinic[][] {
  const groups: Clinic[][] = [];
  const brand = (name: string) => normalizeClinicBrand(name).replace(/\s/g, '');
  for (const record of records) {
    const arabic = brand(record.nameArabic);
    const matches = groups.filter((g) =>
      g.some(
        (c) =>
          (c.chainKey && c.chainKey === record.chainKey) ||
          brand(c.nameEnglish) === brand(record.nameEnglish) ||
          (!!arabic && brand(c.nameArabic) === arabic),
      ),
    );
    for (const match of matches) groups.splice(groups.indexOf(match), 1);
    groups.push([record, ...matches.flat()]);
  }
  return groups;
}
/** Human place names for administrative catalog units; neighbourhood labels retain their numbers. */
export function clinicCityQualifier(name: string, arabic = false): string {
  const subarea = /^(.*?)\s*\(([^()]+)\)$/.exec(name);
  if (subarea && !/^(?:Kism|Markaz|قسم|مركز)$/i.test(subarea[2]))
    return [clinicCityQualifier(subarea[2], arabic), subarea[1].trim()].join(arabic ? '، ' : ', ');
  if (arabic)
    return name
      .replace(/\s*\((?:قسم|مركز)\)$/, '')
      .replace(/^(?:قسم|مركز)\s+(?:(?:أول|اول|ثان|ثاني|ثالث|رابع)\s+)?/, '')
      .replace(/\s+(?:أول|اول|ثان|ثاني|ثالث|رابع)$/, '')
      .replace(/^مدينة /, '');
  const plain = name
    .replace(/\s*\((?:Kism|Markaz)\)$/, '')
    .replace(/^(?:Kesm|Kism|Qism|Markz|Markaz)\s+(?:(?:Awal|Than)\s+)?/i, '')
    .replace(/(?:[- ]\d+| (?:First|Second|Third|Fourth))$/, (suffix) =>
      /^(?:E Mansora|El Mansora|Zaqaziq|Tanta|El Mahalla El Kobra|Hurghada|Ismailiyya|El Arish|Suhag|Damietta|Shubra El Kheima|Nasr City|New Cairo|10th of Ramadan|6th of October|Port Fuad|Ganoub)/.test(
        name,
      )
        ? ''
        : suffix,
    );
  const reviewed: Record<string, string> = {
    'E Mansora': 'Mansoura',
    'El Mansora': 'Mansoura',
    Zaqaziq: 'Zagazig',
    'El Mahalla El Kobra': 'El Mahalla El Kubra',
    Damanhur: 'Damanhour',
    'Kafr Al-Dawwar': 'Kafr El Dawwar',
    'Minuf City': 'Menouf',
    Minuf: 'Menouf',
    'Shibin al-Kum': 'Shebin El Kom',
    'Al-minya': 'Minya',
    'Al Minya': 'Minya',
    'Kafr Al-Shaykh': 'Kafr El Sheikh',
    Fayyum: 'Fayoum',
    'Bani Swayf': 'Beni Suef',
    Assuit: 'Assiut',
    Suhag: 'Sohag',
    Qina: 'Qena',
    Ismailiyya: 'Ismailia',
    'Marsa Matruh': 'Marsa Matrouh',
    'Bani Swayf City': 'New Beni Suef',
    'Fayyum City': 'New Fayoum',
    'Assuit City': 'New Assiut',
    'Aswan City': 'New Aswan',
  };
  return reviewed[plain] ?? plain;
}
/** Preserve deliberate mixed-case branding and short acronyms; normalize display-only casing. */
export function displayNameEnglish(name: string): string {
  const connectors = new Set(['and', 'of', 'for', 'in', 'the', 'al', 'el']);
  return name.replace(/[A-Za-z0-9]+(?:['’][A-Za-z]+)*/g, (word) => {
    if (connectors.has(word)) return word;
    if (['PET', 'VET'].includes(word)) return word[0] + word.slice(1).toLowerCase();
    if (/^[A-Z]{4,}$/.test(word)) return word[0] + word.slice(1).toLowerCase();
    return word[0].toUpperCase() + word.slice(1);
  });
}
export function validDisplayNameEnglish(name: string): boolean {
  const words = name.match(/[A-Za-z0-9]+(?:['’][A-Za-z]+)*/g) ?? [];
  return (
    words.every((w) => /^(?:[A-Z0-9])/.test(w) || ['and', 'of', 'for', 'in', 'the', 'al', 'el'].includes(w)) &&
    words.every((w) => !/^[A-Z]{4,}$/.test(w))
  );
}
export function validBranchQualifier(name: string): boolean {
  const qualifier = name.match(/\(([^()]*)\)$/)?.[1] ?? '';
  const numberedCity =
    /\s+[\d٠-٩]+$/.test(qualifier) &&
    cities.some(
      (city) =>
        !city.districtSourceCode &&
        [
          clinicCityQualifier(city.nameEnglish),
          clinicCityQualifier(city.nameArabic, true),
          city.nameEnglish.replace(/[- ]\d+$/, ''),
        ].some((name) => normalizeName(name) === normalizeName(qualifier.replace(/\s+[\d٠-٩]+$/, ''))),
    );
  return !/\b(?:Kism|Markaz|Markz|Qism|Kesm)\b|قسم|مركز/i.test(qualifier) && !numberedCity;
}
/** A governorate segment, when present, is always the final address segment. */
export function addressEndsAtGovernorate(address: string | null, governorate: string): boolean {
  if (!address) return true;
  const ar: Record<string, string> = {
    Alexandria: 'الإسكندرية',
    Assiut: 'أسيوط',
    Aswan: 'أسوان',
    Behera: 'البحيرة',
    'Beni Suef': 'بني سويف',
    Cairo: 'القاهرة',
    Dakahlia: 'الدقهلية',
    Damietta: 'دمياط',
    Fayoum: 'الفيوم',
    Gharbia: 'الغربية',
    Giza: 'الجيزة',
    Ismailia: 'الإسماعيلية',
    'Kafr El-Shikh': 'كفر الشيخ',
    Kalyoubia: 'القليوبية',
    Luxor: 'الأقصر',
    Matrouh: 'مطروح',
    Menia: 'المنيا',
    Menoufia: 'المنوفية',
    'New Valley': 'الوادي الجديد',
    'North Sinai': 'شمال سيناء',
    'Port Said': 'بورسعيد',
    Qena: 'قنا',
    'Red Sea': 'البحر الأحمر',
    Sharkia: 'الشرقية',
    'South Sinai': 'جنوب سيناء',
    Suez: 'السويس',
    Suhag: 'سوهاج',
  };
  const segments = address
    .split(/[,،]/)
    .map((s) => normalizeName(s.replace(/^(?:محافظة|Governorate)\s+|\s+Governorate$/gi, '')));
  return !segments
    .slice(0, -1)
    .some((s) => [governorate, ar[governorate]].filter(Boolean).some((g) => normalizeName(g) === s));
}
let unitLabels: Map<string, (typeof cities)[number]> | undefined;
/**
 * The catalog district a segment names when it is an administrative label (kism/markaz or a
 * numbered qism such as "El Arish 3" / "قسم ثالث العريش"). Such labels belong in cityId only.
 */
export function administrativeUnitLabel(segment: string): (typeof cities)[number] | undefined {
  unitLabels ??= new Map(
    cities
      .filter((c) => !c.districtSourceCode)
      .flatMap((c) =>
        [
          ...[c.nameEnglish, c.sourceNameEnglish].filter((n) =>
            /\((?:Kism|Markaz)\)$|\s\d+$|^(?:Kesm|Qesm|Qism|Kism|Markz|Markaz)\b/i.test(n ?? ''),
          ),
          ...[c.nameArabic, c.sourceNameArabic].filter((n) => /^قسم\s|\((?:قسم|مركز)\)$/.test(n ?? '')),
        ].map((n) => [normalizeName(n), c] as const),
      ),
  );
  return unitLabels.get(normalizeName(segment.trim()));
}
export function endsWithAdministrativeUnit(address: string | null): boolean {
  return !!address && !!administrativeUnitLabel(address.split(/[,،]/).pop()!);
}
/** Apply catalog City branch labels after merging, preserving input spellings. */
export function qualifyClinicBranches(records: Clinic[]): Clinic[] {
  const groups = clinicBrandGroups(records);
  const areas = readData<Record<string, { english: string; arabic: string }>>('branch-display-areas.json');
  const bare = (name: string) => name.replace(/\s*\((?:[^()]|\([^()]*\))*\)\s*$/, '');
  return records.map((c) => {
    const city = cities.find((r) => r.sourceCode === c.cityId)!;
    const area = areas[c.sourceKey];
    const group = groups.find((g) => g.includes(c))!;
    const repeated = group.length > 1;
    // Similar names only earn a place label; one brand spelling is shared solely by a reviewed chain.
    const chain = c.chainKey ? group.filter((g) => g.chainKey === c.chainKey) : [c];
    const brand = [...chain].sort((a, b) => a.sourceKey.localeCompare(b.sourceKey))[0];
    const nameEnglish =
      displayNameEnglish(bare(brand.nameEnglish)) +
      (repeated ? ` (${clinicCityQualifier(city.nameEnglish)}${area ? `, ${area.english}` : ''})` : '');
    const nameArabic =
      bare(brand.nameArabic) +
      (repeated ? ` (${clinicCityQualifier(city.nameArabic, true)}${area ? `، ${area.arabic}` : ''})` : '');
    return {
      ...c,
      nameEnglish,
      nameArabic,
      nameEnglishOrigin:
        nameEnglish !== c.nameEnglish && c.nameEnglishOrigin === 'source' ? ('authored' as const) : c.nameEnglishOrigin,
      nameArabicOrigin:
        nameArabic !== c.nameArabic && c.nameArabicOrigin === 'source' ? ('authored' as const) : c.nameArabicOrigin,
      aliases: {
        english: [...new Set([c.nameEnglish, ...(c.aliases?.english ?? [])])].sort(),
        arabic: [...new Set([c.nameArabic, ...(c.aliases?.arabic ?? [])])].sort(),
      },
    };
  });
}
export function checklistResults(entries: ChecklistEntry[], records: Clinic[]) {
  return entries.map((entry) => ({
    ...entry,
    passes: records.some(
      (c) =>
        c.active &&
        normalizeName(c.governorate) === normalizeName(entry.governorate) &&
        [c.nameEnglish, c.nameArabic, ...(c.aliases?.english ?? []), ...(c.aliases?.arabic ?? [])]
          .map(normalizeClinicBrand)
          .filter(Boolean)
          .some((name) =>
            [entry.nameEnglish, entry.nameArabic, ...(entry.accept ?? [])]
              .filter((value): value is string => !!value)
              .map(normalizeClinicBrand)
              .filter(Boolean)
              .some((candidate) => candidate === name || candidate.replace(/\s/g, '') === name.replace(/\s/g, '')),
          ),
    ),
  }));
}
export interface SharedPhoneDecision {
  phone: string;
  sourceKeys: string[];
  action: 'merge' | 'separate';
  evidence: string;
  sources: string[];
  reviewedAt: string;
}
/** Inspect inputs before deduplication so unrelated brands cannot disappear in a merge. */
export function assertReviewedSharedPhones(records: Clinic[], decisions: SharedPhoneDecision[]) {
  const phones = new Map<string, Clinic[]>();
  for (const c of records)
    for (const p of new Set([c.phone, ...c.additionalPhones].filter((v): v is string => !!v)))
      phones.set(p, [...(phones.get(p) ?? []), c]);
  for (const [phone, owners] of phones)
    owners.forEach((a, i) =>
      owners.slice(i + 1).forEach((b) => {
        if (clinicBrandsMatch(a, b)) return;
        const decision = decisions.find(
          (d) => d.phone === phone && d.sourceKeys.includes(a.sourceKey) && d.sourceKeys.includes(b.sourceKey),
        );
        if (
          !decision ||
          !decision.evidence.trim() ||
          !decision.sources.length ||
          !/^\d{4}-\d{2}-\d{2}$/.test(decision.reviewedAt)
        )
          throw new Error(
            `Unreviewed shared phone ${phone}: ${a.sourceKey} (${a.nameEnglish}) / ${b.sourceKey} (${b.nameEnglish})`,
          );
      }),
    );
}
