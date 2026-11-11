import type { CityCatalogRecord } from './catalog';
import { normalizeCitySearch } from './search';

export const TRANSLITERATION_RULE_VERSION = 'egyptian-transliteration-v1';
export interface AliasGenerationReview {
  reviewed: boolean;
  ruleVersion: typeof TRANSLITERATION_RULE_VERSION;
  maxPerRow: number;
  districtSourceCodes: string[];
}

/** Fixed, reviewed alternatives; breadth is bounded rather than combinatorial. */
export function englishAliasCandidates(value: string, includeArticle = false): string[] {
  if (!/[a-z]/i.test(value) || /[\u0600-\u06ff]/.test(value)) return [];
  const descriptive = new Set([
    'district',
    'city',
    'village',
    'quarter',
    'housing',
    'compound',
    'buildings',
    'building',
    'towers',
    'tower',
    'north',
    'south',
    'east',
    'west',
    'new',
    'old',
    'first',
    'second',
    'third',
    'fourth',
    'fifth',
    'sixth',
    'seventh',
    'eighth',
    'ninth',
    'tenth',
    'and',
    'of',
    'the',
    'near',
    'capital',
    'residential',
    'centre',
    'center',
    'industrial',
    'social',
    'family',
    'premium',
    'association',
    'company',
    'youth',
    'officers',
    'staff',
    'university',
  ]);
  const mutable = (index: number) => {
    const left = value.slice(0, index).match(/[A-Za-z]+$/)?.[0] ?? '';
    const right = value.slice(index).match(/^[A-Za-z]+/)?.[0] ?? '';
    return !descriptive.has((left + right).toLowerCase());
  };
  const result = new Set<string>();
  const add = (s: string) => {
    if (s !== value && s.length <= 100 && !/([a-z])\1\1/i.test(s) && !/\ballamein\b/i.test(s)) result.add(s);
  };
  if (value === 'Mohandessin') add('Mohandseen');
  const article = value.match(/^(El|Al)[ -]+(.+)$/i);
  if (article) {
    add(article[2]);
    add('El ' + article[2]);
    add('Al ' + article[2]);
  } else if (includeArticle && /^[A-Za-z]/.test(value) && !descriptive.has(value.split(/[ -]/)[0].toLowerCase())) {
    add('El ' + value);
    add('Al ' + value);
  }
  const wordFamilies = [
    ['Abu', 'Abo'],
    ['Ezbet', 'Ezbit', 'Izbet', 'Izbat'],
    ['Sheikh', 'Shaikh', 'Shikh'],
    ['Sidi', 'Seedy'],
    ['Kafr', 'Kafar'],
  ];
  for (const family of wordFamilies)
    for (const original of family) {
      const pattern = new RegExp(`\\b${original}\\b`, 'gi');
      if (pattern.test(value)) for (const replacement of family) add(value.replace(pattern, replacement));
    }
  for (const family of [
    ['ou', 'u'],
    ['ee', 'i'],
  ]) {
    for (const original of family) {
      // One token at a time prevents a vowel alternation changing every word.
      for (const match of value.matchAll(new RegExp(original, 'gi'))) {
        if (!mutable(match.index)) continue;
        for (const replacement of family) {
          const text =
            match[0][0] === match[0][0].toUpperCase()
              ? replacement[0].toUpperCase() + replacement.slice(1)
              : replacement;
          add(value.slice(0, match.index) + text + value.slice(match.index + original.length));
        }
      }
    }
  }
  for (const match of value.matchAll(/(eya|ia)\b/gi))
    for (const ending of ['eya', 'ia'])
      add(value.slice(0, match.index) + ending + value.slice(match.index + match[0].length));
  for (const match of value.matchAll(/([bcdfghjklmnpqrstvwxyz])\1/gi))
    if (mutable(match.index)) add(value.slice(0, match.index) + match[1] + value.slice(match.index + 2));
  return [...result];
}

export function arabicSpacingAliases(value: string): string[] {
  if (value.startsWith('بورتو')) return [];
  const spaced = value.match(/^(بور|أبو|ابو|عين|كفر|سيدي|سيدى|ميت)\s+(.+)$/u);
  if (spaced) return [spaced[1] + spaced[2]];
  const joined = value.match(/^(بور|أبو|ابو|عين|كفر|سيدي|سيدى|ميت)([\u0621-\u064a].*)$/u);
  // كفرة is a complete word, not كفر followed by a one-letter place name.
  return joined && joined[2].split(/\s/)[0].length > 1 ? [joined[1] + ' ' + joined[2]] : [];
}

export function addReviewedTransliterations(records: CityCatalogRecord[], review: AliasGenerationReview) {
  if (
    !review.reviewed ||
    review.ruleVersion !== TRANSLITERATION_RULE_VERSION ||
    !Number.isInteger(review.maxPerRow) ||
    review.maxPerRow < 1 ||
    review.maxPerRow > 24
  )
    throw new Error('Invalid reviewed transliteration rules');
  const names = new Map<string, Set<string>>();
  for (const row of records) {
    for (const value of [row.nameEnglish, row.nameArabic]) {
      const key = row.governorateCode + ':' + normalizeCitySearch(value);
      const codes = names.get(key) ?? new Set<string>();
      codes.add(row.sourceCode);
      names.set(key, codes);
    }
  }
  let affectedRows = 0,
    generated = 0,
    collisionsExcluded = 0;
  for (const row of records) {
    if (!row.districtSourceCode && !review.districtSourceCodes.includes(row.sourceCode)) continue;
    const aliases = (row.aliases ?? []).filter(
      (a) => !/([a-z])\1\1/i.test(a) && !/\ballamein\b/i.test(a) && !/\bnear\b/i.test(a) && !/قرب/.test(a),
    );
    const seen = new Set([row.nameEnglish, row.nameArabic, ...aliases].map((s) => s.trim().toLowerCase()));
    let added = 0;
    // Curated spellings are seeds, but no candidate feeds back into this generator.
    const seeds = [...new Set([row.nameEnglish, row.sourceNameEnglish])];
    const candidates = [
      ...arabicSpacingAliases(row.nameArabic),
      ...new Set(seeds.flatMap((seed) => englishAliasCandidates(seed, row.nameArabic.startsWith('ال')))),
    ];
    let selected = 0;
    for (const alias of candidates) {
      const key = row.governorateCode + ':' + normalizeCitySearch(alias);
      if ([...(names.get(key) ?? [])].some((code) => code !== row.sourceCode)) {
        collisionsExcluded++;
        continue;
      }
      if ([row.nameEnglish, row.nameArabic].some((name) => name.toLowerCase() === alias.toLowerCase())) continue;
      if (selected >= review.maxPerRow) continue;
      selected++;
      if (seen.has(alias.toLowerCase())) continue;
      aliases.push(alias);
      seen.add(alias.toLowerCase());
      added++;
    }
    row.aliases = aliases;
    if (added) affectedRows++;
    generated += added;
  }
  return {
    affectedRows,
    generated,
    collisionsExcluded,
    averageAliases: records.reduce((n, row) => n + (row.aliases?.length ?? 0), 0) / records.length,
  };
}
