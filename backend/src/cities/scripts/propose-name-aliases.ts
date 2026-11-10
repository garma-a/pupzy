import * as fs from 'fs';
import { CityCatalog } from '../catalog';
import { IndependentNames, COVERAGE_AREAS } from '../coverage';
import { normalizeCitySearch, matchesCitySearch } from '../search';
import { readCityData } from '../data-files';
const c = JSON.parse(fs.readFileSync('output/neighbourhood-cities/candidate-catalog.json', 'utf8')) as CityCatalog;
const names = readCityData<IndependentNames>('neighbourhoods/independent-names.json');
const gov = {
  'greater-cairo': ['EG01', 'EG21', 'EG14', 'EG13'],
  alexandria: ['EG02', 'EG18', 'EG33'],
  'port-said-region': ['EG03', 'EG19', 'EG11'],
};
const norm = (s: string) => normalizeCitySearch(s.replace(/^(?:قسم|مركز|مدينة)\s+/, ''));
const proposals = [];
for (const area of COVERAGE_AREAS)
  for (const e of names.areas[area]) {
    const missing = [e.english, e.arabic, ...e.misspellings].filter(
      (s) =>
        !c.records.some(
          (r) =>
            gov[area].includes(r.governorateCode) &&
            matchesCitySearch(
              s,
              r,
              c.records.find((p) => p.sourceCode === r.districtSourceCode),
            ),
        ),
    );
    if (!missing.length) continue;
    const candidates = c.records.filter(
      (r) =>
        gov[area].includes(r.governorateCode) &&
        [r.nameArabic, ...(r.aliases ?? [])].some((s) => /[\u0600-\u06ff]/.test(s) && norm(s) === norm(e.arabic)),
    );
    if (candidates.length === 1)
      proposals.push({
        area,
        sourceCode: candidates[0].sourceCode,
        english: candidates[0].nameEnglish,
        arabic: candidates[0].nameArabic,
        aliases: missing,
        checklist: e,
      });
  }
fs.writeFileSync('output/neighbourhood-cities/exact-arabic-alias-proposals.json', JSON.stringify(proposals, null, 2));
console.log(proposals.map((p) => [p.sourceCode, p.english, p.arabic, p.aliases]));
