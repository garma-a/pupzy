/* eslint-disable @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-assignment */
import { compareSnapshots, applyReviewedRelease } from './refresh';
import { getOfficialCatalog, validateCatalog, type CitySnapshot, type CityCatalogRecord } from './catalog';

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

  it('handles a full release with additions, removals, retained retired Cities, and a reviewed count different from the first release', () => {
    // Start with the full 351 catalog
    const baseCatalog = getOfficialCatalog();
    expect(baseCatalog.length).toBe(351);

    // Create candidate where:
    // - 2 Cairo cities (e.g. EG0101, EG0102) are removed from upstream -> will become RETIRED
    // - 1 new Cairo city (EG0198) is added in upstream -> will become OFFICIAL
    // -> candidate has 351 - 2 + 1 = 350 official cities across 27 governorates
    const rawRecords = baseCatalog
      .filter((c) => c.sourceCode !== 'EG0101' && c.sourceCode !== 'EG0102')
      .map((c) => ({
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

    // Add new candidate city
    rawRecords.push({
      adm2_name: 'New Administrative District',
      adm2_name1: 'حي إداري جديد',
      adm2_pcode: 'EG0198',
      adm1_name: 'Cairo',
      adm1_name1: 'القاهرة',
      adm1_pcode: 'EG01',
      adm0_name: 'Egypt',
      adm0_name1: 'مصر',
      adm0_pcode: 'EG',
      center_lat: 30.1,
      center_lon: 31.3,
    });

    const candidateSnapshot = createMockSnapshot(rawRecords);
    const release = applyReviewedRelease(baseCatalog, candidateSnapshot, {
      reviewedMetadata: {
        declaredOfficialCount: 350,
        governorateCount: 27,
      },
    });

    // 350 official + 2 retired = 352 total retained catalog entries
    expect(release.officialCount).toBe(350);
    expect(release.retiredCount).toBe(2);
    expect(release.updatedCatalog.length).toBe(352);

    const retired1 = release.updatedCatalog.find((c) => c.sourceCode === 'EG0101');
    const retired2 = release.updatedCatalog.find((c) => c.sourceCode === 'EG0102');
    const addedCity = release.updatedCatalog.find((c) => c.sourceCode === 'EG0198');

    expect(retired1?.status).toBe('RETIRED');
    expect(retired2?.status).toBe('RETIRED');
    expect(addedCity?.status).toBe('OFFICIAL');

    // Validation passes for the new release catalog
    const validation = validateCatalog({
      metadata: release.metadata,
      records: release.updatedCatalog,
    });
    expect(validation.isValid).toBe(true);
    expect(validation.stats.officialCount).toBe(350);
    expect(validation.stats.retiredCount).toBe(2);
    expect(validation.stats.totalCities).toBe(352);
    expect(validation.stats.governorateCount).toBe(27);
  });

  it('never reactivates an already retired city in subsequent upstream release applications', () => {
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
        status: 'RETIRED', // already retired in current catalog
      },
    ];

    // Upstream snapshot re-includes EG0102
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
      {
        adm2_name: 'Retired City',
        adm2_name1: 'مدينة ملغاة',
        adm2_pcode: 'EG0102',
        adm1_name: 'Cairo',
        adm1_name1: 'القاهرة',
        adm1_pcode: 'EG01',
        adm0_name: 'Egypt',
        adm0_name1: 'مصر',
        adm0_pcode: 'EG',
        center_lat: 30.1,
        center_lon: 31.1,
      },
    ];

    const candidateSnapshot = createMockSnapshot(candidateRaw);
    const release = applyReviewedRelease(baseCatalog, candidateSnapshot, {
      reviewedMetadata: {
        declaredOfficialCount: 1,
        governorateCount: 1,
      },
    });

    const retiredEntry = release.updatedCatalog.find((c) => c.sourceCode === 'EG0102');
    expect(retiredEntry?.status).toBe('RETIRED');
    expect(release.officialCount).toBe(1);
    expect(release.retiredCount).toBe(1);
  });
});
