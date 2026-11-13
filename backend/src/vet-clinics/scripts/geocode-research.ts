/** Explicit, serial Nominatim review; every HTTP/error response is checked in. */
import * as fs from 'fs';
import * as path from 'path';
import { createHash } from 'crypto';
import { Clinic, DATA_DIR, readData, cities, normalizeName } from '../catalog';
import { addressStreet, applyCachedGeocodes, GeocodeSnapshot } from '../geocoding';

async function main() {
  const governorate = process.argv[2];
  if (!governorate) throw new Error('Specify governorate');
  const records = readData<Clinic[]>('web-reviewed-clinics.json');
  const slug = governorate.toLowerCase().replace(/ /g, '-');
  const authored = ['', '-extra', '-primary'].flatMap((suffix) => {
    const file = path.join(DATA_DIR, `research-${slug}${suffix}.json`);
    return fs.existsSync(file)
      ? (JSON.parse(fs.readFileSync(file, 'utf8')) as Array<{
          key: string;
          area: string;
          addressArabic: string;
          addressEnglish: string;
          citySourceCode?: string;
        }>)
      : [];
  });
  const tasks: Array<
    Pick<Clinic, 'sourceKey' | 'addressArabic' | 'addressEnglish'> & { cityId?: string; area?: string }
  > = [
    ...records.filter((r) => r.governorate === governorate),
    ...authored
      .filter((e) => !records.some((c) => c.sourceKey === 'WEB:' + e.key))
      .map((e) => ({ ...e, sourceKey: 'WEB:' + e.key })),
  ];
  fs.mkdirSync(path.join(DATA_DIR, 'geocodes'), { recursive: true });
  let lastRequest = 0;
  for (const c of tasks) {
    for (const language of ['ar', 'en']) {
      const street = addressStreet(language === 'ar' ? c.addressArabic : c.addressEnglish);
      if (!street) continue;
      const file = path.join(DATA_DIR, `geocodes/${c.sourceKey.slice(4)}-${language}.json`);
      const input = authored.find((e) => 'WEB:' + e.key === c.sourceKey);
      const matches = input
        ? cities.filter(
            (r) =>
              r.governorate === governorate &&
              (!input.citySourceCode || r.sourceCode === input.citySourceCode) &&
              [r.nameEnglish, r.nameArabic, ...(r.aliases ?? [])].some(
                (name) => normalizeName(name) === normalizeName(input.area),
              ),
          )
        : [];
      const neighbourhoods = matches.filter((r) => r.districtSourceCode);
      const choices = neighbourhoods.length ? neighbourhoods : matches;
      // Use the reviewed address City, not a nearby City assigned by a previous street point.
      const city = choices.length === 1 ? choices[0] : cities.find((r) => r.sourceCode === c.cityId);
      const area = city ? (language === 'ar' ? city.nameArabic : city.nameEnglish) : c.area;
      const query = `${street}, ${area}, ${governorate}, Egypt`;
      if (fs.existsSync(file)) {
        const previous = JSON.parse(fs.readFileSync(file, 'utf8')) as GeocodeSnapshot;
        if (previous.query === query) continue;
        // Preserve the earlier response when a clinic-published move changes its address.
        const fingerprint = createHash('sha256').update(previous.query).digest('hex').slice(0, 12);
        fs.copyFileSync(file, file.replace(/\.json$/, `-${fingerprint}.json`));
      }
      const url = new URL('https://nominatim.openstreetmap.org/search');
      for (const [k, v] of Object.entries({
        q: query,
        format: 'jsonv2',
        addressdetails: '1',
        countrycodes: 'eg',
        limit: '5',
        'accept-language': language,
      }))
        url.searchParams.set(k, v);
      await new Promise((resolve) => setTimeout(resolve, Math.max(0, 1100 - (Date.now() - lastRequest))));
      lastRequest = Date.now();
      const snapshot: GeocodeSnapshot = {
        query,
        url: url.toString(),
        userAgent: 'PupzyDataReview/1.0',
        fetchedAt: new Date().toISOString(),
        httpStatus: null,
        response: [],
      };
      try {
        const result = await fetch(url, {
          headers: { 'User-Agent': snapshot.userAgent },
          signal: AbortSignal.timeout(20000),
        });
        snapshot.httpStatus = result.status;
        const body = await result.text();
        try {
          const parsed: unknown = JSON.parse(body);
          if (Array.isArray(parsed)) snapshot.response = parsed as GeocodeSnapshot['response'];
          else snapshot.rawBody = body;
        } catch {
          snapshot.rawBody = body;
        }
      } catch (error) {
        snapshot.error = String(error);
      }
      fs.writeFileSync(file, JSON.stringify(snapshot, null, 2) + '\n');
      console.log(`${c.sourceKey} ${language}: HTTP ${snapshot.httpStatus}, ${snapshot.response.length} results`);
    }
  }
  const updated = records.map((c) => (c.governorate === governorate ? applyCachedGeocodes(c) : c));
  fs.writeFileSync(path.join(DATA_DIR, 'web-reviewed-clinics.json'), JSON.stringify(updated, null, 2) + '\n');
  console.log(
    JSON.stringify({
      governorate,
      street: updated.filter((c) => c.governorate === governorate && c.locationPrecision === 'street').length,
    }),
  );
}
void main().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
