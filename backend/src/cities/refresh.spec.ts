import {
  compareSnapshots,
  applyReviewedRelease,
  type SnapshotDiffReport,
} from './refresh';
import { getOfficialCatalog, transformCatalog, type CitySnapshot, type CityCatalogRecord } from './catalog';

describe('Upstream Refresh and Future Release Diff Tooling', () => {
  const currentCatalog = getOfficialCatalog();

  const createMockSnapshot = (records: any[]): CitySnapshot => ({
    metadata: {
      source: 'OCHA HDX COD-AB Egypt',
      sourceUrl: 'https://data.humdata.org/dataset/cod-ab-egy',
      resourceUrl: 'https://data.humdata.org/dataset/...',
      upstreamVersion: '2026.1.0',
      upstreamDates: {
        validOn: '2026-01-01',
        reviewedDate: '2026-01-02',
        lastModified: '2026-01-03',
      },
      retrievalDate: '2026-08-27',
      license: 'CC-BY-IGO',
      licenseUrl: 'https://creativecommons.org/licenses/by/3.0/igo/',
      attribution: 'UN OCHA Egypt Office',
      totalRows: records.length,
      outsideZemamCount: 0,
      selectableCount: records.length,
      governorateCount: 27,
    },
    records,
  });

  it('detects no diff when candidate snapshot matches current catalog', () => {
    // Convert current catalog back into raw records
    const rawRecords = currentCatalog.map((c) => ({
      adm2_name: c.sourceNameEnglish,
      adm2_name1: c.sourceNameArabic,
      adm2_pcode: c.sourceCode,
      adm1_name: c.governorate,
      adm1_name1: c.governorateArabic || '',
      adm1_pcode: c.governorateCode,
      adm0_name: 'Egypt',
      adm0_name1: 'مصر',
      adm0_pcode: 'EG',
      center_lat: c.latitude,
      center_lon: c.longitude,
    }));

    const candidateSnapshot = createMockSnapshot(rawRecords);
    const diff = compareSnapshots(currentCatalog, candidateSnapshot);

    expect(diff.summary.addedCount).toBe(0);
    expect(diff.summary.removedCount).toBe(0);
    expect(diff.summary.renamedCount).toBe(0);
    expect(diff.summary.coordinateChangedCount).toBe(0);
    expect(diff.summary.recodedCount).toBe(0);
  });

  it('reports added, removed, renamed, recoded, and coordinate-changed areas for human review', () => {
    // Take a small baseline
    const baseCatalog: CityCatalogRecord[] = [
      {
        sourceCode: 'EG0101',
        nameEnglish: 'City A',
        nameArabic: 'مدينة أ',
        governorate: 'Cairo',
        governorateCode: 'EG01',
        sourceNameEnglish: 'City A',
        sourceNameArabic: 'مدينة أ',
        latitude: 30.0,
        longitude: 31.0,
        status: 'OFFICIAL',
      },
      {
        sourceCode: 'EG0102',
        nameEnglish: 'City B',
        nameArabic: 'مدينة ب',
        governorate: 'Cairo',
        governorateCode: 'EG01',
        sourceNameEnglish: 'City B',
        sourceNameArabic: 'مدينة ب',
        latitude: 30.1,
        longitude: 31.1,
        status: 'OFFICIAL',
      },
      {
        sourceCode: 'EG0103',
        nameEnglish: 'City C',
        nameArabic: 'مدينة ج',
        governorate: 'Cairo',
        governorateCode: 'EG01',
        sourceNameEnglish: 'City C',
        sourceNameArabic: 'مدينة ج',
        latitude: 30.2,
        longitude: 31.2,
        status: 'OFFICIAL',
      },
    ];

    // Candidate snapshot has:
    // - City A: renamed to 'City A New'
    // - City B: coordinates changed to (30.5, 31.5)
    // - City C: removed
    // - City D (EG0104): added
    const candidateRaw = [
      {
        adm2_name: 'City A New',
        adm2_name1: 'مدينة أ الجديدة',
        adm2_pcode: 'EG0101',
        adm1_name: 'Cairo',
        adm1_name1: 'القاهرة',
        adm1_pcode: 'EG01',
        adm0_name: 'Egypt',
        adm0_name1: 'مصر',
        adm0_pcode: 'EG',
        center_lat: 30.0,
        center_lon: 31.0,
      },
      {
        adm2_name: 'City B',
        adm2_name1: 'مدينة ب',
        adm2_pcode: 'EG0102',
        adm1_name: 'Cairo',
        adm1_name1: 'القاهرة',
        adm1_pcode: 'EG01',
        adm0_name: 'Egypt',
        adm0_name1: 'مصر',
        adm0_pcode: 'EG',
        center_lat: 30.5,
        center_lon: 31.5,
      },
      {
        adm2_name: 'City D',
        adm2_name1: 'مدينة د',
        adm2_pcode: 'EG0104',
        adm1_name: 'Cairo',
        adm1_name1: 'القاهرة',
        adm1_pcode: 'EG01',
        adm0_name: 'Egypt',
        adm0_name1: 'مصر',
        adm0_pcode: 'EG',
        center_lat: 30.3,
        center_lon: 31.3,
      },
    ];

    const candidateSnapshot = createMockSnapshot(candidateRaw);
    const diff = compareSnapshots(baseCatalog, candidateSnapshot);

    expect(diff.summary.addedCount).toBe(1);
    expect(diff.added[0].sourceCode).toBe('EG0104');

    expect(diff.summary.removedCount).toBe(1);
    expect(diff.removed[0].sourceCode).toBe('EG0103');

    expect(diff.summary.renamedCount).toBe(1);
    expect(diff.renamed[0].sourceCode).toBe('EG0101');
    expect(diff.renamed[0].newNameEnglish).toBe('City A New');

    expect(diff.summary.coordinateChangedCount).toBe(1);
    expect(diff.coordinateChanged[0].sourceCode).toBe('EG0102');
  });

  it('marks removed official cities as RETIRED in subsequent release while preserving their identity', () => {
    const baseCatalog: CityCatalogRecord[] = [
      {
        sourceCode: 'EG0101',
        nameEnglish: 'Active City',
        nameArabic: 'مدينة نشطة',
        governorate: 'Cairo',
        governorateCode: 'EG01',
        sourceNameEnglish: 'Active City',
        sourceNameArabic: 'مدينة نشطة',
        latitude: 30.0,
        longitude: 31.0,
        status: 'OFFICIAL',
      },
      {
        sourceCode: 'EG0102',
        nameEnglish: 'Deprecating City',
        nameArabic: 'مدينة ملغاة',
        governorate: 'Cairo',
        governorateCode: 'EG01',
        sourceNameEnglish: 'Deprecating City',
        sourceNameArabic: 'مدينة ملغاة',
        latitude: 30.1,
        longitude: 31.1,
        status: 'OFFICIAL',
      },
    ];

    const candidateRaw = [
      {
        adm2_name: 'Active City',
        adm2_name1: 'مدينة نشطة',
        adm2_pcode: 'EG0101',
        adm1_name: 'Cairo',
        adm1_name1: 'القاهرة',
        adm1_pcode: 'EG01',
        adm0_name: 'Egypt',
        adm0_name1: 'مصر',
        adm0_pcode: 'EG',
        center_lat: 30.0,
        center_lon: 31.0,
      },
    ];

    const candidateSnapshot = createMockSnapshot(candidateRaw);
    const release = applyReviewedRelease(baseCatalog, candidateSnapshot, {
      reviewedMetadata: {
        declaredOfficialCount: 1,
        governorateCount: 1,
      },
    });

    expect(release.updatedCatalog.length).toBe(2);
    const active = release.updatedCatalog.find((c) => c.sourceCode === 'EG0101');
    const retired = release.updatedCatalog.find((c) => c.sourceCode === 'EG0102');

    expect(active?.status).toBe('OFFICIAL');
    expect(retired?.status).toBe('RETIRED');
  });

  it('validates replacement mappings and rejects invalid retired or replacement references', () => {
    const baseCatalog: CityCatalogRecord[] = [
      {
        sourceCode: 'EG0101',
        nameEnglish: 'Active City',
        nameArabic: 'مدينة نشطة',
        governorate: 'Cairo',
        governorateCode: 'EG01',
        sourceNameEnglish: 'Active City',
        sourceNameArabic: 'مدينة نشطة',
        latitude: 30.0,
        longitude: 31.0,
        status: 'OFFICIAL',
      },
      {
        sourceCode: 'EG0102',
        nameEnglish: 'Retired City',
        nameArabic: 'مدينة ملغاة',
        governorate: 'Cairo',
        governorateCode: 'EG01',
        sourceNameEnglish: 'Retired City',
        sourceNameArabic: 'مدينة ملغاة',
        latitude: 30.1,
        longitude: 31.1,
        status: 'OFFICIAL',
      },
    ];

    const candidateRaw = [
      {
        adm2_name: 'Active City',
        adm2_name1: 'مدينة نشطة',
        adm2_pcode: 'EG0101',
        adm1_name: 'Cairo',
        adm1_name1: 'القاهرة',
        adm1_pcode: 'EG01',
        adm0_name: 'Egypt',
        adm0_name1: 'مصر',
        adm0_pcode: 'EG',
        center_lat: 30.0,
        center_lon: 31.0,
      },
    ];

    const candidateSnapshot = createMockSnapshot(candidateRaw);

    // Valid replacement mapping
    const release = applyReviewedRelease(baseCatalog, candidateSnapshot, {
      replacementMappings: [
        {
          retiredSourceCode: 'EG0102',
          replacementSourceCode: 'EG0101',
          notes: 'Merged into active city',
        },
      ],
    });
    expect(release.retiredCount).toBe(1);

    // Invalid: retiredSourceCode is not retired
    expect(() =>
      applyReviewedRelease(baseCatalog, candidateSnapshot, {
        replacementMappings: [
          {
            retiredSourceCode: 'EG0101', // active, not retired
            replacementSourceCode: 'EG0101',
          },
        ],
      }),
    ).toThrow(/is not a retired city/);

    // Invalid: replacementSourceCode is not an active city
    expect(() =>
      applyReviewedRelease(baseCatalog, candidateSnapshot, {
        replacementMappings: [
          {
            retiredSourceCode: 'EG0102',
            replacementSourceCode: 'EG9999_NONEXISTENT',
          },
        ],
      }),
    ).toThrow(/is not an active official city/);
  });
});
