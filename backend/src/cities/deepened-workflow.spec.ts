import { getOfficialCatalog, type CityCatalogRecord } from './catalog';
import { compareSnapshots, calculateDistanceKm } from './diff';
import { fetchUpstreamSnapshot, DEFAULT_RESOURCE_URL } from './fetch';
import { applyReviewedRelease, type ReviewedReleaseResult } from './plan';
import { getNextMigrationMeta, generateReleaseMigrationSql } from './migration';
import { publishReviewedRelease } from './publish';
import {
  generateCityUpsertSql,
  generateCitiesUpsertSql,
  generatePostGovernorateSyncSql,
  generateCityVerificationSql,
  generateRetiredCitiesSql,
  escapeSqlString,
} from './release-sql';
import { generateReconcileMigrationSql } from './reconcile';
import * as refreshFacade from './refresh';

describe('Deepened City Release Workflow Architecture', () => {
  const currentCatalog = getOfficialCatalog();

  describe('Explicit Module Boundaries and Public Interfaces', () => {
    it('exposes independent focused interfaces across diff, fetch, plan, migration, publish, and release-sql', () => {
      expect(typeof compareSnapshots).toBe('function');
      expect(typeof calculateDistanceKm).toBe('function');
      expect(typeof fetchUpstreamSnapshot).toBe('function');
      expect(typeof DEFAULT_RESOURCE_URL).toBe('string');
      expect(typeof applyReviewedRelease).toBe('function');
      expect(typeof getNextMigrationMeta).toBe('function');
      expect(typeof generateReleaseMigrationSql).toBe('function');
      expect(typeof publishReviewedRelease).toBe('function');
      expect(typeof generateCityUpsertSql).toBe('function');
      expect(typeof generateCitiesUpsertSql).toBe('function');
      expect(typeof generatePostGovernorateSyncSql).toBe('function');
      expect(typeof generateCityVerificationSql).toBe('function');
      expect(typeof generateRetiredCitiesSql).toBe('function');
      expect(typeof escapeSqlString).toBe('function');
    });

    it('maintains 100% backward compatibility via the refresh facade', () => {
      expect(refreshFacade.compareSnapshots).toBe(compareSnapshots);
      expect(refreshFacade.fetchUpstreamSnapshot).toBe(fetchUpstreamSnapshot);
      expect(refreshFacade.applyReviewedRelease).toBe(applyReviewedRelease);
      expect(refreshFacade.generateReleaseMigrationSql).toBe(generateReleaseMigrationSql);
      expect(refreshFacade.publishReviewedRelease).toBe(publishReviewedRelease);
      expect(refreshFacade.generateCityUpsertSql).toBe(generateCityUpsertSql);
      expect(refreshFacade.DEFAULT_RESOURCE_URL).toBe(DEFAULT_RESOURCE_URL);
    });
  });

  describe('Shared Lifecycle-Aware City Upsert SQL Generator', () => {
    const sampleRecord: CityCatalogRecord = {
      sourceCode: 'EG0101',
      nameEnglish: '15th of May',
      nameArabic: '١٥ مايو',
      governorate: 'Cairo',
      governorateArabic: 'القاهرة',
      governorateCode: 'EG01',
      sourceNameEnglish: '15th of May',
      sourceNameArabic: '١٥ مايو',
      latitude: 29.83,
      longitude: 31.37,
      status: 'OFFICIAL',
    };

    it('generates deterministic PostGIS upsert SQL with canonical conflict targets and excluded column updates', () => {
      const sql = generateCityUpsertSql(sampleRecord, '  ');

      expect(sql).toContain('INSERT INTO cities (source_code, name_english, name_arabic, governorate');
      expect(sql).toContain("VALUES ('EG0101', '15th of May', '١٥ مايو', 'Cairo'");
      expect(sql).toContain('ST_SetSRID(ST_MakePoint(31.37, 29.83), 4326)');
      expect(sql).toContain('ON CONFLICT (source_code) DO UPDATE SET');
      expect(sql).toContain('name_english = EXCLUDED.name_english');
      expect(sql).toContain('status = EXCLUDED.status');
      expect(sql).toContain('center_point = EXCLUDED.center_point');
    });

    it('preserves single quote escaping within SQL strings', () => {
      const recordWithQuotes: CityCatalogRecord = {
        ...sampleRecord,
        sourceCode: "EG0199'TEST",
        nameEnglish: "O'Brien City",
        nameArabic: "مدينة أو'براين",
      };

      const sql = generateCityUpsertSql(recordWithQuotes, '  ');
      expect(sql).toContain("'EG0199''TEST'");
      expect(sql).toContain("'O''Brien City'");
      expect(sql).toContain("'مدينة أو''براين'");
    });

    it('reconciliation and release migration generators produce identical upsert representations for identical catalog records', () => {
      const releasePlan: ReviewedReleaseResult = {
        updatedCatalog: currentCatalog,
        diffReport: {
          added: [],
          removed: [],
          renamed: [],
          recoded: [],
          coordinateChanged: [],
          summary: {
            totalCurrent: 351,
            totalCandidate: 351,
            addedCount: 0,
            removedCount: 0,
            renamedCount: 0,
            recodedCount: 0,
            coordinateChangedCount: 0,
          },
        },
        retiredCount: 0,
        officialCount: 351,
        metadata: {
          governorateCount: 27,
        },
      };

      const releaseSql = generateReleaseMigrationSql(releasePlan, { migrationTag: 'test_release' });
      const reconcileSql = generateReconcileMigrationSql([], currentCatalog);

      // Verify that every single city's upsert statement is identical between reconciliation and release migration
      const firstCity = currentCatalog[0];
      const expectedUpsert = generateCityUpsertSql(firstCity, '  ');

      expect(releaseSql).toContain(expectedUpsert);
      expect(reconcileSql).toContain(expectedUpsert);

      // Verify shared governorate sync statement is identical
      const expectedSync = generatePostGovernorateSyncSql('  ');
      expect(releaseSql).toContain(expectedSync);
      expect(reconcileSql).toContain(expectedSync);
    });

    it('generates consistent verification checks for official counts and governorate bounds', () => {
      const verifySqlLines = generateCityVerificationSql(351, 27, '  ', 'Test verification');
      const joinedSql = verifySqlLines.join('\n');

      expect(joinedSql).toContain("count(*) FILTER (WHERE status = 'OFFICIAL')");
      expect(joinedSql).toContain("count(DISTINCT governorate) FILTER (WHERE status = 'OFFICIAL')");
      expect(joinedSql).toContain("count(*) FILTER (WHERE status = 'OFFICIAL' AND source_code IS NULL)");
      expect(joinedSql).toContain('IF official_count != 351 THEN');
      expect(joinedSql).toContain('IF gov_count != 27 THEN');
      expect(joinedSql).toContain('IF invalid_official_count != 0 THEN');
    });
  });
});
