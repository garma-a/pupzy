/* eslint-disable @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-assignment */
import * as fs from 'fs';
import * as path from 'path';
import {
  compareSnapshots,
  applyReviewedRelease,
  fetchUpstreamSnapshot,
  generateReleaseMigrationSql,
  getNextMigrationMeta,
  publishReviewedRelease,
  DEFAULT_RESOURCE_URL,
} from './refresh';
import {
  getOfficialCatalog,
  validateSnapshot,
  loadRawSnapshot,
  type CitySnapshot,
  type CityCatalogRecord,
} from './catalog';
import { DEFAULT_METADATA_URL } from './fetch';

describe('Upstream Refresh and Future Release Diff Tooling', () => {
  const currentCatalog = getOfficialCatalog();

  const createMockSnapshot = (
    records: any[],
    options: { upstreamVersion?: string; lastModified?: string } = {},
  ): CitySnapshot => ({
    metadata: {
      source: 'OCHA HDX COD-AB Egypt',
      sourceUrl: 'https://data.humdata.org/dataset/cod-ab-egy',
      resourceUrl:
        'https://data.humdata.org/dataset/b90d81ba-7c7a-4283-9899-827480d80a79/resource/81126a96-2991-48e1-93cb-24c164a4de88/download/ocha-adm2-egypt-snapshot.json',
      upstreamVersion: options.upstreamVersion ?? '2026.1.0',
      upstreamDates: {
        validOn: '2026-01-01',
        reviewedDate: '2026-01-02',
        lastModified: options.lastModified ?? '2026-01-03',
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

  describe('Snapshot Schema and Provenance Validation', () => {
    it('validates the committed raw snapshot against schema and required provenance metadata', () => {
      const raw = loadRawSnapshot();
      const result = validateSnapshot(raw);

      expect(result.isValid).toBe(true);
      expect(result.errors).toHaveLength(0);
      expect(result.stats.totalCities).toBe(365);
    });

    it('rejects candidate snapshots missing required provenance fields, invalid URLs, or dates', () => {
      const invalidSnapshot: any = {
        metadata: {
          source: '',
          sourceUrl: 'not-a-url',
          resourceUrl: 'not-a-url',
          upstreamVersion: '',
          upstreamDates: {},
          retrievalDate: '',
          license: '',
          licenseUrl: '',
          attribution: '',
          totalRows: 0,
        },
        records: [],
      };

      const result = validateSnapshot(invalidSnapshot);
      expect(result.isValid).toBe(false);
      expect(result.errors.some((e) => e.includes('sourceUrl'))).toBe(true);
      expect(result.errors.some((e) => e.includes('resourceUrl'))).toBe(true);
      expect(result.errors.some((e) => e.includes('upstreamDates'))).toBe(true);
      expect(result.errors.some((e) => e.includes('totalRows'))).toBe(true);
      expect(result.errors.some((e) => e.includes('records array cannot be empty'))).toBe(true);
    });

    it('rejects snapshots with record-level defects like duplicate P-codes or invalid coordinates', () => {
      const snapshot = createMockSnapshot([
        {
          adm2_name: 'City A',
          adm2_name1: 'مدينة أ',
          adm2_pcode: 'EG0101',
          adm1_name: 'Cairo',
          adm1_pcode: 'EG01',
          center_lat: 95.0, // Out of bounds
          center_lon: 31.0,
        },
        {
          adm2_name: 'City B',
          adm2_name1: 'مدينة ب',
          adm2_pcode: 'EG0101', // Duplicate P-code
          adm1_name: 'Cairo',
          adm1_pcode: 'EG01',
          center_lat: 30.0,
          center_lon: 200.0, // Out of bounds
        },
      ]);

      const result = validateSnapshot(snapshot);
      expect(result.isValid).toBe(false);
      expect(result.errors.some((e) => e.includes("Duplicate adm2_pcode 'EG0101'"))).toBe(true);
      expect(result.errors.some((e) => e.includes('Invalid center_lat'))).toBe(true);
      expect(result.errors.some((e) => e.includes('Invalid center_lon'))).toBe(true);
    });
  });

  describe('Fetch Mode Behavior', () => {
    it('uses the direct resource URL by default rather than a dataset landing page', () => {
      expect(DEFAULT_RESOURCE_URL).toContain('download');
      expect(DEFAULT_RESOURCE_URL).not.toEqual('https://data.humdata.org/dataset/cod-ab-egy');
    });

    it('rejects HTML landing pages with a clear error when fetching', async () => {
      const originalFetch = global.fetch;
      global.fetch = jest.fn().mockResolvedValue({
        ok: true,
        status: 200,
        headers: {
          get: (name: string) => (name.toLowerCase() === 'content-type' ? 'text/html; charset=utf-8' : null),
        },
        text: () => Promise.resolve('<!DOCTYPE html><html><head><title>HDX Dataset</title></head></html>'),
      } as any);

      try {
        await expect(fetchUpstreamSnapshot('https://data.humdata.org/dataset/cod-ab-egy')).rejects.toThrow(
          /received HTML landing page instead of a snapshot resource/,
        );
      } finally {
        global.fetch = originalFetch;
      }
    });

    it('parses and validates valid upstream JSON snapshots when fetched', async () => {
      const validSnapshot = createMockSnapshot([
        {
          adm2_name: 'City A',
          adm2_name1: 'مدينة أ',
          adm2_pcode: 'EG0101',
          adm1_name: 'Cairo',
          adm1_pcode: 'EG01',
          center_lat: 30.0,
          center_lon: 31.0,
          version: 'v2026.1.0',
          valid_on: '2026-01-01',
        },
      ]);

      const originalFetch = global.fetch;
      global.fetch = jest.fn().mockImplementation((url: string) => {
        if (url === DEFAULT_METADATA_URL) {
          return Promise.resolve({
            ok: true,
            status: 200,
            statusText: 'OK',
            headers: { get: () => 'application/json' },
            text: () =>
              Promise.resolve(
                JSON.stringify({
                  success: true,
                  result: {
                    name: 'cod-ab-egy',
                    title: 'Egypt - Subnational Administrative Boundaries',
                    notes:
                      'Egypt administrative level 0-2 boundaries (COD-AB) dataset version 2026.1.0.\n' +
                      '- Admin 1: 1 Governorate\n' +
                      '- Admin 2: 1 Region\n' +
                      '- 2 January 2026: dataset reviewed for accuracy and completeness\n' +
                      '- 1 January 2026: valid for use by the humanitarian community\n' +
                      'Contributed by OCHA ROMENA.',
                    license_title: 'CC-BY-IGO',
                    license_url: 'https://creativecommons.org/licenses/by/3.0/igo/',
                    organization: { title: 'OCHA FISS' },
                    resources: [
                      {
                        name: 'snapshot.json',
                        format: 'JSON',
                        url: 'https://example.com/snapshot.json',
                        last_modified: '2026-01-03',
                      },
                    ],
                  },
                }),
              ),
          } as any);
        }
        return Promise.resolve({
          ok: true,
          status: 200,
          headers: {
            get: (name: string) => (name.toLowerCase() === 'content-type' ? 'application/json' : null),
          },
          text: () => Promise.resolve(JSON.stringify(validSnapshot)),
        } as any);
      });

      try {
        const fetched = await fetchUpstreamSnapshot('https://example.com/snapshot.json');
        expect(fetched.metadata.source).toBe('Egypt - Subnational Administrative Boundaries');
        expect(fetched.records).toHaveLength(1);
      } finally {
        global.fetch = originalFetch;
      }
    });
  });

  describe('Candidate Snapshot Diffing', () => {
    it('detects no diff when candidate snapshot matches current catalog', () => {
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
  });

  describe('Explicit Reviewed Metadata and Count Requirements', () => {
    it('requires explicit reviewed metadata when official count changes', () => {
      const baseCatalog = getOfficialCatalog();
      const rawRecords = baseCatalog
        .filter((c) => c.sourceCode !== 'EG0101') // Remove 1 city -> 350 official
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

      const candidateSnapshot = createMockSnapshot(rawRecords);

      // Attempting to apply without declaredOfficialCount throws
      expect(() => applyReviewedRelease(baseCatalog, candidateSnapshot)).toThrow(
        /Official count changed from 351 to 350; explicit reviewedMetadata\.declaredOfficialCount matching candidate is required/,
      );

      // Providing mismatched declaredOfficialCount throws
      expect(() =>
        applyReviewedRelease(baseCatalog, candidateSnapshot, {
          reviewedMetadata: { declaredOfficialCount: 351 },
        }),
      ).toThrow(/Declared official count mismatch: expected 351, got 350/);

      // Providing matching declaredOfficialCount succeeds
      const release = applyReviewedRelease(baseCatalog, candidateSnapshot, {
        reviewedMetadata: { declaredOfficialCount: 350, governorateCount: 27 },
      });
      expect(release.officialCount).toBe(350);
      expect(release.retiredCount).toBe(1);
    });

    it('requires explicit reviewed metadata when governorate count changes', () => {
      const baseCatalog: CityCatalogRecord[] = [
        {
          sourceCode: 'EG0101',
          nameEnglish: 'City Cairo',
          nameArabic: 'القاهرة',
          governorate: 'Cairo',
          governorateCode: 'EG01',
          sourceNameEnglish: 'City Cairo',
          sourceNameArabic: 'القاهرة',
          latitude: 30.0,
          longitude: 31.0,
          status: 'OFFICIAL',
        },
        {
          sourceCode: 'EG0201',
          nameEnglish: 'City Alex',
          nameArabic: 'الإسكندرية',
          governorate: 'Alexandria',
          governorateCode: 'EG02',
          sourceNameEnglish: 'City Alex',
          sourceNameArabic: 'الإسكندرية',
          latitude: 31.0,
          longitude: 29.9,
          status: 'OFFICIAL',
        },
      ];

      // Remove Alexandria city -> governorate count drops from 2 to 1
      const candidateRaw = [
        {
          adm2_name: 'City Cairo',
          adm2_name1: 'القاهرة',
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

      expect(() =>
        applyReviewedRelease(baseCatalog, candidateSnapshot, {
          reviewedMetadata: { declaredOfficialCount: 1 }, // missing governorateCount
        }),
      ).toThrow(
        /Governorate count changed from 2 to 1; explicit reviewedMetadata\.governorateCount matching candidate is required/,
      );

      const release = applyReviewedRelease(baseCatalog, candidateSnapshot, {
        reviewedMetadata: { declaredOfficialCount: 1, governorateCount: 1 },
      });
      expect(release.officialCount).toBe(1);
    });
  });

  describe('Legacy City Lifecycle Preservation', () => {
    it('keeps matching and missing legacy Cities legacy alongside approved identity transfers and ordinary retirements', () => {
      const currentCatalog: CityCatalogRecord[] = [
        {
          sourceCode: 'EG0101',
          nameEnglish: 'Recoded City',
          nameArabic: 'مدينة معاد ترميزها',
          governorate: 'Cairo',
          governorateCode: 'EG01',
          sourceNameEnglish: 'Recoded City',
          sourceNameArabic: 'مدينة معاد ترميزها',
          latitude: 30,
          longitude: 31,
          status: 'OFFICIAL',
        },
        {
          sourceCode: 'EG0102',
          nameEnglish: 'Retired City',
          nameArabic: 'مدينة متقاعدة',
          governorate: 'Cairo',
          governorateCode: 'EG01',
          sourceNameEnglish: 'Retired City',
          sourceNameArabic: 'مدينة متقاعدة',
          latitude: 30.1,
          longitude: 31.1,
          status: 'OFFICIAL',
        },
        {
          sourceCode: 'EG0103',
          nameEnglish: 'Stable City',
          nameArabic: 'مدينة مستقرة',
          governorate: 'Cairo',
          governorateCode: 'EG01',
          sourceNameEnglish: 'Stable City',
          sourceNameArabic: 'مدينة مستقرة',
          latitude: 30.2,
          longitude: 31.2,
          status: 'OFFICIAL',
        },
        {
          sourceCode: 'EG0104',
          nameEnglish: 'Matching Legacy City',
          nameArabic: 'مدينة قديمة مطابقة',
          governorate: 'Cairo',
          governorateCode: 'EG01',
          sourceNameEnglish: 'Matching Legacy City',
          sourceNameArabic: 'مدينة قديمة مطابقة',
          latitude: 30.3,
          longitude: 31.3,
          status: 'LEGACY',
        },
        {
          sourceCode: 'EG0105',
          nameEnglish: 'Missing Legacy City',
          nameArabic: 'مدينة قديمة مفقودة',
          governorate: 'Cairo',
          governorateCode: 'EG01',
          sourceNameEnglish: 'Missing Legacy City',
          sourceNameArabic: 'مدينة قديمة مفقودة',
          latitude: 30.4,
          longitude: 31.4,
          status: 'LEGACY',
        },
      ];

      const candidateSnapshot = createMockSnapshot([
        {
          adm2_name: 'Recoded City',
          adm2_name1: 'مدينة معاد ترميزها',
          adm2_pcode: 'EG0198',
          adm1_name: 'Cairo',
          adm1_pcode: 'EG01',
          center_lat: 30,
          center_lon: 31,
        },
        {
          adm2_name: 'Stable City',
          adm2_name1: 'مدينة مستقرة',
          adm2_pcode: 'EG0103',
          adm1_name: 'Cairo',
          adm1_pcode: 'EG01',
          center_lat: 30.2,
          center_lon: 31.2,
        },
        {
          adm2_name: 'Matching Legacy City',
          adm2_name1: 'مدينة قديمة مطابقة',
          adm2_pcode: 'EG0104',
          adm1_name: 'Cairo',
          adm1_pcode: 'EG01',
          center_lat: 30.3,
          center_lon: 31.3,
        },
      ]);

      const release = applyReviewedRelease(currentCatalog, candidateSnapshot, {
        reviewedMetadata: { declaredOfficialCount: 2, governorateCount: 1 },
        identityTransfers: [
          {
            retiredCitySourceCode: 'EG0101',
            replacementCitySourceCode: 'EG0198',
          },
        ],
      });

      expect(release.officialCount).toBe(2);
      expect(release.legacyCount).toBe(2);
      expect(release.retiredCount).toBe(1);
      expect(release.updatedCatalog.find((city) => city.sourceCode === 'EG0104')?.status).toBe('LEGACY');
      expect(release.updatedCatalog.find((city) => city.sourceCode === 'EG0105')?.status).toBe('LEGACY');
      expect(release.updatedCatalog.find((city) => city.sourceCode === 'EG0102')?.status).toBe('RETIRED');
      expect(release.identityTransfers).toEqual([
        {
          retiredCitySourceCode: 'EG0101',
          replacementCitySourceCode: 'EG0198',
        },
      ]);

      const migrationSql = generateReleaseMigrationSql(release, { migrationTag: 'legacy_lifecycle_release' });
      expect(migrationSql).toContain("UPDATE cities SET source_code = 'EG0198' WHERE source_code = 'EG0101';");
      expect(migrationSql).toContain("UPDATE cities SET status = 'RETIRED' WHERE source_code IN ('EG0102');");
      expect(migrationSql).toContain("'EG0104', 'Matching Legacy City', 'مدينة قديمة مطابقة', 'Cairo'");
      expect(migrationSql).toContain("'LEGACY'");
    });

    it('applies an explicit reviewed lifecycle decision before promoting a matching legacy City', () => {
      const legacyCity: CityCatalogRecord = {
        sourceCode: 'EG0104',
        nameEnglish: 'Matching Legacy City',
        nameArabic: 'مدينة قديمة مطابقة',
        governorate: 'Cairo',
        governorateCode: 'EG01',
        sourceNameEnglish: 'Matching Legacy City',
        sourceNameArabic: 'مدينة قديمة مطابقة',
        latitude: 30.3,
        longitude: 31.3,
        status: 'LEGACY',
      };
      const candidateSnapshot = createMockSnapshot([
        {
          adm2_name: 'Canonical Matching City',
          adm2_name1: 'مدينة مطابقة قياسية',
          adm2_pcode: legacyCity.sourceCode,
          adm1_name: legacyCity.governorate,
          adm1_pcode: legacyCity.governorateCode,
          center_lat: legacyCity.latitude,
          center_lon: legacyCity.longitude,
        },
      ]);

      const release = applyReviewedRelease([legacyCity], candidateSnapshot, {
        reviewedMetadata: { declaredOfficialCount: 1, governorateCount: 1 },
        legacyLifecycleDecisions: [
          {
            legacyCitySourceCode: legacyCity.sourceCode,
            nextCityLifecycleStatus: 'OFFICIAL',
            notes: 'Reviewed promotion after identity confirmation.',
          },
        ],
      });

      expect(release.officialCount).toBe(1);
      expect(release.legacyCount).toBe(0);
      expect(release.updatedCatalog).toEqual([
        expect.objectContaining({
          sourceCode: legacyCity.sourceCode,
          nameEnglish: 'Canonical Matching City',
          status: 'OFFICIAL',
        }),
      ]);
      expect(release.legacyLifecycleDecisions).toEqual([
        {
          legacyCitySourceCode: legacyCity.sourceCode,
          nextCityLifecycleStatus: 'OFFICIAL',
          notes: 'Reviewed promotion after identity confirmation.',
        },
      ]);
    });
  });

  describe('City Identity Transfer Validation and Recode Enforcement', () => {
    const baseCatalog: CityCatalogRecord[] = [
      {
        sourceCode: 'EG0101',
        nameEnglish: 'Recoded City',
        nameArabic: 'مدينة معاد ترميزها',
        governorate: 'Cairo',
        governorateCode: 'EG01',
        sourceNameEnglish: 'Recoded City',
        sourceNameArabic: 'مدينة معاد ترميزها',
        latitude: 30.0,
        longitude: 31.0,
        status: 'OFFICIAL',
      },
      {
        sourceCode: 'EG0102',
        nameEnglish: 'Retired City 1',
        nameArabic: 'مدينة ملغاة 1',
        governorate: 'Cairo',
        governorateCode: 'EG01',
        sourceNameEnglish: 'Retired City 1',
        sourceNameArabic: 'مدينة ملغاة 1',
        latitude: 30.1,
        longitude: 31.1,
        status: 'OFFICIAL',
      },
      {
        sourceCode: 'EG0103',
        nameEnglish: 'Active Constant City',
        nameArabic: 'مدينة نشطة',
        governorate: 'Cairo',
        governorateCode: 'EG01',
        sourceNameEnglish: 'Active Constant City',
        sourceNameArabic: 'مدينة نشطة',
        latitude: 30.2,
        longitude: 31.2,
        status: 'OFFICIAL',
      },
    ];

    it('requires an explicit reviewed City identity transfer when an upstream recode is detected', () => {
      // Candidate changes EG0101's sourceCode to EG0198 (same name & governorate -> detected recode)
      const candidateRaw = [
        {
          adm2_name: 'Recoded City',
          adm2_name1: 'مدينة معاد ترميزها',
          adm2_pcode: 'EG0198',
          adm1_name: 'Cairo',
          adm1_pcode: 'EG01',
          center_lat: 30.0,
          center_lon: 31.0,
        },
        {
          adm2_name: 'Active Constant City',
          adm2_name1: 'مدينة نشطة',
          adm2_pcode: 'EG0103',
          adm1_name: 'Cairo',
          adm1_pcode: 'EG01',
          center_lat: 30.2,
          center_lon: 31.2,
        },
      ];

      const candidateSnapshot = createMockSnapshot(candidateRaw);

      // 1. Attempting without a City identity transfer fails closed
      expect(() =>
        applyReviewedRelease(baseCatalog, candidateSnapshot, {
          reviewedMetadata: { declaredOfficialCount: 2, governorateCount: 1 },
        }),
      ).toThrow(/Unreviewed City recode detected for 'Recoded City' in governorate 'Cairo' \(EG0101 -> EG0198\)/);

      // 2. Providing an explicit matching City identity transfer succeeds
      const release = applyReviewedRelease(baseCatalog, candidateSnapshot, {
        reviewedMetadata: { declaredOfficialCount: 2, governorateCount: 1 },
        identityTransfers: [
          {
            retiredCitySourceCode: 'EG0101',
            replacementCitySourceCode: 'EG0198',
            notes: 'Recoded from EG0101 to EG0198',
          },
        ],
      });

      expect(release.officialCount).toBe(2);
      expect(release.retiredCount).toBe(1); // EG0102 became RETIRED
      expect(release.identityTransfers).toEqual([
        {
          retiredCitySourceCode: 'EG0101',
          replacementCitySourceCode: 'EG0198',
          notes: 'Recoded from EG0101 to EG0198',
        },
      ]);
    });

    it('validates 1:1 bijective City identity transfers and rejects invalid, incomplete, or duplicate configurations', () => {
      const candidateRaw = [
        {
          adm2_name: 'New City 1',
          adm2_name1: 'مدينة جديدة 1',
          adm2_pcode: 'EG0198',
          adm1_name: 'Cairo',
          adm1_pcode: 'EG01',
          center_lat: 30.0,
          center_lon: 31.0,
        },
        {
          adm2_name: 'New City 2',
          adm2_name1: 'مدينة جديدة 2',
          adm2_pcode: 'EG0199',
          adm1_name: 'Cairo',
          adm1_pcode: 'EG01',
          center_lat: 30.1,
          center_lon: 31.1,
        },
        {
          adm2_name: 'Active Constant City',
          adm2_name1: 'مدينة نشطة',
          adm2_pcode: 'EG0103',
          adm1_name: 'Cairo',
          adm1_pcode: 'EG01',
          center_lat: 30.2,
          center_lon: 31.2,
        },
      ];
      const candidateSnapshot = createMockSnapshot(candidateRaw);

      // 1. Incomplete mapping
      expect(() =>
        applyReviewedRelease(baseCatalog, candidateSnapshot, {
          reviewedMetadata: { declaredOfficialCount: 3, governorateCount: 1 },
          identityTransfers: [{ retiredCitySourceCode: '', replacementCitySourceCode: 'EG0198' }],
        }),
      ).toThrow(/missing or invalid retiredCitySourceCode/);

      expect(() =>
        applyReviewedRelease(baseCatalog, candidateSnapshot, {
          reviewedMetadata: { declaredOfficialCount: 3, governorateCount: 1 },
          identityTransfers: [{ retiredCitySourceCode: 'EG0101', replacementCitySourceCode: '   ' }],
        }),
      ).toThrow(/missing or invalid replacementCitySourceCode/);

      // 2. Unknown retired City source code
      expect(() =>
        applyReviewedRelease(baseCatalog, candidateSnapshot, {
          reviewedMetadata: { declaredOfficialCount: 3, governorateCount: 1 },
          identityTransfers: [{ retiredCitySourceCode: 'EG9999_UNKNOWN', replacementCitySourceCode: 'EG0198' }],
        }),
      ).toThrow(/is not an active official City in the current catalog/);

      // 3. Active-as-source (EG0103 is still active in candidate release)
      expect(() =>
        applyReviewedRelease(baseCatalog, candidateSnapshot, {
          reviewedMetadata: { declaredOfficialCount: 3, governorateCount: 1 },
          identityTransfers: [{ retiredCitySourceCode: 'EG0103', replacementCitySourceCode: 'EG0198' }],
        }),
      ).toThrow(/is still an active official City in the candidate release/);

      // 4. Unknown/retired replacement City source code target
      expect(() =>
        applyReviewedRelease(baseCatalog, candidateSnapshot, {
          reviewedMetadata: { declaredOfficialCount: 3, governorateCount: 1 },
          identityTransfers: [
            { retiredCitySourceCode: 'EG0101', replacementCitySourceCode: 'EG9999_NOT_IN_CANDIDATE' },
          ],
        }),
      ).toThrow(/is not an active official City in the candidate release/);

      // 5. Target already active in current catalog (not a new source identity)
      expect(() =>
        applyReviewedRelease(baseCatalog, candidateSnapshot, {
          reviewedMetadata: { declaredOfficialCount: 3, governorateCount: 1 },
          identityTransfers: [{ retiredCitySourceCode: 'EG0101', replacementCitySourceCode: 'EG0103' }],
        }),
      ).toThrow(/already exists in the current catalog/);

      // 6. Ambiguous / Self-mapping
      expect(() =>
        applyReviewedRelease(baseCatalog, candidateSnapshot, {
          reviewedMetadata: { declaredOfficialCount: 3, governorateCount: 1 },
          identityTransfers: [{ retiredCitySourceCode: 'EG0101', replacementCitySourceCode: 'EG0101' }],
        }),
      ).toThrow(/cannot transfer City 'EG0101' to itself/);

      // 7. Duplicate retired source (many-to-one from)
      expect(() =>
        applyReviewedRelease(baseCatalog, candidateSnapshot, {
          reviewedMetadata: { declaredOfficialCount: 3, governorateCount: 1 },
          identityTransfers: [
            { retiredCitySourceCode: 'EG0101', replacementCitySourceCode: 'EG0198' },
            { retiredCitySourceCode: 'EG0101', replacementCitySourceCode: 'EG0199' },
          ],
        }),
      ).toThrow(/Duplicate City identity transfer for retired City 'EG0101'/);

      // 8. Duplicate replacement City target (many-to-one)
      expect(() =>
        applyReviewedRelease(baseCatalog, candidateSnapshot, {
          reviewedMetadata: { declaredOfficialCount: 3, governorateCount: 1 },
          identityTransfers: [
            { retiredCitySourceCode: 'EG0101', replacementCitySourceCode: 'EG0198' },
            { retiredCitySourceCode: 'EG0102', replacementCitySourceCode: 'EG0198' },
          ],
        }),
      ).toThrow(/Duplicate City identity transfer for replacement City 'EG0198'/);
    });

    it('correctly compiles catalog records and generates identity transfer SQL in release migrations', () => {
      const candidateRaw = [
        {
          adm2_name: 'Recoded City New',
          adm2_name1: 'مدينة معاد ترميزها جديدة',
          adm2_pcode: 'EG0198',
          adm1_name: 'Cairo',
          adm1_pcode: 'EG01',
          center_lat: 30.05,
          center_lon: 31.05,
        },
        {
          adm2_name: 'Active Constant City',
          adm2_name1: 'مدينة نشطة',
          adm2_pcode: 'EG0103',
          adm1_name: 'Cairo',
          adm1_pcode: 'EG01',
          center_lat: 30.2,
          center_lon: 31.2,
        },
      ];
      const candidateSnapshot = createMockSnapshot(candidateRaw);

      const release = applyReviewedRelease(baseCatalog, candidateSnapshot, {
        reviewedMetadata: { declaredOfficialCount: 2, governorateCount: 1 },
        identityTransfers: [
          {
            retiredCitySourceCode: 'EG0101',
            replacementCitySourceCode: 'EG0198',
            notes: 'Recode EG0101 -> EG0198',
          },
        ],
      });

      // Updated catalog checks
      // EG0198 is OFFICIAL
      const recodedRecord = release.updatedCatalog.find((c) => c.sourceCode === 'EG0198');
      expect(recodedRecord).toBeDefined();
      expect(recodedRecord?.status).toBe('OFFICIAL');
      expect(recodedRecord?.nameEnglish).toBe('Recoded City New');

      // EG0101 was transferred, so it should NOT be present as RETIRED
      const oldRecodedRecord = release.updatedCatalog.find((c) => c.sourceCode === 'EG0101');
      expect(oldRecodedRecord).toBeUndefined();

      // EG0102 was removed without mapping, so it MUST be RETIRED
      const retiredRecord = release.updatedCatalog.find((c) => c.sourceCode === 'EG0102');
      expect(retiredRecord).toBeDefined();
      expect(retiredRecord?.status).toBe('RETIRED');

      // Check migration SQL
      const migrationSql = generateReleaseMigrationSql(release, { migrationTag: '0012_release_city_catalog' });
      expect(migrationSql).toContain("UPDATE cities SET source_code = 'EG0198' WHERE source_code = 'EG0101';");
      expect(migrationSql).toContain("UPDATE cities SET status = 'RETIRED' WHERE source_code IN ('EG0102');");
      expect(migrationSql).not.toContain("SET status = 'RETIRED' WHERE source_code IN ('EG0101'");
      expect(migrationSql).toContain('INSERT INTO cities (source_code, name_english, name_arabic, governorate');
      expect(migrationSql).toContain("'EG0198'");
    });
  });

  describe('Monotonically Ordered Migration Generation and Publishing', () => {
    const tempDir = path.resolve(__dirname, '../../test/temp-migrations');

    beforeEach(() => {
      if (!fs.existsSync(tempDir)) {
        fs.mkdirSync(tempDir, { recursive: true });
      }
      const metaDir = path.join(tempDir, 'meta');
      if (!fs.existsSync(metaDir)) {
        fs.mkdirSync(metaDir, { recursive: true });
      }
      const entries = Array.from({ length: 12 }, (_, i) => {
        const prefix = String(i).padStart(4, '0');
        const tag = i === 11 ? '0011_reconcile_city_catalog' : `${prefix}_migration_${i}`;
        const sqlPath = path.join(tempDir, `${tag}.sql`);
        fs.writeFileSync(sqlPath, `-- Migration: ${tag}.sql\nSELECT 1;\n`, 'utf8');
        return { idx: i, version: '7', when: 1000 + i * 100, tag, breakpoints: true };
      });
      fs.writeFileSync(
        path.join(metaDir, '_journal.json'),
        JSON.stringify({
          version: '7',
          dialect: 'postgresql',
          entries,
        }),
        'utf8',
      );
    });

    afterEach(() => {
      if (fs.existsSync(tempDir)) {
        fs.rmSync(tempDir, { recursive: true, force: true });
      }
    });

    it('generates the next monotonically ordered migration meta (e.g. 0012)', () => {
      const meta = getNextMigrationMeta(tempDir);
      expect(meta.nextIdx).toBe(12);
      expect(meta.tag).toBe('0012_release_city_catalog');
      expect(meta.filename).toBe('0012_release_city_catalog.sql');
    });

    it('generates valid idempotent upgrade SQL preserving counts and retired status', () => {
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
      ];

      const candidateRaw = [
        {
          adm2_name: 'Active City New',
          adm2_name1: 'مدينة نشطة جديدة',
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
      const release = applyReviewedRelease(baseCatalog, candidateSnapshot);
      const sql = generateReleaseMigrationSql(release, { migrationTag: '0012_release_city_catalog' });

      expect(sql).toContain('-- Migration: 0012_release_city_catalog.sql');
      expect(sql).toContain('INSERT INTO cities (source_code, name_english, name_arabic, governorate');
      expect(sql).toContain('UPDATE posts SET governorate = cities.governorate FROM cities');
      expect(sql).toContain('IF official_count != 1 THEN');
      expect(sql).toContain('IF gov_count != 1 THEN');
    });

    it('publishes reviewed release atomically without modifying earlier migrations and updating journal', () => {
      const baseCatalog = getOfficialCatalog();
      const candidateRaw = baseCatalog.map((c) => {
        if (c.sourceCode === 'EG0104') {
          return {
            adm2_name: 'Maadi Updated',
            adm2_name1: 'المعادي المحدثة',
            adm2_pcode: c.sourceCode,
            adm1_name: c.governorate,
            adm1_name1: c.governorateArabic || '',
            adm1_pcode: c.governorateCode,
            adm0_name: 'Egypt',
            adm0_name1: 'مصر',
            adm0_pcode: 'EG',
            center_lat: 29.96,
            center_lon: 31.26,
          };
        }
        return {
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
        };
      });

      const candidateSnapshot = createMockSnapshot(candidateRaw, {
        upstreamVersion: '2026.2.0',
        lastModified: '2026-06-20',
      });
      const tempCatalogPath = path.join(tempDir, 'catalog.json');
      const tempSnapshotPath = path.join(tempDir, 'snapshot.json');

      const result = publishReviewedRelease(baseCatalog, candidateSnapshot, {
        migrationsFolder: tempDir,
        catalogPath: tempCatalogPath,
        snapshotPath: tempSnapshotPath,
      });

      expect(result.migrationTag).toBe('0012_release_city_catalog');
      expect(fs.existsSync(result.migrationPath)).toBe(true);
      expect(fs.existsSync(tempCatalogPath)).toBe(true);
      expect(fs.existsSync(tempSnapshotPath)).toBe(true);

      // Check journal was updated with entry 12
      const journalContent = fs.readFileSync(path.join(tempDir, 'meta', '_journal.json'), 'utf8');
      const journal = JSON.parse(journalContent) as { entries: Array<{ idx: number; tag: string }> };
      expect(journal.entries).toHaveLength(13);
      expect(journal.entries[12].idx).toBe(12);
      expect(journal.entries[12].tag).toBe('0012_release_city_catalog');
    });

    it('fails closed without writing any files if candidate validation or count checks fail', () => {
      const baseCatalog = getOfficialCatalog();
      const invalidSnapshot = { metadata: { source: '' }, records: [] } as unknown as CitySnapshot;

      const tempCatalogPath = path.join(tempDir, 'catalog.json');
      const tempSnapshotPath = path.join(tempDir, 'snapshot.json');

      expect(() =>
        publishReviewedRelease(baseCatalog, invalidSnapshot, {
          migrationsFolder: tempDir,
          catalogPath: tempCatalogPath,
          snapshotPath: tempSnapshotPath,
        }),
      ).toThrow();

      // Ensure no files were written
      expect(fs.existsSync(tempCatalogPath)).toBe(false);
      expect(fs.existsSync(tempSnapshotPath)).toBe(false);
      expect(fs.existsSync(path.join(tempDir, '0012_release_city_catalog.sql'))).toBe(false);
    });
  });
});
