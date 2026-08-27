import {
  transformCatalog,
  validateSnapshot,
  type CitySnapshot,
  type CityCatalogRecord,
  type CityCatalogMetadata,
} from './catalog';
import { compareSnapshots, type SnapshotDiffReport } from './diff';

export interface CityIdentityTransfer {
  retiredCitySourceCode: string;
  replacementCitySourceCode: string;
  notes?: string;
}

export interface LegacyCityLifecycleDecision {
  legacyCitySourceCode: string;
  nextCityLifecycleStatus: 'OFFICIAL' | 'RETIRED';
  notes: string;
}

export interface ReviewedReleaseOptions {
  reviewedMetadata?: {
    declaredOfficialCount?: number;
    governorateCount?: number;
  };
  identityTransfers?: CityIdentityTransfer[];
  legacyLifecycleDecisions?: LegacyCityLifecycleDecision[];
}

export interface ReviewedReleaseResult {
  updatedCatalog: CityCatalogRecord[];
  diffReport: SnapshotDiffReport;
  retiredCount: number;
  officialCount: number;
  legacyCount: number;
  metadata?: CityCatalogMetadata;
  identityTransfers: CityIdentityTransfer[];
  legacyLifecycleDecisions: LegacyCityLifecycleDecision[];
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
 * - Validates that every detected recode has an explicit reviewed City identity transfer.
 * - Enforces bijective (1:1) identity transfers from retired Cities to replacement candidate identities.
 * - Transfers one-to-one recoded City source identities onto existing application UUIDs in release plans.
 * - Removed official cities without identity transfer transition to 'RETIRED' (never deleted, preserving UUIDs and references).
 * - Preserves LEGACY Cities unless an explicit reviewed lifecycle decision applies.
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

  const rawIdentityTransfers = options.identityTransfers ?? [];
  const normalizedIdentityTransfers: CityIdentityTransfer[] = [];
  const replacementByRetiredCityCode = new Map<string, string>();
  const seenRetired = new Set<string>();
  const seenReplacement = new Set<string>();

  // 1. Validate explicit City identity transfers
  for (let i = 0; i < rawIdentityTransfers.length; i++) {
    const transfer = rawIdentityTransfers[i];
    if (!transfer || typeof transfer.retiredCitySourceCode !== 'string' || !transfer.retiredCitySourceCode.trim()) {
      throw new Error(`City identity transfer at index ${i} missing or invalid retiredCitySourceCode`);
    }
    if (typeof transfer.replacementCitySourceCode !== 'string' || !transfer.replacementCitySourceCode.trim()) {
      throw new Error(`City identity transfer at index ${i} missing or invalid replacementCitySourceCode`);
    }

    const retiredCityCode = transfer.retiredCitySourceCode.trim();
    const replacementCityCode = transfer.replacementCitySourceCode.trim();

    if (retiredCityCode === replacementCityCode) {
      throw new Error(`City identity transfer error: cannot transfer City '${retiredCityCode}' to itself`);
    }

    if (seenRetired.has(retiredCityCode)) {
      throw new Error(`Duplicate City identity transfer for retired City '${retiredCityCode}' at index ${i}`);
    }
    seenRetired.add(retiredCityCode);

    if (seenReplacement.has(replacementCityCode)) {
      throw new Error(`Duplicate City identity transfer for replacement City '${replacementCityCode}' at index ${i}`);
    }
    seenReplacement.add(replacementCityCode);

    if (!currentOfficialByCode.has(retiredCityCode)) {
      throw new Error(
        `City identity transfer error: retired City '${retiredCityCode}' is not an active official City in the current catalog`,
      );
    }

    if (candidateByCode.has(retiredCityCode)) {
      throw new Error(
        `City identity transfer error: retired City '${retiredCityCode}' is still an active official City in the candidate release`,
      );
    }

    if (!candidateByCode.has(replacementCityCode)) {
      throw new Error(
        `City identity transfer error: replacement City '${replacementCityCode}' is not an active official City in the candidate release`,
      );
    }

    if (currentAllByCode.has(replacementCityCode)) {
      throw new Error(
        `City identity transfer error: replacement City '${replacementCityCode}' already exists in the current catalog; an identity transfer must target a new upstream source code`,
      );
    }

    normalizedIdentityTransfers.push({
      retiredCitySourceCode: retiredCityCode,
      replacementCitySourceCode: replacementCityCode,
      notes: transfer.notes,
    });
    replacementByRetiredCityCode.set(retiredCityCode, replacementCityCode);
  }

  const legacyCityByCode = new Map<string, CityCatalogRecord>(
    currentCatalog.filter((city) => city.status === 'LEGACY').map((city) => [city.sourceCode, city]),
  );
  const rawLegacyLifecycleDecisions = options.legacyLifecycleDecisions ?? [];
  const normalizedLegacyLifecycleDecisions: LegacyCityLifecycleDecision[] = [];
  const lifecycleDecisionByLegacyCityCode = new Map<string, LegacyCityLifecycleDecision>();

  // 2. Validate explicit reviewed lifecycle decisions for legacy Cities.
  for (let i = 0; i < rawLegacyLifecycleDecisions.length; i++) {
    const decision = rawLegacyLifecycleDecisions[i];
    if (!decision || typeof decision.legacyCitySourceCode !== 'string' || !decision.legacyCitySourceCode.trim()) {
      throw new Error(`Legacy City lifecycle decision at index ${i} missing or invalid legacyCitySourceCode`);
    }
    if (decision.nextCityLifecycleStatus !== 'OFFICIAL' && decision.nextCityLifecycleStatus !== 'RETIRED') {
      throw new Error(`Legacy City lifecycle decision at index ${i} must transition to OFFICIAL or RETIRED`);
    }
    if (typeof decision.notes !== 'string' || !decision.notes.trim()) {
      throw new Error(`Legacy City lifecycle decision at index ${i} requires non-blank review notes`);
    }

    const legacyCityCode = decision.legacyCitySourceCode.trim();
    if (lifecycleDecisionByLegacyCityCode.has(legacyCityCode)) {
      throw new Error(`Duplicate lifecycle decision for legacy City '${legacyCityCode}' at index ${i}`);
    }
    if (!legacyCityByCode.has(legacyCityCode)) {
      throw new Error(`Lifecycle decision error: '${legacyCityCode}' is not a legacy City in the current catalog`);
    }
    if (decision.nextCityLifecycleStatus === 'OFFICIAL' && !candidateByCode.has(legacyCityCode)) {
      throw new Error(
        `Lifecycle decision error: legacy City '${legacyCityCode}' can become OFFICIAL only when the candidate contains its source identity`,
      );
    }

    const normalizedDecision: LegacyCityLifecycleDecision = {
      legacyCitySourceCode: legacyCityCode,
      nextCityLifecycleStatus: decision.nextCityLifecycleStatus,
      notes: decision.notes.trim(),
    };
    normalizedLegacyLifecycleDecisions.push(normalizedDecision);
    lifecycleDecisionByLegacyCityCode.set(legacyCityCode, normalizedDecision);
  }

  // 3. Enforce that every detected recode has an explicit reviewed City identity transfer
  for (const recode of diffReport.recoded) {
    const mappedTarget = replacementByRetiredCityCode.get(recode.oldSourceCode);
    if (!mappedTarget || mappedTarget !== recode.newSourceCode) {
      throw new Error(
        `Unreviewed City recode detected for '${recode.nameEnglish}' in governorate '${recode.governorate}' (${recode.oldSourceCode} -> ${recode.newSourceCode}). An explicit reviewed City identity transfer is required before release generation succeeds.`,
      );
    }
  }

  const currentOfficialCount = currentOfficialByCode.size;
  const currentGovCount = new Set(Array.from(currentOfficialByCode.values()).map((c) => c.governorate)).size;

  const updatedCatalog: CityCatalogRecord[] = [];
  let retiredCount = 0;
  let officialCount = 0;
  let legacyCount = 0;
  const remainingCandidate = new Map(candidateByCode);

  const addOfficialRecord = (cand: CityCatalogRecord, codeToRemove: string) => {
    updatedCatalog.push({
      ...cand,
      status: 'OFFICIAL',
    });
    officialCount++;
    remainingCandidate.delete(codeToRemove);
  };

  const addNonOfficialRecord = (city: CityCatalogRecord, status: 'LEGACY' | 'RETIRED') => {
    updatedCatalog.push({
      ...city,
      status,
    });
    if (status === 'LEGACY') {
      legacyCount++;
    } else {
      retiredCount++;
    }
    remainingCandidate.delete(city.sourceCode);
  };

  // 4. Process existing catalog records
  for (const curr of currentCatalog) {
    if (curr.status === 'LEGACY') {
      const lifecycleDecision = lifecycleDecisionByLegacyCityCode.get(curr.sourceCode);
      if (lifecycleDecision?.nextCityLifecycleStatus === 'OFFICIAL') {
        addOfficialRecord(remainingCandidate.get(curr.sourceCode)!, curr.sourceCode);
      } else {
        addNonOfficialRecord(curr, lifecycleDecision?.nextCityLifecycleStatus ?? 'LEGACY');
      }
      continue;
    }

    if (curr.status === 'RETIRED') {
      // Previously retired city remains retired and cannot be automatically reactivated
      addNonOfficialRecord(curr, 'RETIRED');
      continue;
    }

    // If city has an approved identity transfer, the new candidate record replaces it as OFFICIAL
    if (replacementByRetiredCityCode.has(curr.sourceCode)) {
      const repCode = replacementByRetiredCityCode.get(curr.sourceCode)!;
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
      addNonOfficialRecord(curr, 'RETIRED');
    }
  }

  // 5. Add remaining candidate records (new additions)
  for (const [, cand] of remainingCandidate.entries()) {
    updatedCatalog.push({
      ...cand,
      status: 'OFFICIAL',
    });
    officialCount++;
  }

  const distinctGovCount = new Set(updatedCatalog.filter((c) => c.status === 'OFFICIAL').map((c) => c.governorate))
    .size;

  // 6. Enforce explicit reviewed metadata when official or governorate count changes
  validateCountMetadata(
    'Official',
    currentOfficialCount,
    officialCount,
    options.reviewedMetadata?.declaredOfficialCount,
  );
  validateCountMetadata('Governorate', currentGovCount, distinctGovCount, options.reviewedMetadata?.governorateCount);

  return {
    updatedCatalog,
    diffReport,
    retiredCount,
    officialCount,
    legacyCount,
    identityTransfers: normalizedIdentityTransfers,
    legacyLifecycleDecisions: normalizedLegacyLifecycleDecisions,
    metadata: {
      ...candidateSnapshot.metadata,
      totalCities: updatedCatalog.length,
      declaredOfficialCount: officialCount,
      selectableCount: officialCount,
      officialCitiesCount: officialCount,
      governorateCount: distinctGovCount,
      governoratesCount: distinctGovCount,
      retiredCount,
      legacyCount,
    },
  };
}
