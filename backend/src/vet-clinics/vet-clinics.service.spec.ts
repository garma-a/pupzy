import {
  VetClinicsService,
  buildGoogleMapsUrl,
  tryBuildGoogleMapsUrl,
  validateWgs84Coordinates,
  isValidWgs84Coordinates,
  GOOGLE_MAPS_SEARCH_BASE_URL,
  WGS84_BOUNDS,
} from './vet-clinics.service';
import { VetClinicsRepository, VetClinicProximityResult } from './vet-clinics.repository';
import { Cache } from 'cache-manager';

describe('VetClinicsService', () => {
  let service: VetClinicsService;
  let mockRepository: jest.Mocked<Partial<VetClinicsRepository>>;
  let mockCacheManager: jest.Mocked<Partial<Cache>>;
  let catalogRevision: number;

  const mockClinicResult: VetClinicProximityResult = {
    id: 'clinic-1',
    nameEnglish: 'Happy Paws Clinic',
    nameArabic: 'عيادة المخالب السعيدة',
    phoneNumber: '+201001234567',
    address: '123 Main St, Maadi',
    website: 'https://happypaws.eg',
    latitude: 29.9602,
    longitude: 31.2569,
    distanceKm: 1.25,
  };

  beforeEach(() => {
    catalogRevision = 1;
    mockRepository = {
      findNearest: jest.fn().mockResolvedValue([mockClinicResult]),
      findNearestForCity: jest.fn().mockResolvedValue([mockClinicResult]),
      getCatalogRevision: jest.fn().mockImplementation(() => Promise.resolve(catalogRevision)),
      withCatalogRevision: jest
        .fn()
        .mockImplementation((callback: (revision: number, reader: VetClinicsRepository) => Promise<unknown>) =>
          callback(catalogRevision, mockRepository as VetClinicsRepository),
        ),
    };

    mockCacheManager = {
      get: jest.fn().mockResolvedValue(undefined),
      set: jest.fn().mockResolvedValue(undefined),
      del: jest.fn().mockResolvedValue(undefined),
    };

    service = new VetClinicsService(mockRepository as VetClinicsRepository, mockCacheManager as Cache);
  });

  it('returns empty array immediately for PRODUCT posts without querying DB or cache', async () => {
    const result = await service.nearestVetClinicsForPost({
      id: 'post-1',
      postType: 'PRODUCT',
      cityId: 'city-1',
      latitude: 30.0,
      longitude: 31.0,
    });

    expect(result).toEqual([]);
    expect(mockCacheManager.get).not.toHaveBeenCalled();
    expect(mockRepository.findNearest).not.toHaveBeenCalled();
    expect(mockRepository.findNearestForCity).not.toHaveBeenCalled();
  });

  it('routes ADOPTION posts to findNearestForCity with city-level cache', async () => {
    mockRepository.findNearestForCity = jest.fn().mockResolvedValue([mockClinicResult]);

    const result = await service.nearestVetClinicsForPost({
      id: 'post-2',
      postType: 'ADOPTION',
      cityId: 'city-cairo',
      latitude: null,
      longitude: null,
    });

    expect(mockCacheManager.get).toHaveBeenCalledWith('vet:g0:city:city-cairo');
    expect(mockRepository.findNearestForCity).toHaveBeenCalledWith('city-cairo');
    expect(mockCacheManager.set).toHaveBeenCalledWith('vet:g0:city:city-cairo', expect.any(Array), 86_400_000);
    expect(result).toHaveLength(1);
    expect(result[0].googleMapsUrl).toBe('https://www.google.com/maps/search/?api=1&query=29.9602%2C31.2569');
    expect(result[0].whatsappPhoneUrl).toBe('https://wa.me/201001234567');
  });

  it('routes MATING posts to findNearestForCity with city-level cache', async () => {
    mockRepository.findNearestForCity = jest.fn().mockResolvedValue([mockClinicResult]);

    const result = await service.nearestVetClinicsForPost({
      id: 'post-mating-1',
      postType: 'MATING',
      cityId: 'city-giza',
      latitude: null,
      longitude: null,
    });

    expect(mockCacheManager.get).toHaveBeenCalledWith('vet:g0:city:city-giza');
    expect(mockRepository.findNearestForCity).toHaveBeenCalledWith('city-giza');
    expect(mockCacheManager.set).toHaveBeenCalledWith('vet:g0:city:city-giza', expect.any(Array), 86_400_000);
    expect(result).toHaveLength(1);
  });

  it('routes RESCUE posts to findNearest with post-level cache', async () => {
    mockRepository.findNearest = jest.fn().mockResolvedValue([mockClinicResult]);

    const result = await service.nearestVetClinicsForPost({
      id: 'post-rescue-1',
      postType: 'RESCUE',
      cityId: 'city-cairo',
      latitude: 30.0444,
      longitude: 31.2357,
    });

    expect(mockCacheManager.get).toHaveBeenCalledWith('vet:g0:post:post-rescue-1');
    expect(mockRepository.findNearest).toHaveBeenCalledWith(30.0444, 31.2357);
    expect(mockCacheManager.set).toHaveBeenCalledWith('vet:g0:post:post-rescue-1', expect.any(Array), 3_600_000);
    expect(result).toHaveLength(1);
  });

  it('returns cached data on cache hit without querying DB', async () => {
    const cachedDto = {
      id: 'clinic-1',
      nameEnglish: 'Cached Clinic',
      nameArabic: null,
      phoneNumber: null,
      address: null,
      addressEnglish: null,
      addressArabic: null,
      website: null,
      latitude: 29.96,
      longitude: 31.25,
      distanceKm: 0.5,
      googleMapsUrl: 'https://maps.google.com/?q=29.96,31.25',
      whatsappPhoneUrl: null,
      cityId: 'city-cairo',
    };
    mockCacheManager.get = jest.fn().mockResolvedValue([cachedDto]);

    const result = await service.nearestVetClinicsForPost({
      id: 'post-rescue-2',
      postType: 'RESCUE',
      cityId: 'city-cairo',
      latitude: 30.0444,
      longitude: 31.2357,
    });

    expect(result).toEqual([cachedDto]);
    expect(mockRepository.findNearest).not.toHaveBeenCalled();
  });

  it('handles cache errors gracefully and falls back to DB', async () => {
    mockCacheManager.get = jest.fn().mockRejectedValue(new Error('Redis connection error'));
    mockRepository.findNearest = jest.fn().mockResolvedValue([mockClinicResult]);

    const result = await service.nearestVetClinicsForPost({
      id: 'post-rescue-3',
      postType: 'RESCUE',
      cityId: 'city-cairo',
      latitude: 30.0444,
      longitude: 31.2357,
    });

    expect(result).toHaveLength(1);
    expect(mockRepository.findNearest).toHaveBeenCalledWith(30.0444, 31.2357);
  });

  it('returns up to 15 clinics for nearbyVetClinicsForCity with its own cache key', async () => {
    mockRepository.findNearestForCity = jest.fn().mockResolvedValue([mockClinicResult]);

    const result = await service.nearbyVetClinicsForCity('city-cairo');

    expect(mockCacheManager.get).toHaveBeenCalledWith('vet:g0:city:list:city-cairo');
    expect(mockRepository.findNearestForCity).toHaveBeenCalledWith('city-cairo', 15);
    expect(mockCacheManager.set).toHaveBeenCalledWith('vet:g0:city:list:city-cairo', expect.any(Array), 86_400_000);
    expect(result).toHaveLength(1);
  });

  it('returns cached data for nearbyVetClinicsForCity without querying DB', async () => {
    const cachedDto = {
      id: 'clinic-1',
      nameEnglish: 'Cached Clinic',
      nameArabic: null,
      phoneNumber: null,
      address: null,
      addressEnglish: null,
      addressArabic: null,
      website: null,
      latitude: 29.96,
      longitude: 31.25,
      distanceKm: 0.5,
      googleMapsUrl: 'https://maps.google.com/?q=29.96,31.25',
      whatsappPhoneUrl: null,
      cityId: 'city-cairo',
    };
    mockCacheManager.get = jest.fn().mockResolvedValue([cachedDto]);

    const result = await service.nearbyVetClinicsForCity('city-cairo');

    expect(result).toEqual([cachedDto]);
    expect(mockRepository.findNearestForCity).not.toHaveBeenCalled();
  });

  it('falls back to DB when cache GET fails for nearbyVetClinicsForCity', async () => {
    mockCacheManager.get = jest.fn().mockRejectedValue(new Error('Redis connection error'));
    mockRepository.findNearestForCity = jest.fn().mockResolvedValue([mockClinicResult]);

    const result = await service.nearbyVetClinicsForCity('city-cairo');

    expect(result).toHaveLength(1);
    expect(mockRepository.findNearestForCity).toHaveBeenCalledWith('city-cairo', 15);
  });

  it('uses a cache key distinct from the per-post ADOPTION/MATING city cache', async () => {
    mockRepository.findNearestForCity = jest.fn().mockResolvedValue([mockClinicResult]);

    await service.nearbyVetClinicsForCity('city-cairo');

    expect(mockCacheManager.get).toHaveBeenCalledWith('vet:g0:city:list:city-cairo');
    expect(mockCacheManager.get).not.toHaveBeenCalledWith('vet:g0:city:city-cairo');
  });

  it('maps bilingual addresses with backward-compatible fallback', async () => {
    const bilingualClinic: VetClinicProximityResult = {
      id: 'clinic-bilingual',
      nameEnglish: 'Bilingual Clinic',
      nameArabic: 'عيادة ثنائية اللغة',
      cityId: 'city-cairo',
      phoneNumber: null,
      address: null,
      addressEnglish: '123 Nile St, Maadi',
      addressArabic: '١٢٣ شارع النيل، المعادي',
      website: null,
      latitude: 29.96,
      longitude: 31.25,
      distanceKm: 0.8,
    };

    mockRepository.findNearest = jest.fn().mockResolvedValue([bilingualClinic]);

    const result = await service.nearestVetClinicsForPost({
      id: 'post-rescue-bilingual',
      postType: 'RESCUE',
      cityId: 'city-cairo',
      latitude: 30.0,
      longitude: 31.0,
    });

    expect(result).toHaveLength(1);
    expect(result[0].addressEnglish).toBe('123 Nile St, Maadi');
    expect(result[0].addressArabic).toBe('١٢٣ شارع النيل، المعادي');
    expect(result[0].address).toBe('123 Nile St, Maadi'); // Falls back to addressEnglish
    expect(result[0].cityId).toBe('city-cairo');
  });

  it('preserves imported clinic unlocalized address when localized fields are null', async () => {
    const importedClinic: VetClinicProximityResult = {
      id: 'clinic-imported',
      nameEnglish: 'Imported Clinic',
      nameArabic: null,
      cityId: 'city-alex',
      phoneNumber: null,
      address: 'Old single address string',
      addressEnglish: null,
      addressArabic: null,
      website: null,
      latitude: 31.2,
      longitude: 29.9,
      distanceKm: 2.1,
    };

    mockRepository.findNearest = jest.fn().mockResolvedValue([importedClinic]);

    const result = await service.nearestVetClinicsForPost({
      id: 'post-rescue-legacy',
      postType: 'RESCUE',
      cityId: 'city-alex',
      latitude: 31.2,
      longitude: 29.9,
    });

    expect(result).toHaveLength(1);
    expect(result[0].address).toBe('Old single address string');
    expect(result[0].addressEnglish).toBeNull();
    expect(result[0].addressArabic).toBeNull();
    expect(result[0].cityId).toBe('city-alex');
  });

  describe('catalog revision coherence and clearCache', () => {
    it('invalidates cache generation when database catalog revision advances', async () => {
      const store = new Map<string, unknown>();
      mockCacheManager.get = jest.fn().mockImplementation((key: string) => Promise.resolve(store.get(key)));
      mockCacheManager.set = jest.fn().mockImplementation((key: string, val: unknown) => {
        store.set(key, val);
        return Promise.resolve();
      });
      mockCacheManager.del = jest.fn().mockImplementation((key: string) => {
        store.delete(key);
        return Promise.resolve();
      });

      // Initial read at revision 1
      const initial = await service.nearbyVetClinicsForCity('city-cairo');
      expect(initial).toHaveLength(1);
      expect(mockRepository.findNearestForCity).toHaveBeenCalledTimes(1);
      expect(service.getCacheGeneration()).toBe(0);

      // Second read hits cache
      const cached = await service.nearbyVetClinicsForCity('city-cairo');
      expect(cached).toHaveLength(1);
      expect(mockRepository.findNearestForCity).toHaveBeenCalledTimes(1);

      // Admin mutation advances catalog revision to 2
      catalogRevision = 2;
      const updatedClinicResult: VetClinicProximityResult = {
        ...mockClinicResult,
        nameEnglish: 'Updated Happy Paws Clinic',
      };
      mockRepository.findNearestForCity = jest.fn().mockResolvedValue([updatedClinicResult]);

      // Next read observes new catalog revision, invalidates generation, and queries DB
      const fresh = await service.nearbyVetClinicsForCity('city-cairo');
      expect(fresh[0].nameEnglish).toBe('Updated Happy Paws Clinic');
      expect(service.getCacheGeneration()).toBe(1);
      expect(mockRepository.findNearestForCity).toHaveBeenCalledTimes(1);
    });

    it('clearCache advances cache generation index and clears tracked keys', async () => {
      expect(service.getCacheGeneration()).toBe(0);
      await service.clearCache();
      expect(service.getCacheGeneration()).toBe(1);
      expect(service.getTrackedKeyCount()).toBe(0);
    });
  });

  describe('buildGoogleMapsUrl & Shared Google Maps Contract', () => {
    it('generates canonical zero-key search URL with encoded comma in latitude,longitude order', () => {
      const url = buildGoogleMapsUrl(30.0444, 31.2357);
      expect(url).toBe('https://www.google.com/maps/search/?api=1&query=30.0444%2C31.2357');
      expect(url).not.toContain('key=');
      expect(url).not.toContain('api_key=');
      expect(GOOGLE_MAPS_SEARCH_BASE_URL).toBe('https://www.google.com/maps/search/');
    });

    it('rejects non-finite coordinates', () => {
      expect(() => buildGoogleMapsUrl(NaN, 31.2357)).toThrow(/Invalid WGS84 coordinates/);
      expect(() => buildGoogleMapsUrl(30.0444, Infinity)).toThrow(/Invalid WGS84 coordinates/);
    });

    it('rejects null, undefined, empty, or boolean coordinates', () => {
      expect(() => buildGoogleMapsUrl(null, 31.2357)).toThrow(/Invalid WGS84 coordinates/);
      expect(() => buildGoogleMapsUrl(30.0444, null)).toThrow(/Invalid WGS84 coordinates/);
      expect(() => buildGoogleMapsUrl(undefined, 31.2357)).toThrow(/Invalid WGS84 coordinates/);
      expect(() => buildGoogleMapsUrl(30.0444, undefined)).toThrow(/Invalid WGS84 coordinates/);
      expect(() => buildGoogleMapsUrl('', 31.2357)).toThrow(/Invalid WGS84 coordinates/);
      expect(() => buildGoogleMapsUrl(30.0444, '   ')).toThrow(/Invalid WGS84 coordinates/);
      expect(() => buildGoogleMapsUrl(false, 31.2357)).toThrow(/Invalid WGS84 coordinates/);
      expect(() => buildGoogleMapsUrl(30.0444, true)).toThrow(/Invalid WGS84 coordinates/);
    });

    it('rejects coordinates outside WGS84 latitude/longitude bounds', () => {
      expect(() => buildGoogleMapsUrl(91.0, 31.2357)).toThrow(/Invalid WGS84 coordinates/);
      expect(() => buildGoogleMapsUrl(-90.1, 31.2357)).toThrow(/Invalid WGS84 coordinates/);
      expect(() => buildGoogleMapsUrl(30.0444, 180.5)).toThrow(/Invalid WGS84 coordinates/);
      expect(() => buildGoogleMapsUrl(30.0444, -181.0)).toThrow(/Invalid WGS84 coordinates/);
    });

    it('validates WGS84 coordinates and boundaries accurately', () => {
      expect(validateWgs84Coordinates(30.0444, 31.2357)).toEqual({ latitude: 30.0444, longitude: 31.2357 });
      expect(isValidWgs84Coordinates(30.0444, 31.2357)).toBe(true);
      expect(isValidWgs84Coordinates(null, 31.2357)).toBe(false);
      expect(WGS84_BOUNDS.minLat).toBe(-90);
      expect(WGS84_BOUNDS.maxLat).toBe(90);
    });

    it('supports tryBuildGoogleMapsUrl for safe URL formatting', () => {
      expect(tryBuildGoogleMapsUrl(30.0444, 31.2357)).toBe(
        'https://www.google.com/maps/search/?api=1&query=30.0444%2C31.2357',
      );
      expect(tryBuildGoogleMapsUrl(null, 31.2357)).toBeNull();
      expect(tryBuildGoogleMapsUrl(95.0, 31.2357)).toBeNull();
    });
  });
});
