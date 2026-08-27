import * as fs from 'fs';
import * as path from 'path';
import {
  transformCatalog,
  type CitySnapshot,
  type CityCatalogRecord,
} from './catalog';

export interface RenamedAreaDiff {
  sourceCode: string;
  governorate: string;
  oldNameEnglish: string;
  newNameEnglish: string;
  oldNameArabic: string;
  newNameArabic: string;
}

export interface RecodedAreaDiff {
  oldSourceCode: string;
  newSourceCode: string;
  nameEnglish: string;
  governorate: string;
}

export interface CoordinateChangedAreaDiff {
  sourceCode: string;
  nameEnglish: string;
  governorate: string;
  oldCoordinates: [number, number];
  newCoordinates: [number, number];
  distanceKm: number;
}

export interface SnapshotDiffReport {
  added: CityCatalogRecord[];
  removed: CityCatalogRecord[];
  renamed: RenamedAreaDiff[];
  recoded: RecodedAreaDiff[];
  coordinateChanged: CoordinateChangedAreaDiff[];
  summary: {
    totalCurrent: number;
    totalCandidate: number;
    addedCount: number;
    removedCount: number;
    renamedCount: number;
    recodedCount: number;
    coordinateChangedCount: number;
  };
}

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
}

function calculateDistanceKm(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const R = 6371; // Earth radius in km
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLon = ((lon2 - lon1) * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos((lat1 * Math.PI) / 180) *
      Math.cos((lat2 * Math.PI) / 180) *
      Math.sin(dLon / 2) *
      Math.sin(dLon / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return Math.round(R * c * 100) / 100;
}

/**
 * Compares a candidate upstream snapshot against the current catalog
 * and returns a detailed diff report classifying added, removed, renamed,
 * recoded, and coordinate-changed areas for human review.
 */
export function compareSnapshots(
  currentCatalog: CityCatalogRecord[],
  candidateSnapshot: CitySnapshot,
): SnapshotDiffReport {
  const candidateTransformed = transformCatalog(candidateSnapshot);
  const candidateRecords = candidateTransformed.records;

  const currentByCode = new Map<string, CityCatalogRecord>(
    currentCatalog.map((c) => [c.sourceCode, c]),
  );
  const candidateByCode = new Map<string, CityCatalogRecord>(
    candidateRecords.map((c) => [c.sourceCode, c]),
  );

  const added: CityCatalogRecord[] = [];
  const removed: CityCatalogRecord[] = [];
  const renamed: RenamedAreaDiff[] = [];
  const recoded: RecodedAreaDiff[] = [];
  const coordinateChanged: CoordinateChangedAreaDiff[] = [];

  // Detect Added and Modified
  for (const cand of candidateRecords) {
    const curr = currentByCode.get(cand.sourceCode);
    if (!curr) {
      // Check if this was a recode of an existing city with same name and governorate
      const matchedByName = currentCatalog.find(
        (c) =>
          c.governorate.toLowerCase() === cand.governorate.toLowerCase() &&
          c.nameEnglish.toLowerCase() === cand.nameEnglish.toLowerCase(),
      );
      if (matchedByName) {
        recoded.push({
          oldSourceCode: matchedByName.sourceCode,
          newSourceCode: cand.sourceCode,
          nameEnglish: cand.nameEnglish,
          governorate: cand.governorate,
        });
      } else {
        added.push(cand);
      }
    } else {
      // Check for rename
      const nameChanged =
        curr.nameEnglish !== cand.nameEnglish ||
        curr.nameArabic !== cand.nameArabic ||
        curr.sourceNameEnglish !== cand.sourceNameEnglish ||
        curr.sourceNameArabic !== cand.sourceNameArabic;

      if (nameChanged) {
        renamed.push({
          sourceCode: cand.sourceCode,
          governorate: cand.governorate,
          oldNameEnglish: curr.nameEnglish,
          newNameEnglish: cand.nameEnglish,
          oldNameArabic: curr.nameArabic,
          newNameArabic: cand.nameArabic,
        });
      }

      // Check for coordinate change (> 100 meters / ~0.001 deg)
      const latDiff = Math.abs(curr.latitude - cand.latitude);
      const lonDiff = Math.abs(curr.longitude - cand.longitude);
      if (latDiff > 0.0001 || lonDiff > 0.0001) {
        coordinateChanged.push({
          sourceCode: cand.sourceCode,
          nameEnglish: cand.nameEnglish,
          governorate: cand.governorate,
          oldCoordinates: [curr.latitude, curr.longitude],
          newCoordinates: [cand.latitude, cand.longitude],
          distanceKm: calculateDistanceKm(
            curr.latitude,
            curr.longitude,
            cand.latitude,
            cand.longitude,
          ),
        });
      }
    }
  }

  // Detect Removed
  for (const curr of currentCatalog) {
    if (curr.status === 'OFFICIAL' && !candidateByCode.has(curr.sourceCode)) {
      const isRecoded = recoded.some((r) => r.oldSourceCode === curr.sourceCode);
      if (!isRecoded) {
        removed.push(curr);
      }
    }
  }

  return {
    added,
    removed,
    renamed,
    recoded,
    coordinateChanged,
    summary: {
      totalCurrent: currentCatalog.length,
      totalCandidate: candidateRecords.length,
      addedCount: added.length,
      removedCount: removed.length,
      renamedCount: renamed.length,
      recodedCount: recoded.length,
      coordinateChangedCount: coordinateChanged.length,
    },
  };
}

/**
 * Applies a reviewed upstream release to the catalog:
 * - Removed official cities transition to 'RETIRED' (never deleted, preserving UUIDs and references).
 * - Added official cities are included with 'OFFICIAL' status.
 * - Updated official cities have names/coordinates updated.
 * - Enforces metadata confirmation for count changes.
 */
export function applyReviewedRelease(
  currentCatalog: CityCatalogRecord[],
  candidateSnapshot: CitySnapshot,
  options: ReviewedReleaseOptions = {},
): ReviewedReleaseResult {
  const diffReport = compareSnapshots(currentCatalog, candidateSnapshot);
  const candidateTransformed = transformCatalog(candidateSnapshot);

  const candidateByCode = new Map<string, CityCatalogRecord>(
    candidateTransformed.records.map((c) => [c.sourceCode, c]),
  );

  const updatedCatalog: CityCatalogRecord[] = [];
  let retiredCount = 0;
  let officialCount = 0;

  // Process existing catalog items
  for (const curr of currentCatalog) {
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

  // Verify against declared metadata if provided
  if (options.reviewedMetadata?.declaredOfficialCount !== undefined) {
    if (officialCount !== options.reviewedMetadata.declaredOfficialCount) {
      throw new Error(
        `Declared official count mismatch: expected ${options.reviewedMetadata.declaredOfficialCount}, got ${officialCount}`,
      );
    }
  }

  const distinctGovCount = new Set(
    updatedCatalog.filter((c) => c.status === 'OFFICIAL').map((c) => c.governorate),
  ).size;

  if (options.reviewedMetadata?.governorateCount !== undefined) {
    if (distinctGovCount !== options.reviewedMetadata.governorateCount) {
      throw new Error(
        `Declared governorate count mismatch: expected ${options.reviewedMetadata.governorateCount}, got ${distinctGovCount}`,
      );
    }
  }

  // Validate replacement mappings if provided
  if (options.replacementMappings && options.replacementMappings.length > 0) {
    const activeCodes = new Set(
      updatedCatalog.filter((c) => c.status === 'OFFICIAL').map((c) => c.sourceCode),
    );
    const retiredCodes = new Set(
      updatedCatalog.filter((c) => c.status === 'RETIRED').map((c) => c.sourceCode),
    );

    for (const mapping of options.replacementMappings) {
      if (!retiredCodes.has(mapping.retiredSourceCode)) {
        throw new Error(
          `Replacement mapping error: '${mapping.retiredSourceCode}' is not a retired city`,
        );
      }
      if (!activeCodes.has(mapping.replacementSourceCode)) {
        throw new Error(
          `Replacement mapping error: '${mapping.replacementSourceCode}' is not an active official city`,
        );
      }
    }
  }

  return {
    updatedCatalog,
    diffReport,
    retiredCount,
    officialCount,
  };
}

/**
 * Fetches a candidate upstream snapshot from a remote URL.
 * Developer-only tool — application runtime and migrations remain completely offline.
 */
export async function fetchUpstreamSnapshot(
  url = 'https://data.humdata.org/dataset/cod-ab-egy',
): Promise<CitySnapshot> {
  const res = await fetch(url, {
    headers: {
      'User-Agent': 'Pupzy-Refresher/1.0',
      Accept: 'application/json',
    },
  });

  if (!res.ok) {
    throw new Error(`Failed to fetch upstream snapshot: ${res.status} ${res.statusText}`);
  }

  return (await res.json()) as CitySnapshot;
}
