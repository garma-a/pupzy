import { VetClinicsService } from './vet-clinics.service';
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
    expect(result[0].googleMapsUrl).toBe('https://maps.google.com/?q=29.9602,31.2569');
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
});
