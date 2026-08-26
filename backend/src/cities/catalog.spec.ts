import { loadRawSnapshot, transformCatalog, validateCatalog, getOfficialCatalog } from './catalog';

describe('Offline Egyptian City Catalog and Transformation', () => {
  describe('Raw Snapshot', () => {
    it('contains the untouched 365-row ADM2 source snapshot with complete attribution metadata', () => {
      const snapshot = loadRawSnapshot();

      expect(snapshot).toBeDefined();
      expect(snapshot.metadata).toBeDefined();
      expect(snapshot.metadata.sourceUrl).toBe('https://data.humdata.org/dataset/cod-ab-egy');
      expect(snapshot.metadata.upstreamVersion).toBe('01');
      expect(snapshot.metadata.upstreamDates.validOn).toBe('2017-04-21');
      expect(snapshot.metadata.retrievalDate).toBe('2026-08-27');
      expect(snapshot.metadata.license).toContain('Creative Commons Attribution');
      expect(snapshot.metadata.attribution).toContain('CAPMAS');
      expect(snapshot.metadata.attribution).toContain('OCHA');
      expect(snapshot.metadata.totalRows).toBe(365);
      expect(snapshot.metadata.outsideZemamCount).toBe(14);
      expect(snapshot.metadata.selectableCount).toBe(351);
      expect(snapshot.metadata.governorateCount).toBe(27);

      expect(snapshot.records).toHaveLength(365);

      const outsideZemamRecords = snapshot.records.filter((r) => r.adm2_name === 'Zemam Out');
      expect(outsideZemamRecords).toHaveLength(14);
    });
  });

  describe('Deterministic Transformation', () => {
    it('transforms raw 365 rows into exactly 351 selectable cities by excluding 14 outside-zemam units', () => {
      const snapshot = loadRawSnapshot();
      const catalog = transformCatalog(snapshot);

      expect(catalog.records).toHaveLength(351);

      const zemamInCatalog = catalog.records.filter(
        (c) => c.nameEnglish.toLowerCase().includes('zemam') || c.sourceCode.endsWith('00'),
      );
      expect(zemamInCatalog).toHaveLength(0);
    });

    it('disambiguates duplicate English names within the same governorate using Kism/Markaz suffixes', () => {
      const snapshot = loadRawSnapshot();
      const catalog = transformCatalog(snapshot);

      const aswanKism = catalog.records.find((c) => c.sourceCode === 'EG2801');
      const aswanMarkaz = catalog.records.find((c) => c.sourceCode === 'EG2802');

      expect(aswanKism).toBeDefined();
      expect(aswanMarkaz).toBeDefined();
      expect(aswanKism?.nameEnglish).toBe('Aswan (Kism)');
      expect(aswanKism?.sourceNameEnglish).toBe('Aswan');
      expect(aswanKism?.nameArabic).toBe('قسم أسوان');
      expect(aswanKism?.sourceNameArabic).toBe('قسم أسوان');

      expect(aswanMarkaz?.nameEnglish).toBe('Aswan (Markaz)');
      expect(aswanMarkaz?.sourceNameEnglish).toBe('Aswan');
      expect(aswanMarkaz?.nameArabic).toBe('مركز أسوان');

      const faqusKism = catalog.records.find((c) => c.sourceCode === 'EG1311');
      const faqusMarkaz = catalog.records.find((c) => c.sourceCode === 'EG1312');
      expect(faqusKism?.nameEnglish).toBe('Faqus (Kism)');
      expect(faqusMarkaz?.nameEnglish).toBe('Faqus (Markaz)');

      const banhaKism = catalog.records.find((c) => c.sourceCode === 'EG1401');
      const banhaMarkaz = catalog.records.find((c) => c.sourceCode === 'EG1402');
      expect(banhaKism?.nameEnglish).toBe('Banha (Kism)');
      expect(banhaMarkaz?.nameEnglish).toBe('Banha (Markaz)');

      const gizaKism = catalog.records.find((c) => c.sourceCode === 'EG2104');
      const gizaMarkaz = catalog.records.find((c) => c.sourceCode === 'EG2109');
      expect(gizaKism?.nameEnglish).toBe('Giza (Kism)');
      expect(gizaMarkaz?.nameEnglish).toBe('Giza (Markaz)');
    });

    it('ensures every (nameEnglish, governorate) pair in the 351 catalog is strictly unique', () => {
      const catalog = getOfficialCatalog();
      const keys = catalog.map((c) => `${c.governorate}:${c.nameEnglish}`);
      const uniqueKeys = new Set(keys);

      expect(keys.length).toBe(351);
      expect(uniqueKeys.size).toBe(351);
    });
  });

  describe('Automated Validation Suite', () => {
    it('passes all automated validation checks for the official catalog', () => {
      const snapshot = loadRawSnapshot();
      const catalog = transformCatalog(snapshot);
      const validation = validateCatalog(catalog);

      expect(validation.isValid).toBe(true);
      expect(validation.errors).toHaveLength(0);
      expect(validation.stats.totalCities).toBe(351);
      expect(validation.stats.governorateCount).toBe(27);
    });

    it('validates schema length limits (<= 100 chars) and non-blank values', () => {
      const catalog = getOfficialCatalog();

      for (const city of catalog) {
        expect(city.nameEnglish.trim().length).toBeGreaterThan(0);
        expect(city.nameEnglish.length).toBeLessThanOrEqual(100);

        expect(city.nameArabic.trim().length).toBeGreaterThan(0);
        expect(city.nameArabic.length).toBeLessThanOrEqual(100);

        expect(city.governorate.trim().length).toBeGreaterThan(0);
        expect(city.governorate.length).toBeLessThanOrEqual(100);

        expect(city.sourceCode.trim().length).toBeGreaterThan(0);
        expect(city.sourceCode.length).toBeLessThanOrEqual(100);

        expect(city.sourceNameEnglish.trim().length).toBeGreaterThan(0);
        expect(city.sourceNameEnglish.length).toBeLessThanOrEqual(100);

        expect(city.sourceNameArabic.trim().length).toBeGreaterThan(0);
        expect(city.sourceNameArabic.length).toBeLessThanOrEqual(100);
      }
    });

    it('validates finite WGS84 coordinates within valid geographic bounds for Egypt', () => {
      const catalog = getOfficialCatalog();

      for (const city of catalog) {
        expect(Number.isFinite(city.latitude)).toBe(true);
        expect(Number.isFinite(city.longitude)).toBe(true);

        expect(city.latitude).toBeGreaterThanOrEqual(21.5);
        expect(city.latitude).toBeLessThanOrEqual(32.5);

        expect(city.longitude).toBeGreaterThanOrEqual(24.0);
        expect(city.longitude).toBeLessThanOrEqual(37.5);
      }
    });

    it('flags validation errors when constraints are violated', () => {
      const invalidCatalog = {
        records: [
          {
            sourceCode: 'EG0101',
            nameEnglish: 'Cairo',
            nameArabic: 'القاهرة',
            governorate: 'Cairo',
            governorateCode: 'EG01',
            sourceNameEnglish: 'Cairo',
            sourceNameArabic: 'القاهرة',
            latitude: 999, // invalid lat
            longitude: 31.2,
            status: 'OFFICIAL' as const,
          },
          {
            sourceCode: 'EG0101', // duplicate source code
            nameEnglish: 'Cairo', // duplicate name in Cairo
            nameArabic: '', // blank arabic name
            governorate: 'Cairo',
            governorateCode: 'EG01',
            sourceNameEnglish: 'Cairo',
            sourceNameArabic: 'القاهرة',
            latitude: 30.0,
            longitude: 31.2,
            status: 'OFFICIAL' as const,
          },
        ],
      };

      const result = validateCatalog(invalidCatalog);
      expect(result.isValid).toBe(false);
      expect(result.errors.length).toBeGreaterThanOrEqual(3);
    });
  });
});
