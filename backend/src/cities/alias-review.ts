import type { CityCatalogRecord } from './catalog';
import { normalizeCitySearch } from './search';

function areaKey(value: string): string {
  return normalizeCitySearch(value.split(/ \(| — /)[0])
    .replace(/^(?:قسم|مركز|حي)\s+/, '')
    .replace(/\b(?:bahary|bahri|qebly|qibli|qebly|north|south)\b/gi, '')
    .replace(/(?:بحري|قبلي)$/, '')
    .trim()
    .replace(/(?:eya|iya|iyya)$/, 'ia')
    .replace(/\s+/g, '');
}

export function rejectedAliasReason(alias: string): string | undefined {
  if (/[,،]/.test(alias)) return 'comma-joined';
  if ([...alias.normalize('NFC')].some((letter) => /\p{Script=Latin}/u.test(letter) && letter.charCodeAt(0) > 127))
    return 'non-ASCII Latin';
  if (/شياخ[ةه]|و?\s*تشمل|\bincludes\b/i.test(alias)) return 'administrative composite';
  return undefined;
}

/** Applies after source merges and alias generation, so discarded labels cannot return. */
export function reviewCityAliases(rows: CityCatalogRecord[]) {
  const canonical = new Map<string, Set<string>>();
  for (const row of rows)
    for (const value of [row.nameEnglish, row.nameArabic]) {
      const key = row.governorateCode + ':' + areaKey(value);
      const owners = canonical.get(key) ?? new Set<string>();
      owners.add(row.sourceCode);
      canonical.set(key, owners);
    }
  const removals: Array<{ sourceCode: string; alias: string; reason: string }> = [];
  for (const row of rows) {
    const own = new Set([row.nameEnglish, row.nameArabic, row.sourceNameEnglish, row.sourceNameArabic].map(areaKey));
    row.aliases = (row.aliases ?? []).filter((alias) => {
      let reason = rejectedAliasReason(alias);
      if (!reason && !row.districtSourceCode && /\band\b|\sو\s/i.test(alias)) reason = 'administrative composite';
      if (!reason && !row.districtSourceCode) {
        const parts = [alias, ...alias.split(/\band\b|&|\sو\s/i)];
        if (
          parts.some((part) => {
            const key = areaKey(part);
            return (
              !own.has(key) &&
              [...(canonical.get(row.governorateCode + ':' + key) ?? [])].some((code) => code !== row.sourceCode)
            );
          })
        )
          reason = 'different City';
      }
      if (reason) removals.push({ sourceCode: row.sourceCode, alias, reason });
      return !reason;
    });
  }
  return removals;
}
