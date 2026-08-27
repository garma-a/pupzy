import { CitiesService } from './cities.service';
import { CitiesRepository } from './cities.repository';
import { Cache } from 'cache-manager';
import type { City } from '../database/schema';

describe('CitiesService', () => {
  let service: CitiesService;
  let mockRepo: jest.Mocked<Partial<CitiesRepository>>;
  let mockCache: jest.Mocked<Partial<Cache>>;

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

  beforeEach(() => {
    mockRepo = {
      findAll: jest.fn().mockResolvedValue([mockCity]),
      findById: jest.fn().mockResolvedValue(mockCity),
      findNearest: jest.fn().mockResolvedValue(mockCity),
      findByIds: jest.fn().mockResolvedValue([mockCity]),
    };

    mockCache = {
      get: jest.fn().mockResolvedValue(undefined),
      set: jest.fn().mockResolvedValue(undefined),
    };

    service = new CitiesService(mockRepo as CitiesRepository, mockCache as Cache);
  });

  describe('findAll', () => {
    it('returns cached list if present', async () => {
      mockCache.get = jest.fn().mockResolvedValue([mockCity]);

      const result = await service.findAll();
      expect(result).toEqual([mockCity]);
      expect(mockRepo.findAll).not.toHaveBeenCalled();
    });

    it('fetches from repository and sets cache on cache miss', async () => {
      const result = await service.findAll();
      expect(result).toEqual([mockCity]);
      expect(mockRepo.findAll).toHaveBeenCalled();
      expect(mockCache.set).toHaveBeenCalledWith('cities:all', [mockCity], 86_400_000);
    });
  });

  describe('findById', () => {
    it('returns cached city if present', async () => {
      mockCache.get = jest.fn().mockResolvedValue(mockCity);

      const result = await service.findById(mockCity.id);
      expect(result).toEqual(mockCity);
      expect(mockRepo.findById).not.toHaveBeenCalled();
    });

    it('fetches from repository and caches on cache miss', async () => {
      const result = await service.findById(mockCity.id);
      expect(result).toEqual(mockCity);
      expect(mockRepo.findById).toHaveBeenCalledWith(mockCity.id);
      expect(mockCache.set).toHaveBeenCalled();
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
    it('invalidates cities cache entries so fresh taxonomy is returned', async () => {
      mockCache.del = jest.fn().mockResolvedValue(undefined);

      await service.clearCache();

      expect(mockCache.del).toHaveBeenCalledWith('cities:all');
    });
  });

  describe('createCityByIdLoader', () => {
    it('creates DataLoader instance', () => {
      const loader = service.createCityByIdLoader();
      expect(loader).toBeDefined();
      expect(typeof loader.load).toBe('function');
    });
  });
});
