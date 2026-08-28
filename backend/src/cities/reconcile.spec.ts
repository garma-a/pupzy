/* eslint-disable @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-assignment, @typescript-eslint/require-await, @typescript-eslint/no-unsafe-return */
import {
  validateLegacyMappings,
  loadLegacyMappings,
  reconcileCities,
  generateReconcileMigrationSql,
  type LegacyCityMapping,
  type ExistingCityRow,
} from './reconcile';
import { getOfficialCatalog } from './catalog';
import { CitiesService } from './cities.service';
import { CitiesRepository } from './cities.repository';
import type { Cache } from 'cache-manager';

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
    expect(result.errors).toContainEqual(expect.stringContaining("Duplicate target sourceCode 'EG0126'"));
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
    expect(result.errors).toContainEqual(expect.stringContaining("Unknown target sourceCode 'EG9999_INVALID'"));
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

describe('generateReconcileMigrationSql', () => {
  const officialCatalog = getOfficialCatalog();

  it('rejects invalid legacy mappings before generating SQL', () => {
    const invalidMappings: LegacyCityMapping[] = [
      {
        legacyGovernorate: 'Cairo',
        legacyNameEnglish: 'Maadi',
        targetSourceCode: 'EG_NONEXISTENT',
      },
    ];

    expect(() => generateReconcileMigrationSql(invalidMappings, officialCatalog)).toThrow(
      /Legacy mapping validation failed/,
    );
  });

  it('generates deterministic Drizzle migration SQL containing complete offline statements and fail-closed checks', () => {
    const mappings = loadLegacyMappings();
    const sqlScript = generateReconcileMigrationSql(mappings, officialCatalog);

    expect(sqlScript).toContain('UPDATE cities');
    expect(sqlScript).toContain("status = 'LEGACY'");
    expect(sqlScript).toContain("status = 'OFFICIAL'");
    expect(sqlScript).toContain('UPDATE posts');
    expect(sqlScript).toContain('INSERT INTO cities');
    expect(sqlScript).toContain("WHERE status = 'OFFICIAL'");
    expect(sqlScript).toContain('351');
    expect(sqlScript).toContain('GET DIAGNOSTICS matched_count = ROW_COUNT');
    expect(sqlScript).toContain('matched 0 legacy rows');
    expect(sqlScript).toContain('matched % legacy rows (expected 1)');
    expect(sqlScript).toContain('duplicate legacy city identities found in database');
    expect(sqlScript).not.toContain('http://');
    expect(sqlScript).not.toContain('https://');
  });

  it('generates SQL correctly for a catalog with retired cities and custom official count', () => {
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

    const sqlScript = generateReconcileMigrationSql([], catalogObj);
    expect(sqlScript).toContain("'RETIRED'");
    expect(sqlScript).toContain('350 official cities');
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
          return { rows: [{ official_count: 351, governorate_count: 27, invalid_official_count: 0 }] };
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

  it('applies canonical corrections to already-official cities rather than skipping them', async () => {
    const existingOfficialId = '01916327-0000-7000-8000-000000000003';
    const existingCities: ExistingCityRow[] = [
      {
        id: existingOfficialId,
        nameEnglish: 'Old Name For Maadi',
        nameArabic: 'قديم',
        governorate: 'Cairo',
        sourceCode: 'EG0126', // already has source code
        status: 'OFFICIAL',
      },
    ];

    const updatedCities: any[] = [];
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
          return { rowCount: 1 };
        }
        if (sqlText.includes('INSERT INTO cities')) {
          return { rowCount: params.length / 8 };
        }
        if (sqlText.includes('official_count') || sqlText.includes('count(*) FILTER')) {
          return { rows: [{ official_count: 351, governorate_count: 27, invalid_official_count: 0 }] };
        }
        return { rows: [] };
      }),
    };

    const mockDb: any = {
      transaction: jest.fn().mockImplementation(async (cb) => cb(mockTx)),
    };

    await reconcileCities(mockDb, {
      catalog: officialCatalog,
      mappings: [],
    });

    // Verify canonical update was applied to existing official city
    const canonicalUpdate = updatedCities.find((u) => u.params.includes(existingOfficialId));
    expect(canonicalUpdate).toBeDefined();
    expect(canonicalUpdate.params).toContain('Nasr City'); // Canonical name for EG0126
  });

  it('aborts reconciliation when a reviewed mapping matches 0 legacy rows in a populated database', async () => {
    const existingCities: ExistingCityRow[] = [
      {
        id: '01916327-0000-7000-8000-000000000001',
        nameEnglish: 'Some Other City',
        nameArabic: 'مدينة أخرى',
        governorate: 'Cairo',
        sourceCode: null,
        status: 'OFFICIAL',
      },
    ];

    const mappings: LegacyCityMapping[] = [
      {
        legacyGovernorate: 'Cairo',
        legacyNameEnglish: 'Maadi', // Does NOT exist in existingCities
        targetSourceCode: 'EG0126',
      },
    ];

    const mockTx: any = {
      query: jest.fn().mockImplementation(async (sqlText: string) => {
        if (sqlText.includes('SELECT id, name_english')) {
          return { rows: existingCities };
        }
        return { rows: [] };
      }),
    };

    const mockDb: any = {
      transaction: jest.fn().mockImplementation(async (cb) => cb(mockTx)),
    };

    await expect(
      reconcileCities(mockDb, {
        catalog: officialCatalog,
        mappings,
      }),
    ).rejects.toThrow(/matched 0 legacy rows/);
  });

  it('aborts reconciliation when duplicate legacy city identities exist in the database', async () => {
    const existingCities: ExistingCityRow[] = [
      {
        id: '01916327-0000-7000-8000-000000000001',
        nameEnglish: 'Maadi',
        nameArabic: 'المعادي',
        governorate: 'Cairo',
        sourceCode: null,
        status: 'OFFICIAL',
      },
      {
        id: '01916327-0000-7000-8000-000000000002',
        nameEnglish: 'Maadi', // DUPLICATE legacy identity in Cairo!
        nameArabic: 'المعادي 2',
        governorate: 'Cairo',
        sourceCode: null,
        status: 'OFFICIAL',
      },
    ];

    const mappings: LegacyCityMapping[] = [
      {
        legacyGovernorate: 'Cairo',
        legacyNameEnglish: 'Maadi',
        targetSourceCode: 'EG0126',
      },
    ];

    const mockTx: any = {
      query: jest.fn().mockImplementation(async (sqlText: string) => {
        if (sqlText.includes('SELECT id, name_english')) {
          return { rows: existingCities };
        }
        return { rows: [] };
      }),
    };

    const mockDb: any = {
      transaction: jest.fn().mockImplementation(async (cb) => cb(mockTx)),
    };

    await expect(
      reconcileCities(mockDb, {
        catalog: officialCatalog,
        mappings,
      }),
    ).rejects.toThrow(/duplicate legacy city identities found in database/);
  });

  it('aborts reconciliation when post-verification fails count or governorate checks', async () => {
    const mockTx: any = {
      query: jest.fn().mockImplementation(async (sqlText: string) => {
        if (sqlText.includes('SELECT id, name_english')) {
          return { rows: [] };
        }
        if (sqlText.includes('official_count') || sqlText.includes('count(*) FILTER')) {
          return { rows: [{ official_count: 300, governorate_count: 27, invalid_official_count: 0 }] }; // 300 != 351
        }
        return { rows: [] };
      }),
    };

    const mockDb: any = {
      transaction: jest.fn().mockImplementation(async (cb) => cb(mockTx)),
    };

    await expect(
      reconcileCities(mockDb, {
        catalog: officialCatalog,
        mappings: [],
      }),
    ).rejects.toThrow(/Reconciliation verification failed: expected 351 official cities, found 300/);
  });

  describe('Cache Coherence and Lifecycle Invalidation', () => {
    it('invalidates CitiesService cache post-commit so list and per-ID lookups return reconciled data', async () => {
      const legacyId = '01916327-0000-7000-8000-000000000001';
      const existingLegacy: ExistingCityRow = {
        id: legacyId,
        nameEnglish: 'Maadi',
        nameArabic: 'المعادي',
        governorate: 'Cairo',
        sourceCode: null,
        status: 'OFFICIAL',
      };

      // Set up in-memory cache and CitiesService
      const cacheStore = new Map<string, any>();
      const mockCache: jest.Mocked<Partial<Cache>> = {
        get: jest.fn().mockImplementation((k: string) => Promise.resolve(cacheStore.get(k))),
        set: jest.fn().mockImplementation((k: string, v: any) => {
          cacheStore.set(k, v);
          return Promise.resolve();
        }),
        del: jest.fn().mockImplementation((k: string) => {
          cacheStore.delete(k);
          return Promise.resolve();
        }),
      };

      const preReconcileCity = {
        ...existingLegacy,
        sourceNameEnglish: null,
        sourceNameArabic: null,
        centerPoint: [31.2, 30.0] as [number, number],
        createdAt: new Date(),
      };

      let currentDbCity: any = preReconcileCity;

      const mockRepo: jest.Mocked<Partial<CitiesRepository>> = {
        findAll: jest.fn().mockImplementation(() => Promise.resolve([currentDbCity])),
        findById: jest
          .fn()
          .mockImplementation((id: string) =>
            id === legacyId ? Promise.resolve(currentDbCity) : Promise.resolve(undefined),
          ),
        getCatalogRevision: jest.fn().mockResolvedValue(1),
        withCatalogRevision: jest
          .fn()
          .mockImplementation((callback: (revision: number, reader: CitiesRepository) => Promise<unknown>) =>
            callback(1, mockRepo as CitiesRepository),
          ),
      };

      const citiesService = new CitiesService(mockRepo as CitiesRepository, mockCache as Cache);

      // 1. Prime cache with pre-reconciliation values
      const preList = await citiesService.findAll();
      expect(preList[0].nameEnglish).toBe('Maadi');
      const preLookup = await citiesService.findById(legacyId);
      expect(preLookup?.nameEnglish).toBe('Maadi');
      expect(preLookup?.sourceCode).toBeNull();

      // 2. Perform reconciliation
      const mockTx: any = {
        query: jest.fn().mockImplementation(async (sqlText: string) => {
          if (sqlText.includes('SELECT id, name_english')) {
            return { rows: [existingLegacy] };
          }
          if (sqlText.includes('UPDATE cities SET')) {
            // Update db representation
            currentDbCity = {
              ...currentDbCity,
              sourceCode: 'EG0126',
              nameEnglish: 'Nasr City',
              sourceNameEnglish: 'Nasr City',
              sourceNameArabic: 'قسم أول مدينة نصر',
              status: 'OFFICIAL',
            };
            return { rowCount: 1 };
          }
          if (sqlText.includes('UPDATE posts SET governorate')) {
            return { rowCount: 1 };
          }
          if (sqlText.includes('INSERT INTO cities')) {
            return { rowCount: 1 };
          }
          if (sqlText.includes('official_count') || sqlText.includes('count(*) FILTER')) {
            return { rows: [{ official_count: 351, governorate_count: 27, invalid_official_count: 0 }] };
          }
          return { rows: [] };
        }),
      };

      const mockDb: any = {
        transaction: jest.fn().mockImplementation(async (cb) => cb(mockTx)),
      };

      await reconcileCities(mockDb, {
        catalog: officialCatalog,
        mappings: [
          {
            legacyGovernorate: 'Cairo',
            legacyNameEnglish: 'Maadi',
            targetSourceCode: 'EG0126',
          },
        ],
        clearCache: () => citiesService.clearCache(),
      });

      // 3. Post-reconciliation lookups must return fresh updated data from database
      const postList = await citiesService.findAll();
      expect(postList[0].nameEnglish).toBe('Nasr City');

      const postLookup = await citiesService.findById(legacyId);
      expect(postLookup?.nameEnglish).toBe('Nasr City');
      expect(postLookup?.sourceCode).toBe('EG0126');
    });

    it('leaves cache intact and safe to reuse when reconciliation fails', async () => {
      const cityId = '01916327-0000-7000-8000-000000000001';
      const existingCity = {
        id: cityId,
        nameEnglish: 'Pre-Failure Valid City',
        nameArabic: 'مدينة صحيحة',
        governorate: 'Cairo',
        sourceCode: 'EG0101',
        status: 'OFFICIAL' as const,
        sourceNameEnglish: 'Pre-Failure Valid City',
        sourceNameArabic: 'مدينة صحيحة',
        centerPoint: [31.2, 30.0] as [number, number],
        createdAt: new Date(),
      };

      const cacheStore = new Map<string, any>();
      const mockCache: jest.Mocked<Partial<Cache>> = {
        get: jest.fn().mockImplementation((k: string) => Promise.resolve(cacheStore.get(k))),
        set: jest.fn().mockImplementation((k: string, v: any) => {
          cacheStore.set(k, v);
          return Promise.resolve();
        }),
        del: jest.fn().mockImplementation((k: string) => {
          cacheStore.delete(k);
          return Promise.resolve();
        }),
      };

      const mockRepo: jest.Mocked<Partial<CitiesRepository>> = {
        findAll: jest.fn().mockResolvedValue([existingCity]),
        findById: jest.fn().mockResolvedValue(existingCity),
        getCatalogRevision: jest.fn().mockResolvedValue(1),
        withCatalogRevision: jest
          .fn()
          .mockImplementation((callback: (revision: number, reader: CitiesRepository) => Promise<unknown>) =>
            callback(1, mockRepo as CitiesRepository),
          ),
      };

      const citiesService = new CitiesService(mockRepo as CitiesRepository, mockCache as Cache);

      // Prime cache
      await citiesService.findAll();
      await citiesService.findById(cityId);
      expect(mockRepo.findAll).toHaveBeenCalledTimes(1);
      expect(mockRepo.findById).toHaveBeenCalledTimes(1);

      // Reconciliation that fails
      const mockTx: any = {
        query: jest.fn().mockImplementation(async (sqlText: string) => {
          if (sqlText.includes('SELECT id, name_english')) {
            // Duplicate identities to trigger rollback
            return {
              rows: [
                { id: '1', name_english: 'Maadi', governorate: 'Cairo', source_code: null },
                { id: '2', name_english: 'Maadi', governorate: 'Cairo', source_code: null },
              ],
            };
          }
          return { rows: [] };
        }),
      };

      const mockDb: any = {
        transaction: jest.fn().mockImplementation(async (cb) => cb(mockTx)),
      };

      let clearCacheCalled = false;
      const clearCacheTracker = jest.fn().mockImplementation(async () => {
        clearCacheCalled = true;
        await citiesService.clearCache();
      });

      await expect(
        reconcileCities(mockDb, {
          catalog: officialCatalog,
          mappings: [
            {
              legacyGovernorate: 'Cairo',
              legacyNameEnglish: 'Maadi',
              targetSourceCode: 'EG0126',
            },
          ],
          clearCache: clearCacheTracker,
        }),
      ).rejects.toThrow(/duplicate legacy city identities found in database/);

      // Verify clearCache was NEVER called
      expect(clearCacheCalled).toBe(false);
      expect(clearCacheTracker).not.toHaveBeenCalled();

      // Verify cached data remains unchanged and continues being served safely without db calls
      const cachedList = await citiesService.findAll();
      expect(cachedList).toEqual([existingCity]);
      expect(mockRepo.findAll).toHaveBeenCalledTimes(1); // No new db call!

      const cachedCity = await citiesService.findById(cityId);
      expect(cachedCity).toEqual(existingCity);
      expect(mockRepo.findById).toHaveBeenCalledTimes(1); // No new db call!
    });

    it('simulates process restart after reconciliation to verify immediate cache coherence', async () => {
      const cityId = '01916327-0000-7000-8000-000000000001';
      const reconciledCity = {
        id: cityId,
        nameEnglish: 'Reconciled Cairo',
        nameArabic: 'القاهرة المحدثة',
        governorate: 'Cairo',
        sourceCode: 'EG0101',
        status: 'OFFICIAL' as const,
        sourceNameEnglish: 'Reconciled Cairo',
        sourceNameArabic: 'القاهرة المحدثة',
        centerPoint: [31.2, 30.0] as [number, number],
        createdAt: new Date(),
      };

      const newRepo: jest.Mocked<Partial<CitiesRepository>> = {
        findAll: jest.fn().mockResolvedValue([reconciledCity]),
        findById: jest.fn().mockResolvedValue(reconciledCity),
        getCatalogRevision: jest.fn().mockResolvedValue(1),
        withCatalogRevision: jest
          .fn()
          .mockImplementation((callback: (revision: number, reader: CitiesRepository) => Promise<unknown>) =>
            callback(1, newRepo as CitiesRepository),
          ),
      };

      const freshCacheStore = new Map<string, any>();
      const freshCache: jest.Mocked<Partial<Cache>> = {
        get: jest.fn().mockImplementation((k: string) => Promise.resolve(freshCacheStore.get(k))),
        set: jest.fn().mockImplementation((k: string, v: any) => {
          freshCacheStore.set(k, v);
          return Promise.resolve();
        }),
        del: jest.fn().mockImplementation((k: string) => {
          freshCacheStore.delete(k);
          return Promise.resolve();
        }),
      };

      // Create new service instance simulating application restart
      const restartedService = new CitiesService(newRepo as CitiesRepository, freshCache as Cache);

      const list = await restartedService.findAll();
      expect(list).toEqual([reconciledCity]);
      expect(newRepo.findAll).toHaveBeenCalledTimes(1);

      const item = await restartedService.findById(cityId);
      expect(item).toEqual(reconciledCity);
      expect(newRepo.findById).toHaveBeenCalledWith(cityId);
    });
  });
});
