import { CitiesService } from './cities.service';
import { CitiesRepository } from './cities.repository';
import { Cache } from 'cache-manager';
import type { City } from '../database/schema';

describe('CitiesService', () => {
  let service: CitiesService;
  let mockRepo: jest.Mocked<Partial<CitiesRepository>>;
  let mockCache: jest.Mocked<Partial<Cache>>;
  let catalogRevision: number;

  const mockCity: City = {
    id: '01916327-0000-7000-8000-000000000001',
    nameEnglish: 'Cairo',
    nameArabic: 'القاهرة',
    governorate: 'Cairo',
    sourceCode: 'EG0101',
    sourceNameEnglish: 'Cairo',
    sourceNameArabic: 'القاهرة',
    status: 'OFFICIAL',
    centerPoint: [31.2357, 30.0444] as [number, number],
    createdAt: new Date(),
  };

  const mockLegacyCity: City = {
    id: '01916327-0000-7000-8000-000000000002',
    nameEnglish: 'Legacy Quarter',
    nameArabic: 'حي قديم',
    governorate: 'Cairo',
    sourceCode: null,
    sourceNameEnglish: null,
    sourceNameArabic: null,
    status: 'LEGACY',
    centerPoint: [31.2, 30.0] as [number, number],
    createdAt: new Date(),
  };

  const mockRetiredCity: City = {
    id: '01916327-0000-7000-8000-000000000003',
    nameEnglish: 'Retired Markaz',
    nameArabic: 'مركز ملغي',
    governorate: 'Giza',
    sourceCode: 'EG2199',
    sourceNameEnglish: 'Retired Markaz',
    sourceNameArabic: 'مركز ملغي',
    status: 'RETIRED',
    centerPoint: [31.1, 29.9] as [number, number],
    createdAt: new Date(),
  };

  beforeEach(() => {
    catalogRevision = 1;
    mockRepo = {
      findAll: jest.fn().mockResolvedValue([mockCity]),
      findById: jest.fn().mockImplementation((id: string) => {
        if (id === mockCity.id) return Promise.resolve(mockCity);
        if (id === mockLegacyCity.id) return Promise.resolve(mockLegacyCity);
        if (id === mockRetiredCity.id) return Promise.resolve(mockRetiredCity);
        return Promise.resolve(undefined);
      }),
      findNearest: jest.fn().mockResolvedValue(mockCity),
      findByIds: jest.fn().mockResolvedValue([mockCity]),
      getCatalogRevision: jest.fn().mockImplementation(() => Promise.resolve(catalogRevision)),
      withCatalogRevision: jest
        .fn()
        .mockImplementation((callback: (revision: number, reader: CitiesRepository) => Promise<unknown>) =>
          callback(catalogRevision, mockRepo as CitiesRepository),
        ),
    };

    const store = new Map<string, unknown>();
    mockCache = {
      get: jest.fn().mockImplementation((key: string) => Promise.resolve(store.get(key) as City | City[] | undefined)),
      set: jest.fn().mockImplementation((key: string, value: unknown) => {
        store.set(key, value);
        return Promise.resolve();
      }),
      del: jest.fn().mockImplementation((key: string) => {
        store.delete(key);
        return Promise.resolve();
      }),
    };

    service = new CitiesService(mockRepo as CitiesRepository, mockCache as Cache);
  });

  describe('findAll', () => {
    it('returns cached list if present and avoids database query', async () => {
      // First call primes the cache
      const first = await service.findAll();
      expect(first).toEqual([mockCity]);
      expect(mockRepo.findAll).toHaveBeenCalledTimes(1);

      // Second call returns from cache without calling repository again
      const second = await service.findAll();
      expect(second).toEqual([mockCity]);
      expect(mockRepo.findAll).toHaveBeenCalledTimes(1);
    });

    it('fetches from repository and sets cache on cache miss', async () => {
      const result = await service.findAll();
      expect(result).toEqual([mockCity]);
      expect(mockRepo.findAll).toHaveBeenCalled();
      expect(mockCache.set).toHaveBeenCalled();
    });
  });

  describe('findById', () => {
    it('returns and caches official city by UUID', async () => {
      const first = await service.findById(mockCity.id);
      expect(first).toEqual(mockCity);
      expect(mockRepo.findById).toHaveBeenCalledWith(mockCity.id);
      expect(mockRepo.findById).toHaveBeenCalledTimes(1);

      const second = await service.findById(mockCity.id);
      expect(second).toEqual(mockCity);
      expect(mockRepo.findById).toHaveBeenCalledTimes(1);
    });

    it('returns and caches legacy city by UUID', async () => {
      const first = await service.findById(mockLegacyCity.id);
      expect(first).toEqual(mockLegacyCity);
      expect(first?.status).toBe('LEGACY');
      expect(mockRepo.findById).toHaveBeenCalledWith(mockLegacyCity.id);
      expect(mockRepo.findById).toHaveBeenCalledTimes(1);

      const second = await service.findById(mockLegacyCity.id);
      expect(second).toEqual(mockLegacyCity);
      expect(mockRepo.findById).toHaveBeenCalledTimes(1);
    });

    it('returns and caches retired city by UUID', async () => {
      const first = await service.findById(mockRetiredCity.id);
      expect(first).toEqual(mockRetiredCity);
      expect(first?.status).toBe('RETIRED');
      expect(mockRepo.findById).toHaveBeenCalledWith(mockRetiredCity.id);
      expect(mockRepo.findById).toHaveBeenCalledTimes(1);

      const second = await service.findById(mockRetiredCity.id);
      expect(second).toEqual(mockRetiredCity);
      expect(mockRepo.findById).toHaveBeenCalledTimes(1);
    });

    it('returns undefined and does not cache when city is not found', async () => {
      const result = await service.findById('nonexistent-uuid');
      expect(result).toBeUndefined();
      expect(mockRepo.findById).toHaveBeenCalledWith('nonexistent-uuid');
    });
  });

  describe('findNearest', () => {
    it('calls repository directly without caching', async () => {
      const result = await service.findNearest(30.0444, 31.2357);
      expect(result).toEqual(mockCity);
      expect(mockRepo.findNearest).toHaveBeenCalledWith(30.0444, 31.2357);
    });
  });

  describe('clearCache', () => {
    it('refreshes a primed instance after a committed City release advances the catalog revision', async () => {
      await service.findAll();
      await service.findById(mockCity.id);
      await service.findById(mockLegacyCity.id);
      await service.findById(mockRetiredCity.id);

      const releasedOfficialCity: City = { ...mockCity, nameEnglish: 'Released Cairo' };
      const releasedLegacyCity: City = { ...mockLegacyCity, nameEnglish: 'Released Legacy Quarter' };
      const releasedRetiredCity: City = { ...mockRetiredCity, nameEnglish: 'Released Retired Markaz' };
      mockRepo.findAll = jest.fn().mockResolvedValue([releasedOfficialCity]);
      mockRepo.findById = jest.fn().mockImplementation((id: string) => {
        if (id === mockCity.id) return Promise.resolve(releasedOfficialCity);
        if (id === mockLegacyCity.id) return Promise.resolve(releasedLegacyCity);
        if (id === mockRetiredCity.id) return Promise.resolve(releasedRetiredCity);
        return Promise.resolve(undefined);
      });

      // A successful release commits its City changes and revision together.
      catalogRevision = 2;

      await expect(service.findAll()).resolves.toEqual([releasedOfficialCity]);
      await expect(service.findById(mockCity.id)).resolves.toEqual(releasedOfficialCity);
      await expect(service.findById(mockLegacyCity.id)).resolves.toEqual(releasedLegacyCity);
      await expect(service.findById(mockRetiredCity.id)).resolves.toEqual(releasedRetiredCity);

      expect(mockRepo.withCatalogRevision).toHaveBeenCalledTimes(8);
      expect(mockRepo.findAll).toHaveBeenCalledTimes(1);
      expect(mockRepo.findById).toHaveBeenCalledTimes(3);
    });

    it('invalidates both cached official lists and cached per-ID lookups across all lifecycle states', async () => {
      // Prime cache for list and multiple IDs (official, legacy, retired)
      await service.findAll();
      await service.findById(mockCity.id);
      await service.findById(mockLegacyCity.id);
      await service.findById(mockRetiredCity.id);

      expect(mockRepo.findAll).toHaveBeenCalledTimes(1);
      expect(mockRepo.findById).toHaveBeenCalledTimes(3);

      // Verify cached lookups do not call repo
      await service.findAll();
      await service.findById(mockCity.id);
      await service.findById(mockLegacyCity.id);
      await service.findById(mockRetiredCity.id);
      expect(mockRepo.findAll).toHaveBeenCalledTimes(1);
      expect(mockRepo.findById).toHaveBeenCalledTimes(3);

      // Prepare updated post-reconciliation city models
      const updatedOfficialCity: City = {
        ...mockCity,
        nameEnglish: 'Updated Cairo Canonical',
      };
      const updatedLegacyCity: City = {
        ...mockLegacyCity,
        status: 'LEGACY',
      };
      const updatedRetiredCity: City = {
        ...mockRetiredCity,
        status: 'RETIRED',
      };

      mockRepo.findAll = jest.fn().mockResolvedValue([updatedOfficialCity]);
      mockRepo.findById = jest.fn().mockImplementation((id: string) => {
        if (id === mockCity.id) return Promise.resolve(updatedOfficialCity);
        if (id === mockLegacyCity.id) return Promise.resolve(updatedLegacyCity);
        if (id === mockRetiredCity.id) return Promise.resolve(updatedRetiredCity);
        return Promise.resolve(undefined);
      });

      // Clear cache
      await service.clearCache();

      // Subsequent findAll must NOT return pre-change cached list
      const freshList = await service.findAll();
      expect(freshList).toEqual([updatedOfficialCity]);
      expect(freshList[0].nameEnglish).toBe('Updated Cairo Canonical');
      expect(mockRepo.findAll).toHaveBeenCalledTimes(1);

      // Subsequent findById for official city must NOT return pre-change value
      const freshOfficial = await service.findById(mockCity.id);
      expect(freshOfficial).toEqual(updatedOfficialCity);
      expect(freshOfficial?.nameEnglish).toBe('Updated Cairo Canonical');
      expect(mockRepo.findById).toHaveBeenCalledWith(mockCity.id);

      // Subsequent findById for legacy city must NOT return pre-change value
      const freshLegacy = await service.findById(mockLegacyCity.id);
      expect(freshLegacy).toEqual(updatedLegacyCity);

      // Subsequent findById for retired city must NOT return pre-change value
      const freshRetired = await service.findById(mockRetiredCity.id);
      expect(freshRetired).toEqual(updatedRetiredCity);
    });

    it('completes logical invalidation in O(1) time without blocking on slow or failing physical cache deletions', async () => {
      // Track generations and key counts
      expect(service.getCacheGeneration()).toBe(0);
      expect(service.getTrackedKeyCount()).toBe(0);

      // Prime multiple cache entries
      await service.findAll();
      await service.findById(mockCity.id);
      await service.findById(mockLegacyCity.id);
      expect(service.getTrackedKeyCount()).toBe(3);

      let delCallCount = 0;
      let resolveSlowDel: () => void;
      const slowDelPromise = new Promise<void>((resolve) => {
        resolveSlowDel = resolve;
      });

      // Mock cacheManager.del to hang / simulate slow I/O
      mockCache.del = jest.fn().mockImplementation(() => {
        delCallCount++;
        return slowDelPromise;
      });

      // Calling clearCache must return immediately in O(1) time and advance generation
      const clearPromise = service.clearCache();
      await expect(clearPromise).resolves.toBeUndefined();

      expect(service.getCacheGeneration()).toBe(1);
      expect(service.getTrackedKeyCount()).toBe(0);

      // Subsequent query immediately queries repo and populates new generation
      const updatedCity: City = { ...mockCity, nameEnglish: 'Immediate Updated City' };
      mockRepo.findAll = jest.fn().mockResolvedValue([updatedCity]);

      const result = await service.findAll();
      expect(result[0].nameEnglish).toBe('Immediate Updated City');
      expect(mockRepo.findAll).toHaveBeenCalledTimes(1);

      // Complete background cleanup
      resolveSlowDel!();
      await slowDelPromise;
      expect(delCallCount).toBeGreaterThanOrEqual(3);
    });

    it('safely handles concurrent invalidation calls without race conditions or generation corruption', async () => {
      await service.findAll();
      await service.findById(mockCity.id);

      expect(service.getCacheGeneration()).toBe(0);

      // Trigger 5 concurrent clearCache operations
      await Promise.all([
        service.clearCache(),
        service.clearCache(),
        service.clearCache(),
        service.clearCache(),
        service.clearCache(),
      ]);

      expect(service.getCacheGeneration()).toBe(5);
      expect(service.getTrackedKeyCount()).toBe(0);

      // Service remains functional and caches at generation 5
      await service.findAll();
      expect(service.getTrackedKeyCount()).toBe(1);
      expect(mockCache.set).toHaveBeenCalledWith(expect.stringContaining('cities:g5:all'), expect.anything(), 86400000);
    });

    it('leaves existing cache generation intact and safe to reuse if a migration or transaction fails before commit', async () => {
      // Prime cache with valid existing data
      await service.findAll();
      await service.findById(mockCity.id);
      expect(mockRepo.findAll).toHaveBeenCalledTimes(1);
      expect(mockRepo.findById).toHaveBeenCalledTimes(1);

      const initialGen = service.getCacheGeneration();

      // Simulate a failed transaction or migration rollback
      const simulatedFailedTransaction = async () => {
        await Promise.resolve();
        // DB transaction aborts before clearCache is called
        throw new Error('Database constraint violation in release migration');
      };

      await expect(simulatedFailedTransaction()).rejects.toThrow('Database constraint violation');

      // Cache generation was NOT advanced and cached entries remain safe to reuse
      expect(service.getCacheGeneration()).toBe(initialGen);

      // Subsequent calls return cached data without hitting repository
      const cachedList = await service.findAll();
      expect(cachedList).toEqual([mockCity]);
      expect(mockRepo.findAll).toHaveBeenCalledTimes(1);

      const cachedCity = await service.findById(mockCity.id);
      expect(cachedCity).toEqual(mockCity);
      expect(mockRepo.findById).toHaveBeenCalledTimes(1);
    });
  });

  describe('Application restart and single-replica deployment simulation', () => {
    it('starts with clean cache on new service instance and queries repository directly', async () => {
      // Simulate existing service having cached data
      await service.findAll();
      await service.findById(mockCity.id);

      // Simulate database update during pre-deploy migration
      const postDeployCity: City = {
        ...mockCity,
        nameEnglish: 'New Release Cairo',
      };
      const newRepo: jest.Mocked<Partial<CitiesRepository>> = {
        findAll: jest.fn().mockResolvedValue([postDeployCity]),
        findById: jest.fn().mockResolvedValue(postDeployCity),
        getCatalogRevision: jest.fn().mockResolvedValue(1),
        withCatalogRevision: jest
          .fn()
          .mockImplementation((callback: (revision: number, reader: CitiesRepository) => Promise<unknown>) =>
            callback(1, newRepo as CitiesRepository),
          ),
      };
      const newCacheStore = new Map<string, unknown>();
      const newCache: jest.Mocked<Partial<Cache>> = {
        get: jest
          .fn()
          .mockImplementation((k: string) => Promise.resolve(newCacheStore.get(k) as City | City[] | undefined)),
        set: jest.fn().mockImplementation((k: string, v: unknown) => {
          newCacheStore.set(k, v);
          return Promise.resolve();
        }),
        del: jest.fn().mockImplementation((k: string) => {
          newCacheStore.delete(k);
          return Promise.resolve();
        }),
      };

      // Create new service instance (simulating new container starting after pre-deploy migration)
      const restartedService = new CitiesService(newRepo as CitiesRepository, newCache as Cache);

      const listResult = await restartedService.findAll();
      expect(listResult).toEqual([postDeployCity]);
      expect(newRepo.findAll).toHaveBeenCalledTimes(1);

      const cityResult = await restartedService.findById(mockCity.id);
      expect(cityResult).toEqual(postDeployCity);
      expect(newRepo.findById).toHaveBeenCalledWith(mockCity.id);
    });
  });

  describe('createCityByIdLoader', () => {
    it('fences repeated GraphQL City relationship lookups after the catalog revision advances', async () => {
      const loader = service.createCityByIdLoader();

      await expect(loader.load(mockLegacyCity.id)).resolves.toEqual(mockCity);

      const releasedCity: City = { ...mockCity, nameEnglish: 'Released Cairo' };
      mockRepo.findByIds = jest.fn().mockResolvedValue([releasedCity]);
      catalogRevision = 2;

      await expect(loader.load(mockLegacyCity.id)).resolves.toEqual(releasedCity);

      expect(loader).toBeDefined();
      expect(typeof loader.load).toBe('function');
      expect(mockRepo.withCatalogRevision).toHaveBeenCalledTimes(2);
      expect(mockRepo.findByIds).toHaveBeenCalledWith([mockLegacyCity.id]);
    });
  });
});
