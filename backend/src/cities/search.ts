import type { CityCatalogRecord } from './catalog';

/** Mirrors the mobile picker contract, including the order of article removal. */
export function normalizeCitySearch(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/[\u0610-\u061a\u064b-\u065f\u0670\u06d6-\u06ed\u0640]/g, '')
    .replace(/[أإآٱ]/g, 'ا')
    .replace(/ة/g, 'ه')
    .replace(/[ىئ]/g, 'ي')
    .replace(/ؤ/g, 'و')
    .replace(/^(?:el|al)[ -]+/, '')
    .replace(/[-'’]/g, '')
    .replace(/\s+/g, ' ')
    .replace(/^ال/, '')
    .trim();
}

export function matchesCitySearch(query: string, city: CityCatalogRecord, district?: CityCatalogRecord): boolean {
  const needle = normalizeCitySearch(query);
  return (
    needle.length > 0 &&
    [
      city.nameEnglish,
      city.nameArabic,
      city.governorate,
      city.governorateArabic ?? '',
      ...(city.aliases ?? []),
      district?.nameEnglish ?? '',
      district?.nameArabic ?? '',
    ].some((value) => normalizeCitySearch(value).includes(needle))
  );
}
