/* eslint-disable @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-assignment */
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { reconcileMigrationHistory, getNextMigrationMeta, type MigrationJournal } from './migration';
import { publishReviewedRelease, recoverInterruptedPublication, type FaultInjectionHook } from './publish';
import { getOfficialCatalog, type CitySnapshot, type CityCatalog } from './catalog';

describe('Atomic Append-Only City Release Publication & History Reconciliation', () => {
  let tempBaseDir: string;
  let migrationsDir: string;
  let metaDir: string;
  let journalPath: string;
  let catalogPath: string;
  let snapshotPath: string;

  const baseCatalog = getOfficialCatalog();

  const createMockSnapshot = (
    records: any[],
    options: { upstreamVersion?: string; lastModified?: string } = {},
  ): CitySnapshot => ({
    metadata: {
      source: 'OCHA HDX COD-AB Egypt',
      sourceUrl: 'https://data.humdata.org/dataset/cod-ab-egy',
      resourceUrl:
        'https://data.humdata.org/dataset/b90d81ba-7c7a-4283-9899-827480d80a79/resource/81126a96-2991-48e1-93cb-24c164a4de88/download/ocha-adm2-egypt-snapshot.json',
      upstreamVersion: options.upstreamVersion ?? '2026.2.0',
      upstreamDates: {
        validOn: '2026-06-01',
        reviewedDate: '2026-06-15',
        lastModified: options.lastModified ?? '2026-06-20',
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

  const createAdvancedSnapshot = () =>
    createMockSnapshot(
      baseCatalog.map((city) => ({
        adm2_name: city.sourceCode === 'EG0104' ? 'Maadi Updated' : city.sourceNameEnglish,
        adm2_name1: city.sourceCode === 'EG0104' ? 'المعادي المحدثة' : city.sourceNameArabic,
        adm2_pcode: city.sourceCode,
        adm1_name: city.governorate,
        adm1_name1: city.governorateArabic || '',
        adm1_pcode: city.governorateCode,
        adm0_name: 'Egypt',
        adm0_name1: 'مصر',
        adm0_pcode: 'EG',
        center_lat: city.latitude,
        center_lon: city.longitude,
      })),
    );

  const setupMockMigrationHistory = (entries: Array<{ idx: number; tag: string; version?: string }>) => {
    const journal: MigrationJournal = {
      version: '7',
      dialect: 'postgresql',
      entries: entries.map((e) => ({
        idx: e.idx,
        version: e.version ?? '7',
        when: 1780000000000 + e.idx * 1000,
        tag: e.tag,
        breakpoints: true,
      })),
    };
    fs.writeFileSync(journalPath, JSON.stringify(journal, null, 2), 'utf8');

    for (const e of entries) {
      const sqlPath = path.join(migrationsDir, `${e.tag}.sql`);
      fs.writeFileSync(sqlPath, `-- Migration: ${e.tag}.sql\nSELECT 1;\n`, 'utf8');
    }
  };

  beforeEach(() => {
    tempBaseDir = fs.mkdtempSync(path.join(os.tmpdir(), 'city-pub-test-'));
    migrationsDir = path.join(tempBaseDir, 'migrations');
    metaDir = path.join(migrationsDir, 'meta');
    fs.mkdirSync(metaDir, { recursive: true });
    journalPath = path.join(metaDir, '_journal.json');
    catalogPath = path.join(tempBaseDir, 'egypt-cities-catalog.json');
    snapshotPath = path.join(tempBaseDir, 'ocha-adm2-egypt-snapshot.json');

    // Write baseline catalog and snapshot
    fs.writeFileSync(
      catalogPath,
      JSON.stringify(
        {
          metadata: {
            upstreamVersion: '2026.1.0',
            declaredOfficialCount: 351,
            governorateCount: 27,
          },
          records: baseCatalog,
        },
        null,
        2,
      ),
      'utf8',
    );

    const initialRawRecords = baseCatalog.map((c) => ({
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
    fs.writeFileSync(
      snapshotPath,
      JSON.stringify(
        createMockSnapshot(initialRawRecords, {
          upstreamVersion: '2026.1.0',
          lastModified: '2026-01-01',
        }),
        null,
        2,
      ),
      'utf8',
    );

    // Initial 12 baseline migrations (0000 to 0011)
    const baselineEntries = [
      { idx: 0, tag: '0000_familiar_shiver_man' },
      { idx: 1, tag: '0001_windy_moondragon' },
      { idx: 2, tag: '0002_lame_anita_blake' },
      { idx: 3, tag: '0003_nosy_korg' },
      { idx: 4, tag: '0004_curly_silhouette' },
      { idx: 5, tag: '0005_easy_the_hand' },
      { idx: 6, tag: '0006_add_mating_post_type' },
      { idx: 7, tag: '0007_create_mating_posts' },
      { idx: 8, tag: '0008_brave_lester' },
      { idx: 9, tag: '0009_version_custom_ddl' },
      { idx: 10, tag: '0010_peaceful_wind_dancer' },
      { idx: 11, tag: '0011_reconcile_city_catalog' },
    ];
    setupMockMigrationHistory(baselineEntries);
  });

  afterEach(() => {
    if (fs.existsSync(tempBaseDir)) {
      fs.rmSync(tempBaseDir, { recursive: true, force: true });
    }
  });

  describe('Migration History Reconciliation & Monotonic Numbering', () => {
    it('reconciles clean migration history and computes next monotonic metadata (0012)', () => {
      const result = reconcileMigrationHistory(migrationsDir);
      expect(result.isValid).toBe(true);
      expect(result.errors).toHaveLength(0);
      expect(result.nextIdx).toBe(12);
      expect(result.entriesCount).toBe(12);

      const meta = getNextMigrationMeta(migrationsDir);
      expect(meta.nextIdx).toBe(12);
      expect(meta.tag).toBe('0012_release_city_catalog');
      expect(meta.filename).toBe('0012_release_city_catalog.sql');
      expect(meta.journalPath).toBe(journalPath);
    });

    it('fails closed when journal JSON is malformed or invalid schema', () => {
      fs.writeFileSync(journalPath, '{ invalid json', 'utf8');

      const result = reconcileMigrationHistory(migrationsDir);
      expect(result.isValid).toBe(false);
      expect(result.errors.some((e) => e.includes('Malformed or unparseable'))).toBe(true);

      expect(() => getNextMigrationMeta(migrationsDir)).toThrow(/Migration history reconciliation failed closed/);
    });

    it('fails closed when a journal omits required Drizzle metadata', () => {
      fs.writeFileSync(journalPath, JSON.stringify({ entries: [] }), 'utf8');

      const result = reconcileMigrationHistory(migrationsDir);

      expect(result.isValid).toBe(false);
      expect(result.errors).toContainEqual(expect.stringContaining('missing or invalid "version"'));
      expect(result.errors).toContainEqual(expect.stringContaining('missing or invalid "dialect"'));
      expect(() => getNextMigrationMeta(migrationsDir)).toThrow(/Migration history reconciliation failed closed/);
    });

    it('fails closed on duplicate journal indices', () => {
      const duplicateIndexEntries = [
        { idx: 0, tag: '0000_first' },
        { idx: 1, tag: '0001_second' },
        { idx: 1, tag: '0001_duplicate' },
      ];
      setupMockMigrationHistory(duplicateIndexEntries);

      const result = reconcileMigrationHistory(migrationsDir);
      expect(result.isValid).toBe(false);
      expect(result.errors.some((e) => e.includes('Duplicate journal index 1'))).toBe(true);
    });

    it('fails closed on duplicate journal tags', () => {
      // Create journal manually to bypass write helper
      fs.writeFileSync(
        journalPath,
        JSON.stringify({
          version: '7',
          dialect: 'postgresql',
          entries: [
            { idx: 0, tag: '0000_same_tag', version: '7', when: 1000 },
            { idx: 1, tag: '0000_same_tag', version: '7', when: 2000 },
          ],
        }),
        'utf8',
      );
      fs.writeFileSync(path.join(migrationsDir, '0000_same_tag.sql'), 'SELECT 1;', 'utf8');

      const result = reconcileMigrationHistory(migrationsDir);
      expect(result.isValid).toBe(false);
      expect(result.errors.some((e) => e.includes('Duplicate journal tag "0000_same_tag"'))).toBe(true);
    });

    it('fails closed on missing journal index sequence gaps (e.g. 0, 1, 3)', () => {
      const gapEntries = [
        { idx: 0, tag: '0000_first' },
        { idx: 1, tag: '0001_second' },
        { idx: 3, tag: '0003_skipped_two' },
      ];
      setupMockMigrationHistory(gapEntries);

      const result = reconcileMigrationHistory(migrationsDir);
      expect(result.isValid).toBe(false);
      expect(result.errors.some((e) => e.includes('missing index 2'))).toBe(true);
    });

    it('fails closed when tag prefix does not match journal index', () => {
      const mismatchEntries = [
        { idx: 0, tag: '0000_first' },
        { idx: 1, tag: '0005_wrong_prefix' },
      ];
      setupMockMigrationHistory(mismatchEntries);

      const result = reconcileMigrationHistory(migrationsDir);
      expect(result.isValid).toBe(false);
      expect(result.errors.some((e) => e.includes('does not start with expected prefix "0001_"'))).toBe(true);
    });

    it('fails closed when a journal entry references a missing .sql migration file on disk', () => {
      // Delete 0005_easy_the_hand.sql
      fs.rmSync(path.join(migrationsDir, '0005_easy_the_hand.sql'));

      const result = reconcileMigrationHistory(migrationsDir);
      expect(result.isValid).toBe(false);
      expect(
        result.errors.some((e) => e.includes('0005_easy_the_hand.sql') && e.includes('does not exist on disk')),
      ).toBe(true);
    });

    it('fails closed when an unjournaled .sql migration file exists on disk', () => {
      // Add unjournaled file
      fs.writeFileSync(path.join(migrationsDir, '0099_rogue_migration.sql'), 'SELECT 1;', 'utf8');

      const result = reconcileMigrationHistory(migrationsDir);
      expect(result.isValid).toBe(false);
      expect(result.errors.some((e) => e.includes('Unjournaled migration file "0099_rogue_migration.sql"'))).toBe(true);
    });

    it('fails closed when multiple migration files share the same numeric prefix on disk', () => {
      fs.writeFileSync(path.join(migrationsDir, '0001_colliding_migration.sql'), 'SELECT 1;', 'utf8');

      const result = reconcileMigrationHistory(migrationsDir);
      expect(result.isValid).toBe(false);
      expect(
        result.errors.some((e) => e.includes('Multiple migration files on disk share numeric prefix "0001"')),
      ).toBe(true);
    });

    it('refuses to overwrite when target next migration file already exists on disk', () => {
      // Pre-create 0012_release_city_catalog.sql
      fs.writeFileSync(path.join(migrationsDir, '0012_release_city_catalog.sql'), 'SELECT 1;', 'utf8');

      expect(() => getNextMigrationMeta(migrationsDir)).toThrow(
        /Unjournaled migration file "0012_release_city_catalog.sql"|already exists on disk/,
      );
    });

    it('fails closed when migration files exist without their journal', () => {
      fs.rmSync(journalPath);

      const result = reconcileMigrationHistory(migrationsDir);

      expect(result.isValid).toBe(false);
      expect(result.errors).toContainEqual(expect.stringContaining('Migration journal is missing'));
      expect(() => getNextMigrationMeta(migrationsDir)).toThrow(/Migration history reconciliation failed closed/);
    });
  });

  describe('Refusal to Overwrite Unadvancing / Identical Releases', () => {
    it('refuses to publish when candidate snapshot has no changes and identical upstream version', () => {
      const unchangedRawRecords = baseCatalog.map((c) => ({
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

      // Candidate with same 2026.1.0 version as current catalog metadata
      const candidateSnapshot = createMockSnapshot(unchangedRawRecords, {
        upstreamVersion: '2026.1.0',
        lastModified: '2026-01-01',
      });

      expect(() =>
        publishReviewedRelease(baseCatalog, candidateSnapshot, {
          migrationsFolder: migrationsDir,
          catalogPath,
          snapshotPath,
        }),
      ).toThrow(/Publication refused: candidate snapshot contains no changes and does not advance/);

      // Verify no migration or catalog changes written
      expect(fs.existsSync(path.join(migrationsDir, '0012_release_city_catalog.sql'))).toBe(false);
    });
  });

  describe('Atomic Staging and Boundary Fault Injection with Instant Rollback', () => {
    const createCandidateWithAdvance = () => {
      // 1 recode: EG0101 -> EG0198
      // 1 retirement: EG0102
      // 1 update: EG0104
      const candidateRaw = baseCatalog
        .filter((c) => c.sourceCode !== 'EG0101' && c.sourceCode !== 'EG0102')
        .map((c) => {
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
              center_lat: 29.9601,
              center_lon: 31.2601,
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

      candidateRaw.push({
        adm2_name: 'New Administrative Capital Sector 1',
        adm2_name1: 'العاصمة الإدارية الجديدة قطاع 1',
        adm2_pcode: 'EG0198',
        adm1_name: 'Cairo',
        adm1_name1: 'القاهرة',
        adm1_pcode: 'EG01',
        adm0_name: 'Egypt',
        adm0_name1: 'مصر',
        adm0_pcode: 'EG',
        center_lat: 30.015,
        center_lon: 31.75,
      });

      const snapshot = createMockSnapshot(candidateRaw, {
        upstreamVersion: '2026.2.0',
        lastModified: '2026-06-20',
      });

      return {
        snapshot,
        options: {
          migrationsFolder: migrationsDir,
          catalogPath,
          snapshotPath,
          reviewedMetadata: {
            declaredOfficialCount: 350,
            governorateCount: 27,
          },
          identityTransfers: [
            {
              retiredCitySourceCode: 'EG0101',
              replacementCitySourceCode: 'EG0198',
              notes: 'Recoded EG0101 to EG0198',
            },
          ],
        },
      };
    };

    const boundaries = [
      'stage_catalog',
      'stage_snapshot',
      'stage_migration',
      'stage_journal',
      'replace_catalog',
      'replace_snapshot',
      'replace_migration',
      'replace_journal',
    ] as const;

    boundaries.forEach((boundary) => {
      it(`rolls back cleanly when a fault is injected at boundary: ${boundary}`, () => {
        const catalogBefore = fs.readFileSync(catalogPath, 'utf8');
        const snapshotBefore = fs.readFileSync(snapshotPath, 'utf8');
        const journalBefore = fs.readFileSync(journalPath, 'utf8');

        const { snapshot, options } = createCandidateWithAdvance();

        const faultHook: FaultInjectionHook = (stage) => {
          if (stage === boundary) {
            throw new Error(`Injected simulated fault at boundary: ${stage}`);
          }
        };

        expect(() =>
          publishReviewedRelease(baseCatalog, snapshot, {
            ...options,
            _faultInjectionHook: faultHook,
          }),
        ).toThrow(`Injected simulated fault at boundary: ${boundary}`);

        // 1. Assert catalog file is 100% restored and unchanged
        const catalogAfter = fs.readFileSync(catalogPath, 'utf8');
        expect(catalogAfter).toBe(catalogBefore);

        // 2. Assert snapshot file is 100% restored and unchanged
        const snapshotAfter = fs.readFileSync(snapshotPath, 'utf8');
        expect(snapshotAfter).toBe(snapshotBefore);

        // 3. Assert journal is 100% restored and unchanged
        const journalAfter = fs.readFileSync(journalPath, 'utf8');
        expect(journalAfter).toBe(journalBefore);

        // 4. Assert new migration SQL file does NOT exist on disk
        const targetMigrationPath = path.join(migrationsDir, '0012_release_city_catalog.sql');
        expect(fs.existsSync(targetMigrationPath)).toBe(false);

        // 5. Assert subsequent publication without fault succeeds cleanly
        const successResult = publishReviewedRelease(baseCatalog, snapshot, options);
        expect(successResult.migrationTag).toBe('0012_release_city_catalog');
        expect(fs.existsSync(successResult.migrationPath)).toBe(true);

        const journalUpdated = JSON.parse(fs.readFileSync(journalPath, 'utf8')) as MigrationJournal;
        expect(journalUpdated.entries).toHaveLength(13);
        expect(journalUpdated.entries[12].idx).toBe(12);
        expect(journalUpdated.entries[12].tag).toBe('0012_release_city_catalog');
      });
    });
  });

  describe('Deterministic Crash Recovery Manifest Handling', () => {
    it('automatically recovers from an interrupted publication before proceeding', () => {
      const catalogBefore = fs.readFileSync(catalogPath, 'utf8');

      // Simulate a process crash mid-publication that left backup files and an uncommitted migration
      const backupCatalogPath = `${catalogPath}.recovery.bak`;
      fs.writeFileSync(backupCatalogPath, catalogBefore, 'utf8');

      const danglingMigrationPath = path.join(migrationsDir, '0012_release_city_catalog.sql');
      fs.writeFileSync(danglingMigrationPath, '-- Unfinished migration SQL\n', 'utf8');

      const manifestPath = path.join(migrationsDir, '.publication-recovery-manifest.json');
      fs.writeFileSync(
        manifestPath,
        JSON.stringify(
          {
            stage: 'interrupted',
            timestamp: Date.now(),
            migrationPath: danglingMigrationPath,
            backups: [{ path: catalogPath, backupPath: backupCatalogPath }],
          },
          null,
          2,
        ),
        'utf8',
      );

      // Overwrite catalog with corrupted content to simulate partial write
      fs.writeFileSync(catalogPath, 'CORRUPTED PARTIAL WRITE', 'utf8');

      // Calling recoverInterruptedPublication directly or via getNextMigrationMeta/publishReviewedRelease
      const recovered = recoverInterruptedPublication(migrationsDir);
      expect(recovered).toBe(true);

      // Verify catalog was restored from backup
      expect(fs.readFileSync(catalogPath, 'utf8')).toBe(catalogBefore);

      // Verify dangling migration was removed
      expect(fs.existsSync(danglingMigrationPath)).toBe(false);

      // Verify recovery files were cleaned up
      expect(fs.existsSync(backupCatalogPath)).toBe(false);
      expect(fs.existsSync(manifestPath)).toBe(false);

      // Verify migration history is clean and ready for publication
      const meta = getNextMigrationMeta(migrationsDir);
      expect(meta.nextIdx).toBe(12);
    });
  });

  describe('End-to-End Publication Consistency', () => {
    it('exposes a mutually consistent catalog, snapshot, migration SQL, and journal entry', () => {
      const candidateRaw = baseCatalog
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

      candidateRaw.push({
        adm2_name: 'New Administrative Capital Sector 1',
        adm2_name1: 'العاصمة الإدارية الجديدة قطاع 1',
        adm2_pcode: 'EG0198',
        adm1_name: 'Cairo',
        adm1_name1: 'القاهرة',
        adm1_pcode: 'EG01',
        adm0_name: 'Egypt',
        adm0_name1: 'مصر',
        adm0_pcode: 'EG',
        center_lat: 30.015,
        center_lon: 31.75,
      });

      const snapshot = createMockSnapshot(candidateRaw, {
        upstreamVersion: '2026.2.0',
        lastModified: '2026-06-20',
      });

      const result = publishReviewedRelease(baseCatalog, snapshot, {
        migrationsFolder: migrationsDir,
        catalogPath,
        snapshotPath,
        reviewedMetadata: {
          declaredOfficialCount: 350,
          governorateCount: 27,
        },
        identityTransfers: [
          {
            retiredCitySourceCode: 'EG0101',
            replacementCitySourceCode: 'EG0198',
            notes: 'Recoded EG0101 to EG0198',
          },
        ],
      });

      expect(result.migrationTag).toBe('0012_release_city_catalog');
      expect(result.release.officialCount).toBe(350);
      expect(result.release.retiredCount).toBe(1);

      // Verify catalog on disk
      const publishedCatalog = JSON.parse(fs.readFileSync(catalogPath, 'utf8')) as CityCatalog;
      expect(publishedCatalog.metadata?.declaredOfficialCount).toBe(350);
      expect(publishedCatalog.records).toHaveLength(351); // 350 official + 1 retired

      // Verify snapshot on disk
      const publishedSnapshot = JSON.parse(fs.readFileSync(snapshotPath, 'utf8')) as CitySnapshot;
      expect(publishedSnapshot.metadata.upstreamVersion).toBe('2026.2.0');
      expect(publishedSnapshot.records).toHaveLength(350);

      // Verify migration SQL on disk
      const publishedSql = fs.readFileSync(result.migrationPath, 'utf8');
      expect(publishedSql).toContain('-- Migration: 0012_release_city_catalog.sql');
      expect(publishedSql).toContain("UPDATE cities SET source_code = 'EG0198' WHERE source_code = 'EG0101';");
      expect(publishedSql).toContain("UPDATE cities SET status = 'RETIRED' WHERE source_code IN ('EG0102');");
      expect(publishedSql).toContain('IF official_count != 350 THEN');

      // Verify journal on disk
      const publishedJournal = JSON.parse(fs.readFileSync(journalPath, 'utf8')) as MigrationJournal;
      expect(publishedJournal.entries).toHaveLength(13);
      expect(publishedJournal.entries[12].idx).toBe(12);
      expect(publishedJournal.entries[12].tag).toBe('0012_release_city_catalog');
    });

    it('initializes an empty migration history as a complete four-artifact release', () => {
      fs.rmSync(journalPath);
      for (const file of fs.readdirSync(migrationsDir)) {
        if (file.endsWith('.sql')) {
          fs.rmSync(path.join(migrationsDir, file));
        }
      }

      const candidateSnapshot = createAdvancedSnapshot();

      const result = publishReviewedRelease(baseCatalog, candidateSnapshot, {
        migrationsFolder: migrationsDir,
        catalogPath,
        snapshotPath,
      });

      expect(result.snapshotPath).toBe(snapshotPath);
      expect(result.journalUpdated).toBe(true);
      expect(fs.existsSync(catalogPath)).toBe(true);
      expect(fs.existsSync(snapshotPath)).toBe(true);
      expect(fs.existsSync(result.migrationPath)).toBe(true);
      expect(fs.existsSync(journalPath)).toBe(true);

      const journal = JSON.parse(fs.readFileSync(journalPath, 'utf8')) as MigrationJournal;
      expect(journal.entries).toEqual([expect.objectContaining({ idx: 0, tag: '0000_release_city_catalog' })]);
    });

    it('refuses to omit the source snapshot from a release artifact set', () => {
      const candidateSnapshot = createAdvancedSnapshot();
      const catalogBefore = fs.readFileSync(catalogPath, 'utf8');
      const snapshotBefore = fs.readFileSync(snapshotPath, 'utf8');
      const journalBefore = fs.readFileSync(journalPath, 'utf8');

      expect(() =>
        publishReviewedRelease(baseCatalog, candidateSnapshot, {
          migrationsFolder: migrationsDir,
          catalogPath,
          snapshotPath,
          writeSnapshot: false,
        }),
      ).toThrow(/source snapshot is mandatory/);

      expect(fs.readFileSync(catalogPath, 'utf8')).toBe(catalogBefore);
      expect(fs.readFileSync(snapshotPath, 'utf8')).toBe(snapshotBefore);
      expect(fs.readFileSync(journalPath, 'utf8')).toBe(journalBefore);
      expect(fs.existsSync(path.join(migrationsDir, '0012_release_city_catalog.sql'))).toBe(false);
    });
  });
});
