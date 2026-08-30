import { VetClinicsRepository } from './vet-clinics.repository';
import { vetClinics, cities, cityCatalogRevisions } from '../database/schema';
import { eq } from 'drizzle-orm';
import type { NodePgDatabase } from 'drizzle-orm/node-postgres';
import type * as schema from '../database/schema';

describe('VetClinicsRepository', () => {
  let repository: VetClinicsRepository;
  let mockDb: {
    select: jest.Mock;
    transaction: jest.Mock;
  };

  const mockClinic = {
    id: 'clinic-uuid-1',
    nameEnglish: 'Happy Paws Clinic',
    nameArabic: 'عيادة المخالب السعيدة',
    cityId: 'city-cairo',
    phoneNumber: '+201001234567',
    address: '123 Main St',
    addressEnglish: '123 Main St',
    addressArabic: '١٢٣ شارع رئيسي',
    website: 'https://happypaws.eg',
    latitude: 30.0444,
    longitude: 31.2357,
    distanceKm: 1.2,
  };

  beforeEach(() => {
    mockDb = {
      select: jest.fn(),
      transaction: jest.fn(),
    };
    repository = new VetClinicsRepository(mockDb as unknown as NodePgDatabase<typeof schema>);
  });

  describe('getCatalogRevision', () => {
    it('reads the singleton revision from city_catalog_revisions', async () => {
      const mockQueryBuilder = {
        from: jest.fn().mockReturnThis(),
        where: jest.fn().mockReturnThis(),
        limit: jest.fn().mockResolvedValue([{ revision: 3 }]),
      };
      mockDb.select.mockReturnValue(mockQueryBuilder);

      await expect(repository.getCatalogRevision()).resolves.toBe(3);
      expect(mockDb.select).toHaveBeenCalled();
      expect(mockQueryBuilder.from).toHaveBeenCalledWith(cityCatalogRevisions);
      expect(mockQueryBuilder.limit).toHaveBeenCalledWith(1);
    });

    it('fails closed when catalog revision state is missing', async () => {
      const mockQueryBuilder = {
        from: jest.fn().mockReturnThis(),
        where: jest.fn().mockReturnThis(),
        limit: jest.fn().mockResolvedValue([]),
      };
      mockDb.select.mockReturnValue(mockQueryBuilder);

      await expect(repository.getCatalogRevision()).rejects.toThrow('Catalog revision state is missing');
    });
  });

  describe('withCatalogRevision', () => {
    it('holds a shared revision lock while queries execute inside transaction', async () => {
      const mockQueryBuilder = {
        from: jest.fn().mockReturnThis(),
        where: jest.fn().mockReturnThis(),
        for: jest.fn().mockReturnThis(),
        limit: jest.fn().mockResolvedValue([{ revision: 5 }]),
      };

      const mockClinicQueryBuilder = {
        from: jest.fn().mockReturnThis(),
        where: jest.fn().mockReturnThis(),
        orderBy: jest.fn().mockReturnThis(),
        limit: jest.fn().mockResolvedValue([mockClinic]),
      };

      const transactionDb = {
        select: jest.fn().mockImplementation(() => mockQueryBuilder),
      };

      mockDb.transaction = jest
        .fn()
        .mockImplementation((callback: (tx: unknown) => unknown) => callback(transactionDb));

      const result = await repository.withCatalogRevision(async (revision, reader) => {
        expect(revision).toBe(5);
        transactionDb.select = jest.fn().mockReturnValue(mockClinicQueryBuilder);
        return reader.findNearest(30.0444, 31.2357);
      });

      expect(mockDb.transaction).toHaveBeenCalledTimes(1);
      expect(mockQueryBuilder.for).toHaveBeenCalledWith('share');
      expect(result).toEqual([mockClinic]);
    });
  });

  describe('findNearest and findNearestForCity', () => {
    it('executes findNearest with active filter and limit', async () => {
      const mockQueryBuilder = {
        from: jest.fn().mockReturnThis(),
        where: jest.fn().mockReturnThis(),
        orderBy: jest.fn().mockReturnThis(),
        limit: jest.fn().mockResolvedValue([mockClinic]),
      };
      mockDb.select.mockReturnValue(mockQueryBuilder);

      const result = await repository.findNearest(30.0444, 31.2357, 3);
      expect(mockDb.select).toHaveBeenCalled();
      expect(mockQueryBuilder.from).toHaveBeenCalledWith(vetClinics);
      expect(mockQueryBuilder.where).toHaveBeenCalledWith(eq(vetClinics.isActive, true));
      expect(mockQueryBuilder.limit).toHaveBeenCalledWith(3);
      expect(result).toEqual([mockClinic]);
    });

    it('executes findNearestForCity joining cities on cityId', async () => {
      const mockQueryBuilder = {
        from: jest.fn().mockReturnThis(),
        innerJoin: jest.fn().mockReturnThis(),
        where: jest.fn().mockReturnThis(),
        orderBy: jest.fn().mockReturnThis(),
        limit: jest.fn().mockResolvedValue([mockClinic]),
      };
      mockDb.select.mockReturnValue(mockQueryBuilder);

      const result = await repository.findNearestForCity('city-cairo', 15);
      expect(mockDb.select).toHaveBeenCalled();
      expect(mockQueryBuilder.from).toHaveBeenCalledWith(vetClinics);
      expect(mockQueryBuilder.innerJoin).toHaveBeenCalledWith(cities, eq(cities.id, 'city-cairo'));
      expect(mockQueryBuilder.where).toHaveBeenCalledWith(eq(vetClinics.isActive, true));
      expect(mockQueryBuilder.limit).toHaveBeenCalledWith(15);
      expect(result).toEqual([mockClinic]);
    });
  });
});
