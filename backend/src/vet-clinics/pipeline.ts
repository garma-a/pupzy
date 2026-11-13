import {
  Clinic,
  Review,
  OsmElement,
  readData,
  cleanName,
  canonicalUrl,
  normalizePhones,
  normalizeArabicAddress,
  assignCity,
  duplicate,
  assertReviewedSharedPhones,
  SharedPhoneDecision,
  DistinctAddressDecision,
  qualifyClinicBranches,
  exclusionRule,
  governorates,
  cities,
} from './catalog';
import { containsPoint } from '../cities/coverage';

export function buildBaseline() {
  const raw = readData<{ elements: OsmElement[] }>('osm-egypt.json.gz');
  const manifest = readData<{ fetchedAt: string; sha256: string }>('osm-manifest.json');
  if (readData<{ sourceSha256: string }>('review-metadata.json').sourceSha256 !== manifest.sha256)
    throw new Error('Source changed: review is required before rebuilding');
  const reviews = readData<Review[]>('reviewed-decisions.json');
  const rejected: Array<{ sourceKey: string; reason: string; governorate: string | null }> = [];
  const phoneIssues: Array<{ sourceKey: string; rejected: string[]; additionalPhones: string[] }> = [];
  const records: Clinic[] = [];
  for (const el of raw.elements) {
    const key = `OSM:${el.type}/${el.id}`;
    const review = reviews.find((r) => r.sourceKey === key);
    if (!review) throw new Error(`Unreviewed source: ${key}`);
    const tags = el.tags ?? {};
    const phones = normalizePhones(
      [tags.phone, tags['contact:phone'], tags.mobile, tags['contact:mobile']].filter(Boolean).join(';'),
    );
    if (phones.rejected.length || phones.additionalPhones.length)
      phoneIssues.push({ sourceKey: key, rejected: phones.rejected, additionalPhones: phones.additionalPhones });

    const lat = el.lat ?? el.center?.lat,
      lon = el.lon ?? el.center?.lon;
    const govCode =
      lat !== undefined && lon !== undefined
        ? governorates.find((f) => containsPoint([lon, lat], f))?.properties.governorateCode
        : null;
    const governorate = cities.find((c) => c.governorateCode === govCode)?.governorate ?? null;
    const reject = (reason: string) => rejected.push({ sourceKey: key, reason, governorate });
    if (review.decision === 'exclude') {
      reject(review.reason);
      continue;
    }
    if (exclusionRule(tags)) throw new Error(`Included excluded category ${key}`);
    if (lat === undefined || lon === undefined) {
      reject('missing-point');
      continue;
    }
    const assignment = assignCity(lon, lat);
    if (!assignment) {
      reject('outside-selectable-adm2');
      continue;
    }
    const generic = tags.name ?? '';
    const en = tags['name:en'] ?? (/[a-z]/i.test(generic) && !/[\u0600-\u06ff]/.test(generic) ? generic : '');
    const ar = tags['name:ar'] ?? (/[\u0600-\u06ff]/.test(generic) ? generic : '');
    const address = tags['addr:full'] ?? tags['addr:street'];
    const addressEnglish =
      tags['addr:full:en'] ?? tags['addr:street:en'] ?? (address && !/[\u0600-\u06ff]/.test(address) ? address : null);
    const addressArabic =
      tags['addr:full:ar'] ?? tags['addr:street:ar'] ?? (address && /[\u0600-\u06ff]/.test(address) ? address : null);
    const url = `https://www.openstreetmap.org/${el.type}/${el.id}`;
    const precise = true; // Reviewed OSM clinic nodes/ways qualify as exact per owner decision.
    records.push({
      sourceKey: key,
      source: 'OSM',
      osmEntities: [`${el.type}/${el.id}`],
      nameEnglish: cleanName(review.nameEnglish ?? en),
      nameArabic: cleanName(review.nameArabic ?? ar),
      nameEnglishOrigin: review.nameEnglishOrigin ?? 'source',
      nameArabicOrigin: review.nameArabicOrigin ?? 'source',
      latitude: lat,
      longitude: lon,
      locationPrecision: 'exact',
      lastSeenActive: null,
      hoursEvidence: tags.opening_hours === '24/7' ? 'OSM opening_hours=24/7' : null,
      coordinateProvenance: {
        url,
        method: el.type === 'node' ? 'osm-node' : 'osm-center',
        precision: 'exact',
      },
      phone: phones.phone,
      additionalPhones: phones.additionalPhones,
      addressEnglish,
      addressArabic: normalizeArabicAddress(addressArabic),
      addressEnglishOrigin: addressEnglish ? 'source' : 'missing',
      addressArabicOrigin: addressArabic ? 'source' : 'missing',
      website: canonicalUrl(tags.website ?? tags['contact:website']),
      facebookUrl: canonicalUrl(tags['contact:facebook'] ?? tags.facebook),
      is24Hours: tags.opening_hours === '24/7',
      ...assignment,
      category: review.category!,
      classificationEvidence: review.reason,
      sources: [{ url, accessedAt: manifest.fetchedAt.slice(0, 10), kind: 'OSM' }],
      active: !!phones.phone && precise,
      inactiveReason: !phones.phone ? 'no-phone' : precise ? null : 'imprecise-point',
    });
  }
  for (const web of readData<Clinic[]>('web-reviewed-clinics.json')) {
    if (web.source !== 'WEB_RESEARCH' || !web.sourceKey.startsWith('WEB:')) throw new Error('Invalid web identity');
    const assignment =
      web.locationPrecision === 'area'
        ? { cityId: web.cityId, districtSourceCode: web.districtSourceCode, governorate: web.governorate }
        : assignCity(web.longitude, web.latitude);
    if (!assignment) {
      rejected.push({ sourceKey: web.sourceKey, reason: 'outside-selectable-adm2', governorate: null });
      continue;
    }
    records.push({ ...web, ...assignment });
  }
  const phoneDecisions = readData<SharedPhoneDecision[]>('shared-phone-decisions.json');
  assertReviewedSharedPhones(records, phoneDecisions);
  const distinctAddresses = readData<DistinctAddressDecision[]>('distinct-address-decisions.json');
  // Connected components: a bridge duplicate must merge the entire group.
  const groups: Clinic[][] = [];
  for (const row of records.sort((a, b) => a.sourceKey.localeCompare(b.sourceKey))) {
    const matching = groups.filter((g) =>
      g.some((member) => duplicate(member, row, phoneDecisions, distinctAddresses)),
    );
    const group = [row, ...matching.flat()];
    for (const g of matching) groups.splice(groups.indexOf(g), 1);
    groups.push(group);
  }
  const hasOwnSource = (c: Clinic) =>
    !!c.website && c.sources.some((source) => new URL(source.url).hostname === new URL(c.website!).hostname);
  const merges: Array<{ sourceKey: string; mergedSourceKeys: string[] }> = [];
  const clinics = qualifyClinicBranches(
    groups
      .map((g) => {
        g.sort(
          (a, b) =>
            Number(b.active) - Number(a.active) ||
            Number(hasOwnSource(b)) - Number(hasOwnSource(a)) ||
            Number(!!b.branchQualifier) - Number(!!a.branchQualifier) ||
            a.sourceKey.localeCompare(b.sourceKey),
        );
        const [first] = g;
        const precisionRank = { exact: 0, street: 1, area: 2 };
        const location = [...g].sort(
          (a, b) => precisionRank[a.locationPrecision] - precisionRank[b.locationPrecision],
        )[0];
        if (g.length > 1)
          merges.push({ sourceKey: first.sourceKey, mergedSourceKeys: g.slice(1).map((c) => c.sourceKey) });
        return {
          ...first,
          aliases: {
            english: [...new Set(g.flatMap((c) => [c.nameEnglish, ...(c.aliases?.english ?? [])]))].sort(),
            arabic: [...new Set(g.flatMap((c) => [c.nameArabic, ...(c.aliases?.arabic ?? [])]))].sort(),
          },
          latitude: location.latitude,
          longitude: location.longitude,
          locationPrecision: location.locationPrecision,
          coordinateProvenance: location.coordinateProvenance,
          cityId: location.cityId,
          districtSourceCode: location.districtSourceCode,
          governorate: location.governorate,
          is24Hours: g.some((c) => c.is24Hours),
          hoursEvidence: g.find((c) => c.is24Hours)?.hoursEvidence ?? null,
          lastSeenActive:
            g
              .map((c) => c.lastSeenActive)
              .filter((date): date is string => !!date)
              .sort()
              .at(-1) ?? null,
          osmEntities: [...new Set(g.flatMap((c) => c.osmEntities))].sort(),
          sources: [...new Map(g.flatMap((c) => c.sources).map((source) => [source.url, source])).values()],
          additionalPhones: [
            ...new Set(
              g.flatMap((c) => [c.phone, ...c.additionalPhones]).filter((p): p is string => !!p && p !== first.phone),
            ),
          ],
        };
      })
      .sort((a, b) => a.sourceKey.localeCompare(b.sourceKey)),
  );
  const candidateKeys = new Set(
    raw.elements
      .filter(
        (e) =>
          e.tags?.amenity === 'veterinary' ||
          e.tags?.healthcare === 'veterinary' ||
          (Object.entries(e.tags ?? {}).some(
            ([k, v]) =>
              ['name', 'name:en', 'name:ar'].includes(k) && /\bvet\b|veterinary|animal hospital|بيطر/i.test(v),
          ) &&
            !e.tags?.highway),
      )
      .map((e) => `OSM:${e.type}/${e.id}`),
  );

  const counts = [...new Set(cities.map((c) => c.governorate))].sort().map((governorate) => ({
    governorate,
    active: clinics.filter((c) => c.governorate === governorate && c.active).length,
    inactiveNoPhone: clinics.filter((c) => c.governorate === governorate && c.inactiveReason === 'no-phone').length,
    inactiveImprecise: clinics.filter((c) => c.governorate === governorate && c.inactiveReason === 'imprecise-point')
      .length,
    rejected: rejected.filter((c) => c.governorate === governorate).length,
    rejectedCandidates: rejected.filter((c) => c.governorate === governorate && candidateKeys.has(c.sourceKey)).length,
  }));
  return {
    clinics,
    report: {
      rawElements: raw.elements.length,
      candidates: candidateKeys.size,
      discoveryNoise: raw.elements.length - candidateKeys.size,
      candidateExclusionsByReason: Object.fromEntries(
        [...new Set(rejected.filter((r) => candidateKeys.has(r.sourceKey)).map((r) => r.reason))]
          .sort()
          .map((reason) => [
            reason,
            rejected.filter((r) => candidateKeys.has(r.sourceKey) && r.reason === reason).length,
          ]),
      ),
      excludedByReason: Object.fromEntries(
        [...new Set(rejected.map((r) => r.reason))]
          .sort()
          .map((reason) => [reason, rejected.filter((r) => r.reason === reason).length]),
      ),
      rejected,
      merges,
      phoneIssues,
      counts,
    },
  };
}
