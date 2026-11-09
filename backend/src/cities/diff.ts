import { transformCatalog, validateSnapshot, type CitySnapshot, type CityCatalogRecord } from './catalog';

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
  metadataChanged?: string[];
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

export function calculateDistanceKm(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const R = 6371; // Earth radius in km
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLon = ((lon2 - lon1) * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos((lat1 * Math.PI) / 180) * Math.cos((lat2 * Math.PI) / 180) * Math.sin(dLon / 2) * Math.sin(dLon / 2);
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
  const snapshotVal = validateSnapshot(candidateSnapshot);
  if (!snapshotVal.isValid) {
    throw new Error(`Candidate snapshot failed schema/provenance validation:\n- ${snapshotVal.errors.join('\n- ')}`);
  }

  const candidateTransformed = transformCatalog(candidateSnapshot);
  const candidateRecords = candidateTransformed.records;

  const currentByCode = new Map<string, CityCatalogRecord>(currentCatalog.map((c) => [c.sourceCode, c]));
  const candidateByCode = new Map<string, CityCatalogRecord>(candidateRecords.map((c) => [c.sourceCode, c]));

  const metadataChanged: string[] = [];
  const added: CityCatalogRecord[] = [];
  const removed: CityCatalogRecord[] = [];
  const renamed: RenamedAreaDiff[] = [];
  const recoded: RecodedAreaDiff[] = [];
  const coordinateChanged: CoordinateChangedAreaDiff[] = [];

  // Detect Added and Modified
  for (const cand of candidateRecords) {
    const curr = currentByCode.get(cand.sourceCode);
    if (!curr) {
      // Display cleanup must not hide recodes of a retained upstream name or alias.
      // A recode replaces an absent identity of the same kind, not a still-present district.
      const candidateNames = new Set(
        [cand.nameEnglish, cand.sourceNameEnglish].map((name) => name.trim().toLowerCase()),
      );
      const eligible = currentCatalog.filter(
        (c) =>
          (c.status === 'OFFICIAL' || !c.status) &&
          !candidateByCode.has(c.sourceCode) &&
          !!c.districtSourceCode === !!cand.districtSourceCode &&
          c.governorate.toLowerCase() === cand.governorate.toLowerCase(),
      );
      // Canonical Kism/Markaz disambiguation takes precedence over shared source names.
      const canonicalMatches = eligible.filter(
        (c) => c.nameEnglish.trim().toLowerCase() === cand.nameEnglish.trim().toLowerCase(),
      );
      const matchedByName =
        canonicalMatches.length > 0
          ? canonicalMatches
          : eligible.filter((c) =>
              [c.nameEnglish, c.sourceNameEnglish, ...(c.aliases ?? [])].some((name) =>
                candidateNames.has(name.trim().toLowerCase()),
              ),
            );
      if (matchedByName.length > 0) {
        for (const matched of matchedByName) {
          recoded.push({
            oldSourceCode: matched.sourceCode,
            newSourceCode: cand.sourceCode,
            nameEnglish: cand.nameEnglish,
            governorate: cand.governorate,
          });
        }
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

      if (
        JSON.stringify(curr.aliases ?? []) !== JSON.stringify(cand.aliases ?? []) ||
        (curr.districtSourceCode ?? null) !== (cand.districtSourceCode ?? null) ||
        JSON.stringify(curr.provenance) !== JSON.stringify(cand.provenance)
      )
        metadataChanged.push(cand.sourceCode);
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
          distanceKm: calculateDistanceKm(curr.latitude, curr.longitude, cand.latitude, cand.longitude),
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
    metadataChanged,
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
