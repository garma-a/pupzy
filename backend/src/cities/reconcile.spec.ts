import {
  validateLegacyMappings,
  loadLegacyMappings,
  reconcileCities,
  generateReconcileMigrationSql,
  type LegacyCityMapping,
  type ExistingCityRow,
} from './reconcile';
import { getOfficialCatalog } from './catalog';

describe('Legacy City Mappings Validation', () => {
  const officialCatalog = getOfficialCatalog();

  it('validates a correct 1:1 legacy mapping against the official catalog', () => {
    const mappings: LegacyCityMapping[] = [
      {
        legacyGovernorate: 'Cairo',
        legacyNameEnglish: 'Maadi',
        targetSourceCode: 'EG0126', // El Maadi
      },
      {
        legacyGovernorate: 'Giza',
        legacyNameEnglish: 'Dokki',
        targetSourceCode: 'EG2103', // El Dokki
      },
      {
        legacyGovernorate: 'Cairo',
        legacyNameEnglish: 'Unknown Neighborhood',
        targetSourceCode: null, // explicit unmapped legacy
      },
    ];

    const result = validateLegacyMappings(mappings, officialCatalog);
    expect(result.isValid).toBe(true);
    expect(result.errors).toEqual([]);
    expect(result.mappedCount).toBe(2);
    expect(result.unmappedCount).toBe(1);
  });

  it('rejects duplicate legacy city definitions in the mapping table', () => {
    const mappings: LegacyCityMapping[] = [
      {
        legacyGovernorate: 'Cairo',
        legacyNameEnglish: 'Maadi',
        targetSourceCode: 'EG0126',
      },
      {
        legacyGovernorate: 'Cairo',
        legacyNameEnglish: 'Maadi',
        targetSourceCode: 'EG0126',
      },
    ];

    const result = validateLegacyMappings(mappings, officialCatalog);
    expect(result.isValid).toBe(false);
    expect(result.errors).toContainEqual(expect.stringContaining('Duplicate legacy entry'));
  });

  it('rejects ambiguous mappings that map multiple legacy cities to the same official source code', () => {
    const mappings: LegacyCityMapping[] = [
      {
        legacyGovernorate: 'Cairo',
        legacyNameEnglish: 'Maadi',
        targetSourceCode: 'EG0126',
      },
      {
        legacyGovernorate: 'Cairo',
        legacyNameEnglish: 'New Maadi',
        targetSourceCode: 'EG0126', // conflict!
      },
    ];

    const result = validateLegacyMappings(mappings, officialCatalog);
    expect(result.isValid).toBe(false);
    expect(result.errors).toContainEqual(
      expect.stringContaining("Duplicate target sourceCode 'EG0126'"),
    );
  });

  it('rejects mappings pointing to a nonexistent official source code', () => {
    const mappings: LegacyCityMapping[] = [
      {
        legacyGovernorate: 'Cairo',
        legacyNameEnglish: 'Maadi',
        targetSourceCode: 'EG9999_INVALID',
      },
    ];

    const result = validateLegacyMappings(mappings, officialCatalog);
    expect(result.isValid).toBe(false);
    expect(result.errors).toContainEqual(
      expect.stringContaining("Unknown target sourceCode 'EG9999_INVALID'"),
    );
  });

  it('validates the committed legacy-city-mappings.json file successfully', () => {
    const committedMappings = loadLegacyMappings();
    expect(committedMappings.length).toBeGreaterThan(0);
    const result = validateLegacyMappings(committedMappings, officialCatalog);
    expect(result.isValid).toBe(true);
    expect(result.errors).toEqual([]);
    expect(result.mappedCount).toBeGreaterThan(0);
  });
});

describe('reconcileCities', () => {
  const officialCatalog = getOfficialCatalog();

  it('reconciles existing legacy cities preserving UUIDs, marking unmapped as LEGACY, and inserting missing official cities', async () => {
    const legacyMaadiId = '01916327-0000-7000-8000-000000000001';
    const unmappedLegacyId = '01916327-0000-7000-8000-000000000002';

    const existingCities: ExistingCityRow[] = [
      {
        id: legacyMaadiId,
        nameEnglish: 'Maadi',
        nameArabic: 'المعادي',
        governorate: 'Cairo',
        sourceCode: null,
        status: 'OFFICIAL',
      },
      {
        id: unmappedLegacyId,
        nameEnglish: 'Custom Obsolete Neighborhood',
        nameArabic: 'حي قديم',
        governorate: 'Cairo',
        sourceCode: null,
        status: 'OFFICIAL',
      },
    ];

    const mappings: LegacyCityMapping[] = [
      {
        legacyGovernorate: 'Cairo',
        legacyNameEnglish: 'Maadi',
        targetSourceCode: 'EG0126', // El Maadi in Cairo
      },
      {
        legacyGovernorate: 'Cairo',
        legacyNameEnglish: 'Custom Obsolete Neighborhood',
        targetSourceCode: null, // explicit unmapped
      },
    ];

    const updatedCities: any[] = [];
    const insertedCities: any[] = [];
    const updatedPosts: any[] = [];
    let cacheCleared = false;

    const mockTx: any = {
      query: jest.fn().mockImplementation(async (sqlText: string, params: any[] = []) => {
        if (sqlText.includes('SELECT id, name_english')) {
          return { rows: existingCities };
        }
        if (sqlText.includes('UPDATE cities SET')) {
          updatedCities.push({ sqlText, params });
          return { rowCount: 1 };
        }
        if (sqlText.includes('UPDATE posts SET governorate')) {
          updatedPosts.push({ sqlText, params });
          return { rowCount: 1 };
        }
        if (sqlText.includes('INSERT INTO cities')) {
          insertedCities.push({ sqlText, params });
          return { rowCount: params.length / 8 };
        }
        if (sqlText.includes('official_count') || sqlText.includes('count(*) FILTER')) {
          return { rows: [{ official_count: 351, governorate_count: 27 }] };
        }
        return { rows: [] };
      }),
    };

    const mockDb: any = {
      transaction: jest.fn().mockImplementation(async (cb) => cb(mockTx)),
    };

    const result = await reconcileCities(mockDb, {
      catalog: officialCatalog,
      mappings,
      clearCache: async () => {
        cacheCleared = true;
      },
    });

    expect(result.matchedLegacyCount).toBe(1);
    expect(result.unmatchedLegacyCount).toBe(1);
    expect(result.insertedOfficialCount).toBe(350); // 351 - 1 matched
    expect(result.totalOfficialCities).toBe(351);
    expect(result.governorateCount).toBe(27);
    expect(cacheCleared).toBe(true);

    // Verify Maadi was updated with its original UUID preserved
    const maadiUpdate = updatedCities.find((u) => u.params.includes(legacyMaadiId));
    expect(maadiUpdate).toBeDefined();
    expect(maadiUpdate.params).toContain('EG0126');
    expect(maadiUpdate.params).toContain('OFFICIAL');

    // Verify unmapped legacy was updated to status = 'LEGACY'
    const legacyUpdate = updatedCities.find((u) => u.params.includes(unmappedLegacyId));
    expect(legacyUpdate).toBeDefined();
    expect(legacyUpdate.params).toContain('LEGACY');

    // Verify posts denormalized governorate update was invoked for matched city
    expect(updatedPosts.length).toBeGreaterThan(0);
    expect(updatedPosts[0].params).toContain(legacyMaadiId);
  });

  it('generates deterministic Drizzle migration SQL containing complete offline statements', () => {
    const mappings = loadLegacyMappings();
    const sqlScript = generateReconcileMigrationSql(mappings, officialCatalog);

    expect(sqlScript).toContain('UPDATE cities');
    expect(sqlScript).toContain("status = 'LEGACY'");
    expect(sqlScript).toContain("status = 'OFFICIAL'");
    expect(sqlScript).toContain('UPDATE posts');
    expect(sqlScript).toContain('INSERT INTO cities');
    expect(sqlScript).toContain("WHERE status = 'OFFICIAL'");
    expect(sqlScript).toContain('351');
    expect(sqlScript).not.toContain('http://');
    expect(sqlScript).not.toContain('https://');
  });

  it('reconciles and generates SQL correctly for a catalog with retired cities and custom official count', async () => {
    // 350 official + 1 retired
    const [retiredCity, ...remainingOfficial] = officialCatalog;
    const modifiedCatalog = [
      {
        ...retiredCity,
        status: 'RETIRED' as const,
      },
      ...remainingOfficial,
    ];

    const catalogObj = {
      metadata: {
        declaredOfficialCount: 350,
        governorateCount: 27,
      },
      records: modifiedCatalog,
    };

    const mockTx: any = {
      query: jest.fn().mockImplementation(async (sqlText: string) => {
        if (sqlText.includes('SELECT id, name_english')) {
          return { rows: [] };
        }
        if (sqlText.includes('official_count')) {
          return { rows: [{ official_count: 350, governorate_count: 27 }] };
        }
        return { rows: [] };
      }),
    };

    const mockDb: any = {
      transaction: jest.fn().mockImplementation(async (cb) => cb(mockTx)),
    };

    const result = await reconcileCities(mockDb, {
      catalog: catalogObj,
      mappings: [],
    });

    expect(result.totalOfficialCities).toBe(350);
    expect(result.governorateCount).toBe(27);
    expect(result.insertedOfficialCount).toBe(351);

    const sqlScript = generateReconcileMigrationSql([], catalogObj);
    expect(sqlScript).toContain("'RETIRED'");
    expect(sqlScript).toContain('350 official cities');
  });
});
