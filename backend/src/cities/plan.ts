import {
  transformCatalog,
  validateSnapshot,
  type CitySnapshot,
  type CityCatalogRecord,
  type CityCatalogMetadata,
} from './catalog';
import { compareSnapshots, type SnapshotDiffReport } from './diff';

export interface ReviewedReleaseOptions {
  reviewedMetadata?: {
    declaredOfficialCount?: number;
    governorateCount?: number;
  };
  replacementMappings?: Array<{
    retiredSourceCode: string;
    replacementSourceCode: string;
    notes?: string;
  }>;
}

export interface ReviewedReleaseResult {
  updatedCatalog: CityCatalogRecord[];
  diffReport: SnapshotDiffReport;
  retiredCount: number;
  officialCount: number;
  metadata?: CityCatalogMetadata;
}

/**
 * Applies a reviewed upstream release to the catalog:
 * - Removed official cities transition to 'RETIRED' (never deleted, preserving UUIDs and references).
 * - Added official cities are included with 'OFFICIAL' status.
 * - Updated official cities have names/coordinates updated.
 * - Enforces metadata confirmation for count changes.
 * - Validates one-to-one replacement mappings against retired and active official identities.
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

  const candidateByCode = new Map<string, CityCatalogRecord>(
    candidateTransformed.records.map((c) => [c.sourceCode, c]),
  );

  const currentOfficialCount = currentCatalog.filter((c) => c.status === 'OFFICIAL' || !c.status).length;
  const currentGovCount = new Set(
    currentCatalog.filter((c) => c.status === 'OFFICIAL' || !c.status).map((c) => c.governorate),
  ).size;

  const updatedCatalog: CityCatalogRecord[] = [];
  let retiredCount = 0;
  let officialCount = 0;

  // Process existing catalog items
  for (const curr of currentCatalog) {
    if (curr.status === 'RETIRED') {
      // Previously retired city remains retired and cannot be automatically reactivated
      updatedCatalog.push({
        ...curr,
        status: 'RETIRED',
      });
      retiredCount++;
      candidateByCode.delete(curr.sourceCode);
      continue;
    }

    const cand = candidateByCode.get(curr.sourceCode);
    if (cand) {
      // Retain or update official record
      updatedCatalog.push({
        ...cand,
        status: 'OFFICIAL',
      });
      officialCount++;
      candidateByCode.delete(curr.sourceCode);
    } else {
      // Removed from upstream -> mark as RETIRED
      updatedCatalog.push({
        ...curr,
        status: 'RETIRED',
      });
      retiredCount++;
    }
  }

  // Add remaining candidate records (new additions)
  for (const [, cand] of candidateByCode.entries()) {
    updatedCatalog.push({
      ...cand,
      status: 'OFFICIAL',
    });
    officialCount++;
  }

  const distinctGovCount = new Set(updatedCatalog.filter((c) => c.status === 'OFFICIAL').map((c) => c.governorate))
    .size;

  // Enforce explicit reviewed metadata when official count changes
  if (officialCount !== currentOfficialCount) {
    if (options.reviewedMetadata?.declaredOfficialCount === undefined) {
      throw new Error(
        `Official count changed from ${currentOfficialCount} to ${officialCount}; explicit reviewedMetadata.declaredOfficialCount matching candidate is required.`,
      );
    }
    if (options.reviewedMetadata.declaredOfficialCount !== officialCount) {
      throw new Error(
        `Declared official count mismatch: expected ${options.reviewedMetadata.declaredOfficialCount}, got ${officialCount}`,
      );
    }
  } else if (options.reviewedMetadata?.declaredOfficialCount !== undefined) {
    if (options.reviewedMetadata.declaredOfficialCount !== officialCount) {
      throw new Error(
        `Declared official count mismatch: expected ${options.reviewedMetadata.declaredOfficialCount}, got ${officialCount}`,
      );
    }
  }

  // Enforce explicit reviewed metadata when governorate count changes
  if (distinctGovCount !== currentGovCount) {
    if (options.reviewedMetadata?.governorateCount === undefined) {
      throw new Error(
        `Governorate count changed from ${currentGovCount} to ${distinctGovCount}; explicit reviewedMetadata.governorateCount matching candidate is required.`,
      );
    }
    if (options.reviewedMetadata.governorateCount !== distinctGovCount) {
      throw new Error(
        `Declared governorate count mismatch: expected ${options.reviewedMetadata.governorateCount}, got ${distinctGovCount}`,
      );
    }
  } else if (options.reviewedMetadata?.governorateCount !== undefined) {
    if (options.reviewedMetadata.governorateCount !== distinctGovCount) {
      throw new Error(
        `Declared governorate count mismatch: expected ${options.reviewedMetadata.governorateCount}, got ${distinctGovCount}`,
      );
    }
  }

  // Validate replacement mappings if provided
  if (options.replacementMappings && options.replacementMappings.length > 0) {
    const activeCodes = new Set(updatedCatalog.filter((c) => c.status === 'OFFICIAL').map((c) => c.sourceCode));
    const retiredCodes = new Set(updatedCatalog.filter((c) => c.status === 'RETIRED').map((c) => c.sourceCode));
    const seenRetired = new Set<string>();

    for (let i = 0; i < options.replacementMappings.length; i++) {
      const mapping = options.replacementMappings[i];
      if (!mapping.retiredSourceCode || typeof mapping.retiredSourceCode !== 'string') {
        throw new Error(`Replacement mapping at index ${i} missing retiredSourceCode`);
      }
      if (!mapping.replacementSourceCode || typeof mapping.replacementSourceCode !== 'string') {
        throw new Error(`Replacement mapping at index ${i} missing replacementSourceCode`);
      }
      const retCode = mapping.retiredSourceCode.trim();
      const repCode = mapping.replacementSourceCode.trim();

      if (seenRetired.has(retCode)) {
        throw new Error(`Duplicate replacement mapping for retired city '${retCode}' at index ${i}`);
      }
      seenRetired.add(retCode);

      if (!retiredCodes.has(retCode)) {
        throw new Error(`Replacement mapping error: '${retCode}' is not a retired city in the updated release`);
      }
      if (!activeCodes.has(repCode)) {
        throw new Error(
          `Replacement mapping error: '${repCode}' is not an active official city in the updated release`,
        );
      }
    }
  }

  return {
    updatedCatalog,
    diffReport,
    retiredCount,
    officialCount,
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
