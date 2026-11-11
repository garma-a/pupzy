import type { CityCatalogRecord } from './catalog';
import { readCityData } from './data-files';
import { normalizeCitySearch } from './search';
import { addReviewedTransliterations, type AliasGenerationReview } from './transliteration';
import { reviewCityAliases } from './alias-review';

export interface OsmElement {
  type: 'node' | 'way' | 'relation';
  id: number;
  lat?: number;
  lon?: number;
  center?: { lat: number; lon: number };
  tags?: Record<string, string>;
}

export interface SourceSnapshot<T> {
  metadata: { retrievalDate: string; license: string; attribution: string; queryFile: string };
  response: T;
}

export interface PlaceDecision {
  sourceCode: string;
  decision: 'include' | 'exclude' | 'merge';
  reviewed: boolean;
  notes: string;
  nameEnglish?: string;
  nameArabic?: string;
  sourceNameArabic?: string;
  sourceNameEnglish?: string;
  aliases?: string[];
  governorateCode?: string;
  districtSourceCode?: string;
  /** Required for curated points and corrections; never inferred from the nearest centroid. */
  point?: { latitude: number; longitude: number; evidence: string };
  parentEvidence?: string;
  provenance?: Record<string, unknown>;
  mergeInto?: string;
}

export interface NeighbourhoodSources {
  overpassFiles?: string[];
  decisionsFile?: string;
  sourceDigests?: Record<string, string>;
  wikidataFile?: string;
  aliasGeneration?: AliasGenerationReview;
  districtEdits: Array<{
    sourceCode: string;
    nameEnglish: string;
    nameArabic?: string;
    aliases: string[];
    notes: string;
  }>;
  overpass?: SourceSnapshot<{ elements: OsmElement[] }>;
  wikidata?: SourceSnapshot<{ results: { bindings: Array<Record<string, { value: string }>> } }>;
  decisions: PlaceDecision[];
}

export function hydrateNeighbourhoodSources(sources: NeighbourhoodSources): NeighbourhoodSources {
  const result = { ...sources };
  if (sources.decisionsFile)
    result.decisions = readCityData<PlaceDecision[]>(
      sources.decisionsFile,
      sources.sourceDigests?.[sources.decisionsFile],
    );
  if (sources.overpassFiles?.length) {
    const elements = sources.overpassFiles.flatMap(
      (file) => readCityData<{ elements: OsmElement[] }>(file, sources.sourceDigests?.[file]).elements,
    );
    if (!sources.overpass) throw new Error('OSM provenance metadata missing');
    result.overpass = { ...sources.overpass, response: { elements } };
  }
  if (sources.wikidataFile) {
    if (!sources.wikidata) throw new Error('Wikidata provenance metadata missing');
    result.wikidata = {
      ...sources.wikidata,
      response: readCityData<NonNullable<NeighbourhoodSources['wikidata']>['response']>(
        sources.wikidataFile,
        sources.sourceDigests?.[sources.wikidataFile],
      ),
    };
  }
  return result;
}

/** All source responses and review decisions travel in the publisher's single snapshot artifact. */
export function extendDistrictCatalog(
  districts: CityCatalogRecord[],
  sources: NeighbourhoodSources,
): CityCatalogRecord[] {
  sources = hydrateNeighbourhoodSources(sources);
  const records: CityCatalogRecord[] = districts.map((row) => ({
    ...row,
    aliases: row.aliases ?? [],
    districtSourceCode: null,
  }));
  const byCode = new Map<string, CityCatalogRecord>(records.map((row) => [row.sourceCode, row]));
  for (const edit of sources.districtEdits) {
    const district = byCode.get(edit.sourceCode);
    if (!district || !edit.notes.trim()) throw new Error(`Invalid district edit ${edit.sourceCode}`);
    district.aliases = [
      ...new Set([...(district.aliases ?? []), district.nameEnglish, district.nameArabic, ...edit.aliases]),
    ].filter((alias) => alias !== edit.nameEnglish && alias !== (edit.nameArabic ?? district.nameArabic));
    district.nameEnglish = edit.nameEnglish;
    district.nameArabic = edit.nameArabic ?? district.nameArabic;
  }
  const elements = new Map((sources.overpass?.response.elements ?? []).map((e) => [`OSM:${e.type}/${e.id}`, e]));
  const wdById = new Map<string, Array<Record<string, { value: string }>>>();
  for (const row of sources.wikidata?.response.results.bindings ?? []) {
    const id = row.item?.value.split('/').at(-1);
    if (!id) continue;
    const entries = wdById.get(id) ?? [];
    entries.push(row);
    wdById.set(id, entries);
  }
  const seen = new Set<string>();
  for (const decision of sources.decisions) {
    if (seen.has(decision.sourceCode)) throw new Error(`Duplicate review decision ${decision.sourceCode}`);
    seen.add(decision.sourceCode);
    if (!decision.reviewed) continue;
    if (!decision.notes.trim()) throw new Error(`Review notes required: ${decision.sourceCode}`);
    if (decision.decision === 'exclude') continue;
    if (decision.decision === 'merge') {
      const target = byCode.get(decision.mergeInto ?? '');
      if (!target) throw new Error(`Unknown merge district: ${decision.sourceCode}`);
      target.aliases = [
        ...new Set([
          ...(target.aliases ?? []),
          ...(decision.aliases ?? []),
          decision.nameEnglish ?? '',
          decision.nameArabic ?? '',
        ]),
      ].filter((alias) => alias && alias !== target.nameEnglish && alias !== target.nameArabic);
      continue;
    }
    const district = byCode.get(decision.districtSourceCode ?? '');
    const element = elements.get(decision.sourceCode);
    const wdId =
      element?.tags?.wikidata ?? (decision.sourceCode.startsWith('WD:') ? decision.sourceCode.slice(3) : undefined);
    const wdRows = wdId ? (wdById.get(wdId) ?? []) : [];
    const wdPoint = wdRows[0]?.coord?.value.match(/^Point\(([-0-9.]+) ([-0-9.]+)\)$/);
    const nameEnglish = decision.nameEnglish ?? element?.tags?.['name:en'] ?? wdRows.find((r) => r.en)?.en.value;
    const nameArabic = decision.nameArabic ?? element?.tags?.['name:ar'] ?? wdRows.find((r) => r.ar)?.ar.value;
    if (
      element &&
      (!sources.overpass?.metadata.retrievalDate ||
        !sources.overpass.metadata.license ||
        !sources.overpass.metadata.attribution)
    )
      throw new Error('Missing OSM provenance');
    if (
      decision.sourceCode.startsWith('WD:') &&
      (!wdRows.length || !sources.wikidata?.metadata.retrievalDate || !sources.wikidata.metadata.license)
    )
      throw new Error('Missing Wikidata evidence');
    const point =
      decision.point ??
      (element
        ? { latitude: element.lat ?? element.center?.lat, longitude: element.lon ?? element.center?.lon }
        : wdPoint
          ? { longitude: Number(wdPoint[1]), latitude: Number(wdPoint[2]) }
          : undefined);
    if (
      !district ||
      district.districtSourceCode ||
      district.status !== 'OFFICIAL' ||
      district.governorateCode !== decision.governorateCode ||
      !decision.parentEvidence?.trim() ||
      !nameEnglish ||
      !nameArabic ||
      !Number.isFinite(point?.latitude) ||
      !Number.isFinite(point?.longitude) ||
      (!element && !wdPoint && !decision.point?.evidence.trim())
    ) {
      throw new Error(`Incomplete reviewed place/point/parent evidence: ${decision.sourceCode}`);
    }
    const existingDistrict = [...byCode.values()]
      .filter((d) => !d.districtSourceCode)
      .find(
        (d) =>
          d.governorateCode === decision.governorateCode &&
          [d.nameEnglish, d.nameArabic.replace(/^(قسم|مركز|مدينة)\s*/, '')].some(
            (n) =>
              normalizeCitySearch(n) === normalizeCitySearch(nameEnglish) ||
              normalizeCitySearch(n) === normalizeCitySearch(nameArabic),
          ),
      );
    if (existingDistrict) throw new Error(`Place coincides with district; use merge decision: ${decision.sourceCode}`);
    const record: CityCatalogRecord = {
      ...district,
      sourceCode: decision.sourceCode,
      nameEnglish,
      nameArabic,
      sourceNameEnglish: decision.sourceNameEnglish ?? element?.tags?.['name:en'] ?? element?.tags?.name ?? nameEnglish,
      sourceNameArabic: decision.sourceNameArabic ?? element?.tags?.['name:ar'] ?? element?.tags?.name ?? nameArabic,
      latitude: point!.latitude!,
      longitude: point!.longitude!,
      aliases: [
        ...new Set([
          ...(decision.aliases ?? []),
          ...wdRows.flatMap((r) => [r.enAlias?.value, r.arAlias?.value]).filter((v): v is string => !!v),
        ]),
      ].filter((a) => a !== nameEnglish && a !== nameArabic),
      districtSourceCode: district.sourceCode,
      provenance: {
        ...decision.provenance,
        source: element ? 'OSM' : decision.sourceCode.startsWith('WD:') ? 'Wikidata' : 'hand-curated',
        notes: decision.notes,
        parentEvidence: decision.parentEvidence,
        pointEvidence: decision.point?.evidence ?? decision.sourceCode,
      },
    };
    if (sources.decisionsFile) {
      // The complete audit is retained once in the pinned compressed decisions.
      // Published rows retain the facts needed for quality validation and a
      // resolvable source reference instead of duplicating long review prose.
      const facts = [
        'coverageArea',
        'nameDisambiguation',
        'arabicNameDisambiguation',
        'proxyPoint',
        'representativeOf',
      ];
      const detail = record.provenance!;
      record.provenance = {
        ...Object.fromEntries(facts.filter((key) => detail[key] !== undefined).map((key) => [key, detail[key]])),
        ...(typeof detail.parentRule === 'string' && detail.parentRule.startsWith('zemam-out')
          ? {
              parentRule: detail.parentRule,
              zemamOutSourceCode: detail.zemamOutSourceCode,
              parentPolygonDistanceKm: detail.parentPolygonDistanceKm,
              ...(detail.parentRule === 'zemam-out-named-city'
                ? {
                    parentCandidateSourceCodes: detail.parentCandidateSourceCodes,
                    parentCityEvidence: detail.parentCityEvidence,
                  }
                : {}),
            }
          : {}),
        source: detail.source,
        notes: 'reviewed-decisions.json.gz#' + decision.sourceCode,
        parentEvidence: 'OCHA ' + decision.districtSourceCode,
        pointEvidence: decision.provenance?.coordinateSource
          ? JSON.stringify(decision.provenance.coordinateSource)
          : decision.sourceCode,
      };
    }
    if (byCode.has(record.sourceCode)) throw new Error(`Duplicate source identity ${record.sourceCode}`);
    records.push(record);
    byCode.set(record.sourceCode, record);
  }
  for (const row of records) {
    const seenAliases = new Set([row.nameEnglish.toLowerCase(), row.nameArabic.toLowerCase()]);
    row.aliases = (row.aliases ?? [])
      .map((a) => a.trim())
      .filter((a) => {
        if (!a || seenAliases.has(a.toLowerCase())) return false;
        seenAliases.add(a.toLowerCase());
        return true;
      });
  }
  if (sources.aliasGeneration) addReviewedTransliterations(records, sources.aliasGeneration);
  // Merge decisions and source aliases can restore a parent's former sub-area
  // shorthand. Apply this after every alias producer so exact matching credits
  // the separately named City rather than its enclosing district.
  const canonicalNames = new Map<string, Set<string>>();
  for (const row of records.filter((r) => r.status === 'OFFICIAL')) {
    for (const name of [row.nameEnglish, row.nameArabic]) {
      const key = row.governorateCode + ':' + normalizeCitySearch(name);
      const owners = canonicalNames.get(key) ?? new Set<string>();
      owners.add(row.sourceCode);
      canonicalNames.set(key, owners);
    }
  }
  for (const row of records) {
    row.aliases = (row.aliases ?? []).filter((alias) => {
      // Untouched official Arabic source labels remain searchable by contract.
      if (!row.districtSourceCode && alias === row.sourceNameArabic) return true;
      const owners = canonicalNames.get(row.governorateCode + ':' + normalizeCitySearch(alias));
      return !owners || [...owners].every((code) => code === row.sourceCode);
    });
  }
  reviewCityAliases(records);
  return records.sort((a, b) => a.sourceCode.localeCompare(b.sourceCode));
}
