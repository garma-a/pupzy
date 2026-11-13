import * as fs from 'fs';
import * as path from 'path';
import { containsPoint } from '../cities/coverage';
import { Clinic, DATA_DIR, districts, normalizeName, assignCity } from './catalog';

export interface GeocodeResult {
  lat: string;
  lon: string;
  name?: string;
  class?: string;
  category?: string;
  type?: string;
  addresstype?: string;
  address?: { road?: string; pedestrian?: string; building?: string };
}
export interface GeocodeSnapshot {
  query: string;
  url: string;
  userAgent: string;
  fetchedAt: string;
  httpStatus: number | null;
  response: GeocodeResult[];
  rawBody?: string;
  error?: string;
}
export function addressStreet(address: string | null): string | null {
  if (!address) return null;
  const arabic = address.match(/(?:شارع|ش\.?\s|طريق)\s*([^،,؛;]+)/);
  const numbered = address.match(/\b(?:street|road)\s+\d+\b/i);
  const english = address.match(/(?:^|,\s*)([^,]+?\b(?:street|st\.?|road|rd\.?|avenue|square)\b)/i);
  const street = arabic?.[1] ?? numbered?.[0] ?? english?.[1] ?? '';
  return (
    street
      .replace(/^\s*(?:behind|opposite|extension of)\s+/i, '')
      .replace(/\s*\([^)]*\).*$/, '')
      .split(/\s+(?:تقاطع|بجوار|بجانب|أمام|امام|متفرع|ناصية|beside|opposite|intersection)\s+/i)[0]
      .replace(/^(?:[\d٠-٩]+\s+)(?=\D)/, '')
      .trim() || null
  );
}
export function normalizedStreet(value: string): string {
  return normalizeName(value)
    .replace(/\b(street|st|road|rd|avenue|square)\b/g, '')
    .replace(/^(?:شارع|ش |طريق)\s*/, '')
    .replace(/[^\p{L}\p{N}\s]/gu, '')
    .replace(/\s+/g, ' ')
    .trim();
}
/** A POI's road address is insufficient: the result itself must be a road/building. */
export function matchStreetPoint(c: Clinic, response: GeocodeResult[]) {
  const streets = [addressStreet(c.addressArabic), addressStreet(c.addressEnglish)].filter((s): s is string => !!s);
  const polygon = districts.find((f) => f.properties.districtSourceCode === c.districtSourceCode);
  if (!polygon) return null;
  for (const r of response) {
    const category = r.category ?? r.class;
    if (!(
      category === 'highway' ||
      category === 'building' ||
      ['building', 'house', 'road'].includes(r.addresstype ?? '')
    ))
      continue;
    const name = r.name ?? (category === 'highway' ? (r.address?.road ?? r.address?.pedestrian) : r.address?.building);
    if (!name || !streets.some((s) => normalizedStreet(s) === normalizedStreet(name))) continue;
    const longitude = Number(r.lon),
      latitude = Number(r.lat);
    if (!Number.isFinite(longitude) || !Number.isFinite(latitude) || !containsPoint([longitude, latitude], polygon))
      continue;
    const assignment = assignCity(longitude, latitude);
    if (!assignment || assignment.districtSourceCode !== c.districtSourceCode) continue;
    return { latitude, longitude, matchedStreet: name, assignment };
  }
  return null;
}
export function applyCachedGeocodes(c: Clinic): Clinic {
  for (const language of ['ar', 'en']) {
    const prefix = `${c.sourceKey.slice(4)}-${language}`;
    const directory = path.join(DATA_DIR, 'geocodes');
    const files = fs.existsSync(directory) ? fs.readdirSync(directory) : [];
    // A subsequent query can be empty; earlier recorded evidence remains valid only
    // when it still matches the current address street and expected district.
    const candidates = [
      `${prefix}.json`,
      ...files.filter((name) => name.startsWith(prefix + '-') && name.endsWith('.json')).sort(),
    ];
    for (const name of candidates) {
      const responseFile = `geocodes/${name}`;
      const file = path.join(DATA_DIR, responseFile);
      if (!fs.existsSync(file)) continue;
      const snapshot = JSON.parse(fs.readFileSync(file, 'utf8')) as GeocodeSnapshot;
      if (snapshot.httpStatus !== 200) continue;
      const match = matchStreetPoint(c, snapshot.response);
      if (!match) continue;
      return {
        ...c,
        ...match.assignment,
        latitude: match.latitude,
        longitude: match.longitude,
        locationPrecision: 'street',
        coordinateProvenance: {
          url: snapshot.url,
          method: 'recorded-geocode',
          precision: 'street',
          responseFile,
          matchedStreet: match.matchedStreet,
        },
      };
    }
  }
  return c;
}
