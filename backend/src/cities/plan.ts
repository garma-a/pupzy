import {
  transformCatalog,
  validateSnapshot,
  type CitySnapshot,
  type CityCatalogRecord,
  type CityCatalogMetadata,
} from './catalog';
import { compareSnapshots, type SnapshotDiffReport } from './diff';

export interface ReplacementMapping {
  retiredSourceCode: string;
  replacementSourceCode: string;
  notes?: string;
}

export interface ReviewedReleaseOptions {
  reviewedMetadata?: {
    declaredOfficialCount?: number;
    governorateCount?: number;
  };
  replacementMappings?: ReplacementMapping[];
}

export interface ReviewedReleaseResult {
  updatedCatalog: CityCatalogRecord[];
  diffReport: SnapshotDiffReport;
  retiredCount: number;
  officialCount: number;
  metadata?: CityCatalogMetadata;
  replacementMappings: ReplacementMapping[];
}

function validateCountMetadata(
  label: 'Official' | 'Governorate',
  currentCount: number,
  actualCount: number,
  declaredCount?: number,
): void {
  if (actualCount !== currentCount) {
    if (declaredCount === undefined) {
      throw new Error(
        `${label} count changed from ${currentCount} to ${actualCount}; explicit reviewedMetadata.${label === 'Official' ? 'declaredOfficialCount' : 'governorateCount'} matching candidate is required.`,
      );
    }
  }
  if (declaredCount !== undefined && declaredCount !== actualCount) {
    throw new Error(`Declared ${label.toLowerCase()} count mismatch: expected ${declaredCount}, got ${actualCount}`);
  }
}

/**
 * Applies a reviewed upstream release to the catalog:
 * - Validates that every detected recode has an explicit reviewed replacement mapping.
 * - Enforces bijective (1:1) mappings between retired and active official candidate identities.
 * - Transfers one-to-one recoded source identities onto existing application UUIDs in release plans.
 * - Removed official cities without identity transfer transition to 'RETIRED' (never deleted, preserving UUIDs and references).
 * - Added official cities are included with 'OFFICIAL' status.
 * - Updated official cities have names/coordinates updated.
 * - Enforces metadata confirmation for count changes.
 */
export function applyReviewedRelease(
  currentCatalog: CityCatalogRecord[],
  candidateSnapshot: CitySnapshot,
  options: ReviewedReleaseOptions = {},
): ReviewedReleaseResult {
  const snapshotVal = validateSnapshot(candidateSnapshot);
  if (!snapshotVal.isValid) {
    throw new Error(`Candidate snapshot failed schema/provenance validation:\n- ${snapshotVal.errors.join('\n- ')}`);
  }

  const diffReport = compareSnapshots(currentCatalog, candidateSnapshot);
  const candidateTransformed = transformCatalog(candidateSnapshot);
  const candidateRecords = candidateTransformed.records;

  const currentOfficialByCode = new Map<string, CityCatalogRecord>(
    currentCatalog.filter((c) => c.status === 'OFFICIAL' || !c.status).map((c) => [c.sourceCode, c]),
  );
  const currentAllByCode = new Map<string, CityCatalogRecord>(currentCatalog.map((c) => [c.sourceCode, c]));
  const candidateByCode = new Map<string, CityCatalogRecord>(candidateRecords.map((c) => [c.sourceCode, c]));

  const rawMappings = options.replacementMappings ?? [];
  const normalizedMappings: ReplacementMapping[] = [];
  const replacementMap = new Map<string, string>(); // retiredCode -> replacementCode
  const seenRetired = new Set<string>();
  const seenReplacement = new Set<string>();

  // 1. Validate explicit replacement mappings
  for (let i = 0; i < rawMappings.length; i++) {
    const mapping = rawMappings[i];
    if (!mapping || typeof mapping.retiredSourceCode !== 'string' || !mapping.retiredSourceCode.trim()) {
      throw new Error(`Replacement mapping at index ${i} missing or invalid retiredSourceCode`);
    }
    if (typeof mapping.replacementSourceCode !== 'string' || !mapping.replacementSourceCode.trim()) {
      throw new Error(`Replacement mapping at index ${i} missing or invalid replacementSourceCode`);
    }

    const retCode = mapping.retiredSourceCode.trim();
    const repCode = mapping.replacementSourceCode.trim();

    if (retCode === repCode) {
      throw new Error(`Replacement mapping error: cannot map city '${retCode}' to itself`);
    }

    if (seenRetired.has(retCode)) {
      throw new Error(`Duplicate replacement mapping for retired city '${retCode}' at index ${i}`);
    }
    seenRetired.add(retCode);

    if (seenReplacement.has(repCode)) {
      throw new Error(`Duplicate replacement mapping for replacement city '${repCode}' at index ${i}`);
    }
    seenReplacement.add(repCode);

    if (!currentOfficialByCode.has(retCode)) {
      throw new Error(`Replacement mapping error: '${retCode}' is not an active official city in the current catalog`);
    }

    if (candidateByCode.has(retCode)) {
      throw new Error(
        `Replacement mapping error: '${retCode}' is still an active official city in the candidate release`,
      );
    }

    if (!candidateByCode.has(repCode)) {
      throw new Error(`Replacement mapping error: '${repCode}' is not an active official city in the candidate release`);
    }

    if (currentAllByCode.has(repCode)) {
      throw new Error(
        `Replacement mapping error: target '${repCode}' already exists in the current catalog; identity transfer must target a new upstream source code`,
      );
    }

    normalizedMappings.push({
      retiredSourceCode: retCode,
      replacementSourceCode: repCode,
      notes: mapping.notes,
    });
    replacementMap.set(retCode, repCode);
  }

  // 2. Enforce that every detected recode has an explicit reviewed mapping
  for (const recode of diffReport.recoded) {
    const mappedTarget = replacementMap.get(recode.oldSourceCode);
    if (!mappedTarget || mappedTarget !== recode.newSourceCode) {
      throw new Error(
        `Unreviewed recode detected for '${recode.nameEnglish}' in governorate '${recode.governorate}' (${recode.oldSourceCode} -> ${recode.newSourceCode}). An explicit reviewed replacement mapping is required before release generation succeeds.`,
      );
    }
  }

  const currentOfficialCount = currentOfficialByCode.size;
  const currentGovCount = new Set(Array.from(currentOfficialByCode.values()).map((c) => c.governorate)).size;

  const updatedCatalog: CityCatalogRecord[] = [];
  let retiredCount = 0;
  let officialCount = 0;
  const remainingCandidate = new Map(candidateByCode);

  const addOfficialRecord = (cand: CityCatalogRecord, codeToRemove: string) => {
    updatedCatalog.push({
      ...cand,
      status: 'OFFICIAL',
    });
    officialCount++;
    remainingCandidate.delete(codeToRemove);
  };

  // 3. Process existing catalog records
  for (const curr of currentCatalog) {
    if (curr.status === 'RETIRED') {
      // Previously retired city remains retired and cannot be automatically reactivated
      updatedCatalog.push({
        ...curr,
        status: 'RETIRED',
      });
      retiredCount++;
      remainingCandidate.delete(curr.sourceCode);
      continue;
    }

    // If city has an approved identity transfer, the new candidate record replaces it as OFFICIAL
    if (replacementMap.has(curr.sourceCode)) {
      const repCode = replacementMap.get(curr.sourceCode)!;
      const cand = remainingCandidate.get(repCode);
      if (cand) {
        addOfficialRecord(cand, repCode);
      }
      continue;
    }

    // Retain or update active official record
    const cand = remainingCandidate.get(curr.sourceCode);
    if (cand) {
      addOfficialRecord(cand, curr.sourceCode);
    } else {
      // Removed from upstream without approved identity transfer -> mark as RETIRED
      updatedCatalog.push({
        ...curr,
        status: 'RETIRED',
      });
      retiredCount++;
    }
  }

  // 4. Add remaining candidate records (new additions)
  for (const [, cand] of remainingCandidate.entries()) {
    updatedCatalog.push({
      ...cand,
      status: 'OFFICIAL',
    });
    officialCount++;
  }

  const distinctGovCount = new Set(updatedCatalog.filter((c) => c.status === 'OFFICIAL').map((c) => c.governorate))
    .size;

  // 5. Enforce explicit reviewed metadata when official or governorate count changes
  validateCountMetadata('Official', currentOfficialCount, officialCount, options.reviewedMetadata?.declaredOfficialCount);
  validateCountMetadata('Governorate', currentGovCount, distinctGovCount, options.reviewedMetadata?.governorateCount);

  return {
    updatedCatalog,
    diffReport,
    retiredCount,
    officialCount,
    replacementMappings: normalizedMappings,
    metadata: {
      ...candidateSnapshot.metadata,
      totalCities: updatedCatalog.length,
      declaredOfficialCount: officialCount,
      selectableCount: officialCount,
      officialCitiesCount: officialCount,
      governorateCount: distinctGovCount,
      governoratesCount: distinctGovCount,
      retiredCount,
    },
  };
}
