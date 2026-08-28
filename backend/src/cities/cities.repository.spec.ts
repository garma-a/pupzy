/* eslint-disable @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-argument, @typescript-eslint/no-unsafe-call */
import { CitiesRepository } from './cities.repository';
import { cities, cityCatalogRevisions, type City } from '../database/schema';
import { eq, inArray, asc } from 'drizzle-orm';

describe('CitiesRepository', () => {
  let repository: CitiesRepository;
  let mockDb: any;

  const officialCity: City = {
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

  const legacyCity: City = {
    id: '01916327-0000-7000-8000-000000000002',
    nameEnglish: 'Old Heliopolis',
    nameArabic: 'مصر الجديدة القديمة',
    governorate: 'Cairo',
    sourceCode: null,
    sourceNameEnglish: null,
    sourceNameArabic: null,
    status: 'LEGACY',
    centerPoint: [31.3262, 30.1015] as [number, number],
    createdAt: new Date(),
  };

  const retiredCity: City = {
    id: '01916327-0000-7000-8000-000000000003',
    nameEnglish: 'Retired District',
    nameArabic: 'حي ملغي',
    governorate: 'Cairo',
    sourceCode: 'EG0199',
    sourceNameEnglish: 'Retired District',
    sourceNameArabic: 'حي ملغي',
    status: 'RETIRED',
    centerPoint: [31.2, 30.0] as [number, number],
    createdAt: new Date(),
  };

  beforeEach(() => {
    mockDb = {
      select: jest.fn(),
    };
    repository = new CitiesRepository(mockDb);
  });

  describe('findAll', () => {
    it('filters for OFFICIAL cities only and sorts A-Z', async () => {
      const mockQueryBuilder = {
        from: jest.fn().mockReturnThis(),
        where: jest.fn().mockReturnThis(),
        orderBy: jest.fn().mockResolvedValue([officialCity]),
      };
      mockDb.select.mockReturnValue(mockQueryBuilder);

      const result = await repository.findAll();

      expect(mockDb.select).toHaveBeenCalled();
      expect(mockQueryBuilder.from).toHaveBeenCalledWith(cities);
      expect(mockQueryBuilder.where).toHaveBeenCalledWith(eq(cities.status, 'OFFICIAL'));
      expect(mockQueryBuilder.orderBy).toHaveBeenCalledWith(asc(cities.nameEnglish));
      expect(result).toEqual([officialCity]);
    });
  });

  describe('getCatalogRevision', () => {
    it('reads the singleton revision used to fence process-local City caches', async () => {
      const mockQueryBuilder = {
        from: jest.fn().mockReturnThis(),
        where: jest.fn().mockReturnThis(),
        limit: jest.fn().mockResolvedValue([{ revision: 2 }]),
      };
      mockDb.select.mockReturnValue(mockQueryBuilder);

      await expect(repository.getCatalogRevision()).resolves.toBe(2);
      expect(mockQueryBuilder.from).toHaveBeenCalledWith(cityCatalogRevisions);
      expect(mockQueryBuilder.limit).toHaveBeenCalledWith(1);
    });

    it('fails closed when the singleton revision state is absent', async () => {
      const mockQueryBuilder = {
        from: jest.fn().mockReturnThis(),
        where: jest.fn().mockReturnThis(),
        limit: jest.fn().mockResolvedValue([]),
      };
      mockDb.select.mockReturnValue(mockQueryBuilder);

      await expect(repository.getCatalogRevision()).rejects.toThrow('City catalog revision state is missing');
    });

    it('holds a shared revision lock while a cached City read is selected', async () => {
      const mockQueryBuilder = {
        from: jest.fn().mockReturnThis(),
        where: jest.fn().mockReturnThis(),
        for: jest.fn().mockReturnThis(),
        limit: jest.fn().mockResolvedValue([{ revision: 2 }]),
      };
      const transactionDb = { select: jest.fn().mockReturnValue(mockQueryBuilder) };
      const runTransaction = (callback: (db: typeof transactionDb) => Promise<number>): Promise<number> =>
        callback(transactionDb);
      mockDb.transaction = jest.fn().mockImplementation(runTransaction);

      await expect(repository.withCatalogRevision((revision) => Promise.resolve(revision))).resolves.toBe(2);
      expect(mockDb.transaction).toHaveBeenCalledTimes(1);
      expect(mockQueryBuilder.for).toHaveBeenCalledWith('share');
    });
  });

  describe('findNearest', () => {
    it('filters for OFFICIAL cities only and orders by PostGIS ST_Distance', async () => {
      const mockQueryBuilder = {
        from: jest.fn().mockReturnThis(),
        where: jest.fn().mockReturnThis(),
        orderBy: jest.fn().mockReturnThis(),
        limit: jest.fn().mockResolvedValue([officialCity]),
      };
      mockDb.select.mockReturnValue(mockQueryBuilder);

      const result = await repository.findNearest(30.0444, 31.2357);

      expect(mockDb.select).toHaveBeenCalled();
      expect(mockQueryBuilder.from).toHaveBeenCalledWith(cities);
      expect(mockQueryBuilder.where).toHaveBeenCalledWith(eq(cities.status, 'OFFICIAL'));
      expect(mockQueryBuilder.limit).toHaveBeenCalledWith(1);
      expect(result).toEqual(officialCity);
    });
  });

  describe('findById', () => {
    it('returns a city by UUID regardless of lifecycle status (supports legacy and retired for historical references)', async () => {
      const mockQueryBuilder = {
        from: jest.fn().mockReturnThis(),
        where: jest.fn().mockReturnThis(),
        limit: jest.fn().mockResolvedValue([legacyCity]),
      };
      mockDb.select.mockReturnValue(mockQueryBuilder);

      const result = await repository.findById(legacyCity.id);

      expect(mockDb.select).toHaveBeenCalled();
      expect(mockQueryBuilder.from).toHaveBeenCalledWith(cities);
      expect(mockQueryBuilder.where).toHaveBeenCalledWith(eq(cities.id, legacyCity.id));
      expect(mockQueryBuilder.limit).toHaveBeenCalledWith(1);
      expect(result).toEqual(legacyCity);
    });

    it('returns retired city when looked up directly by historical UUID', async () => {
      const mockQueryBuilder = {
        from: jest.fn().mockReturnThis(),
        where: jest.fn().mockReturnThis(),
        limit: jest.fn().mockResolvedValue([retiredCity]),
      };
      mockDb.select.mockReturnValue(mockQueryBuilder);

      const result = await repository.findById(retiredCity.id);
      expect(result).toEqual(retiredCity);
    });
  });

  describe('findByIds', () => {
    it('batch-loads cities by IDs including legacy and retired records, maintaining input order', async () => {
      const mockQueryBuilder = {
        from: jest.fn().mockReturnThis(),
        where: jest.fn().mockResolvedValue([retiredCity, officialCity, legacyCity]),
      };
      mockDb.select.mockReturnValue(mockQueryBuilder);

      const ids = [officialCity.id, legacyCity.id, retiredCity.id, 'missing-id'];
      const result = await repository.findByIds(ids);

      expect(mockDb.select).toHaveBeenCalled();
      expect(mockQueryBuilder.from).toHaveBeenCalledWith(cities);
      expect(mockQueryBuilder.where).toHaveBeenCalledWith(inArray(cities.id, ids));
      expect(result).toEqual([officialCity, legacyCity, retiredCity, null]);
    });

    it('returns empty array when given empty IDs array without querying database', async () => {
      const result = await repository.findByIds([]);
      expect(result).toEqual([]);
      expect(mockDb.select).not.toHaveBeenCalled();
    });
  });
});
