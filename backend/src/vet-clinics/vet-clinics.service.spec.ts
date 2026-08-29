import { VetClinicsService, buildGoogleMapsUrl } from './vet-clinics.service';
import { VetClinicsRepository, VetClinicProximityResult } from './vet-clinics.repository';
import { Cache } from 'cache-manager';

describe('VetClinicsService', () => {
  let service: VetClinicsService;
  let mockRepository: jest.Mocked<Partial<VetClinicsRepository>>;
  let mockCacheManager: jest.Mocked<Partial<Cache>>;

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
    mockRepository = {
      findNearest: jest.fn(),
      findNearestForCity: jest.fn(),
    };

    mockCacheManager = {
      get: jest.fn().mockResolvedValue(undefined),
      set: jest.fn().mockResolvedValue(undefined),
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

    expect(mockCacheManager.get).toHaveBeenCalledWith('vet:city:city-cairo');
    expect(mockRepository.findNearestForCity).toHaveBeenCalledWith('city-cairo');
    expect(mockCacheManager.set).toHaveBeenCalledWith('vet:city:city-cairo', expect.any(Array), 86_400_000);
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

    expect(mockCacheManager.get).toHaveBeenCalledWith('vet:city:city-giza');
    expect(mockRepository.findNearestForCity).toHaveBeenCalledWith('city-giza');
    expect(mockCacheManager.set).toHaveBeenCalledWith('vet:city:city-giza', expect.any(Array), 86_400_000);
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

    expect(mockCacheManager.get).toHaveBeenCalledWith('vet:post:post-rescue-1');
    expect(mockRepository.findNearest).toHaveBeenCalledWith(30.0444, 31.2357);
    expect(mockCacheManager.set).toHaveBeenCalledWith('vet:post:post-rescue-1', expect.any(Array), 3_600_000);
    expect(result).toHaveLength(1);
  });

  it('returns cached data on cache hit without querying DB', async () => {
    const cachedDto = {
      id: 'clinic-1',
      nameEnglish: 'Cached Clinic',
      nameArabic: null,
      phoneNumber: null,
      address: null,
      website: null,
      latitude: 29.96,
      longitude: 31.25,
      distanceKm: 0.5,
      googleMapsUrl: 'https://maps.google.com/?q=29.96,31.25',
      whatsappPhoneUrl: null,
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

    expect(mockCacheManager.get).toHaveBeenCalledWith('vet:city:list:city-cairo');
    expect(mockRepository.findNearestForCity).toHaveBeenCalledWith('city-cairo', 15);
    expect(mockCacheManager.set).toHaveBeenCalledWith('vet:city:list:city-cairo', expect.any(Array), 86_400_000);
    expect(result).toHaveLength(1);
  });

  it('returns cached data for nearbyVetClinicsForCity without querying DB', async () => {
    const cachedDto = {
      id: 'clinic-1',
      nameEnglish: 'Cached Clinic',
      nameArabic: null,
      phoneNumber: null,
      address: null,
      website: null,
      latitude: 29.96,
      longitude: 31.25,
      distanceKm: 0.5,
      googleMapsUrl: 'https://maps.google.com/?q=29.96,31.25',
      whatsappPhoneUrl: null,
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

    // Guards against the two features accidentally sharing a Redis key —
    // nearestVetClinicsForPost's ADOPTION/MATING path uses 'vet:city:{id}'
    // (see the test above: 'routes ADOPTION posts to findNearestForCity...'),
    // this standalone query must use a different key so a 3-result post-detail
    // cache entry and a 15-result browse-screen cache entry never collide.
    expect(mockCacheManager.get).toHaveBeenCalledWith('vet:city:list:city-cairo');
    expect(mockCacheManager.get).not.toHaveBeenCalledWith('vet:city:city-cairo');
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

  describe('buildGoogleMapsUrl', () => {
    it('generates canonical zero-key search URL with encoded comma in latitude,longitude order', () => {
      const url = buildGoogleMapsUrl(30.0444, 31.2357);
      expect(url).toBe('https://www.google.com/maps/search/?api=1&query=30.0444%2C31.2357');
      expect(url).not.toContain('key=');
      expect(url).not.toContain('api_key=');
    });

    it('rejects non-finite coordinates', () => {
      expect(() => buildGoogleMapsUrl(NaN, 31.2357)).toThrow(/Invalid WGS84 coordinates/);
      expect(() => buildGoogleMapsUrl(30.0444, Infinity)).toThrow(/Invalid WGS84 coordinates/);
    });

    it('rejects coordinates outside WGS84 latitude/longitude bounds', () => {
      expect(() => buildGoogleMapsUrl(91.0, 31.2357)).toThrow(/Invalid WGS84 coordinates/);
      expect(() => buildGoogleMapsUrl(-90.1, 31.2357)).toThrow(/Invalid WGS84 coordinates/);
      expect(() => buildGoogleMapsUrl(30.0444, 180.5)).toThrow(/Invalid WGS84 coordinates/);
      expect(() => buildGoogleMapsUrl(30.0444, -181.0)).toThrow(/Invalid WGS84 coordinates/);
    });
  });
});
