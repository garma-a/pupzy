import { VetClinicsResolver, VetClinicsPostResolver } from './vet-clinics.resolver';
import { VetClinicsService, VetClinicDto } from './vet-clinics.service';
import type { Post, City } from '../database/schema';
import type { GqlContext } from '../common/types/gql-context.type';
import type { Request } from 'express';
import type { DataLoaders } from '../common/dataloaders/dataloaders.interface';
import DataLoader from 'dataloader';

describe('VetClinicsResolver & VetClinicsPostResolver', () => {
  let resolver: VetClinicsResolver;
  let postResolver: VetClinicsPostResolver;
  let mockVetClinicsService: jest.Mocked<Partial<VetClinicsService>>;
  let loadMock: jest.Mock<Promise<City | null>, [string]>;
  let mockCityLoader: DataLoader<string, City | null>;
  let mockContext: GqlContext;

  const mockCity: City = {
    id: '01916327-0000-7000-8000-000000000001',
    nameEnglish: 'Maadi',
    nameArabic: 'المعادي',
    governorate: 'Cairo',
    sourceCode: 'EG0101',
    sourceNameEnglish: 'Maadi',
    sourceNameArabic: 'المعادي',
    status: 'OFFICIAL',
    centerPoint: [31.2569, 29.9602],
    createdAt: new Date(),
  };

  const mockLegacyCity: City = {
    id: '01916327-0000-7000-8000-000000000002',
    nameEnglish: 'Old Helwan District',
    nameArabic: 'حي حلوان القديم',
    governorate: 'Cairo',
    sourceCode: null,
    sourceNameEnglish: null,
    sourceNameArabic: null,
    status: 'LEGACY',
    centerPoint: [31.33, 29.85],
    createdAt: new Date(),
  };

  const mockRetiredCity: City = {
    id: '01916327-0000-7000-8000-000000000003',
    nameEnglish: 'Superseded Markaz',
    nameArabic: 'مركز ملغي',
    governorate: 'Giza',
    sourceCode: 'EG0299',
    sourceNameEnglish: 'Superseded Markaz',
    sourceNameArabic: 'مركز ملغي',
    status: 'RETIRED',
    centerPoint: [31.2, 30.0],
    createdAt: new Date(),
  };

  const mockClinicDto: VetClinicDto = {
    id: 'clinic-1',
    nameEnglish: 'Maadi Vet Care',
    nameArabic: 'عيادة المعادي البيطرية',
    phoneNumber: '+201012345678',
    address: '10 Road 9, Maadi',
    addressEnglish: '10 Road 9, Maadi',
    addressArabic: '١٠ شارع ٩، المعادي',
    website: 'https://maadivet.eg',
    latitude: 29.9602,
    longitude: 31.2569,
    distanceKm: 1.2,
    googleMapsUrl: 'https://www.google.com/maps/search/?api=1&query=29.9602%2C31.2569',
    whatsappPhoneUrl: 'https://wa.me/201012345678',
    cityId: '01916327-0000-7000-8000-000000000001',
  };

  beforeEach(() => {
    mockVetClinicsService = {
      nearbyVetClinicsForCity: jest.fn().mockResolvedValue([mockClinicDto]),
      nearestVetClinicsForPost: jest.fn().mockResolvedValue([mockClinicDto]),
    };

    loadMock = jest.fn<Promise<City | null>, [string]>().mockResolvedValue(mockCity);
    mockCityLoader = {
      load: loadMock,
    } as unknown as DataLoader<string, City | null>;

    mockContext = {
      req: {} as Request,
      loaders: {
        cityById: mockCityLoader,
      } as unknown as DataLoaders,
    };

    resolver = new VetClinicsResolver(mockVetClinicsService as VetClinicsService);
    postResolver = new VetClinicsPostResolver(mockVetClinicsService as VetClinicsService);
  });

  describe('VetClinicsResolver', () => {
    it('delegates nearbyVetClinics query to service', async () => {
      const result = await resolver.nearbyVetClinics('city-cairo');
      expect(mockVetClinicsService.nearbyVetClinicsForCity).toHaveBeenCalledWith('city-cairo');
      expect(result).toEqual([mockClinicDto]);
    });

    it('resolves VetClinic.city via cityById DataLoader when cityId is present', async () => {
      const city = await resolver.city(mockClinicDto, mockContext);
      expect(loadMock).toHaveBeenCalledWith(mockClinicDto.cityId);
      expect(city).toEqual(mockCity);
      expect(city?.status).toBe('OFFICIAL');
      expect(city?.nameEnglish).toBe('Maadi');
      expect(city?.nameArabic).toBe('المعادي');
      expect(city?.governorate).toBe('Cairo');
    });

    it('returns null for VetClinic.city without invoking DataLoader when cityId is null', async () => {
      const clinicWithoutCity: VetClinicDto = {
        ...mockClinicDto,
        cityId: null,
      };

      const city = await resolver.city(clinicWithoutCity, mockContext);
      expect(city).toBeNull();
      expect(loadMock).not.toHaveBeenCalled();
    });

    it('resolves historical and legacy City references via DataLoader', async () => {
      loadMock.mockResolvedValue(mockLegacyCity);

      const clinicWithLegacyCity: VetClinicDto = {
        ...mockClinicDto,
        cityId: mockLegacyCity.id,
      };

      const city = await resolver.city(clinicWithLegacyCity, mockContext);
      expect(loadMock).toHaveBeenCalledWith(mockLegacyCity.id);
      expect(city).toEqual(mockLegacyCity);
      expect(city?.status).toBe('LEGACY');
    });

    it('resolves retired City references via DataLoader', async () => {
      loadMock.mockResolvedValue(mockRetiredCity);

      const clinicWithRetiredCity: VetClinicDto = {
        ...mockClinicDto,
        cityId: mockRetiredCity.id,
      };

      const city = await resolver.city(clinicWithRetiredCity, mockContext);
      expect(loadMock).toHaveBeenCalledWith(mockRetiredCity.id);
      expect(city).toEqual(mockRetiredCity);
      expect(city?.status).toBe('RETIRED');
    });
  });

  describe('VetClinicsPostResolver', () => {
    it('resolves Post.nearestVetClinics with array coordinates [lng, lat]', async () => {
      const mockPost = {
        id: 'post-1',
        postType: 'RESCUE',
        cityId: 'city-1',
        coordinates: [31.2569, 29.9602],
      } as unknown as Post;

      const result = await postResolver.nearestVetClinics(mockPost, mockContext);
      expect(mockVetClinicsService.nearestVetClinicsForPost).toHaveBeenCalledWith({
        id: 'post-1',
        postType: 'RESCUE',
        cityId: 'city-1',
        latitude: 29.9602,
        longitude: 31.2569,
      });
      expect(result).toEqual([mockClinicDto]);
    });

    it('resolves Post.nearestVetClinics with EWKT coordinates string', async () => {
      const mockPost = {
        id: 'post-2',
        postType: 'LOST',
        cityId: 'city-2',
        coordinates: 'SRID=4326;POINT(31.2357 30.0444)',
      } as unknown as Post;

      const result = await postResolver.nearestVetClinics(mockPost, mockContext);
      expect(mockVetClinicsService.nearestVetClinicsForPost).toHaveBeenCalledWith({
        id: 'post-2',
        postType: 'LOST',
        cityId: 'city-2',
        latitude: 30.0444,
        longitude: 31.2357,
      });
      expect(result).toEqual([mockClinicDto]);
    });

    it('handles non-array non-EWKT coordinates gracefully', async () => {
      const mockPost = {
        id: 'post-3',
        postType: 'ADOPTION',
        cityId: 'city-3',
        coordinates: null,
      } as unknown as Post;

      await postResolver.nearestVetClinics(mockPost, mockContext);
      expect(mockVetClinicsService.nearestVetClinicsForPost).toHaveBeenCalledWith({
        id: 'post-3',
        postType: 'ADOPTION',
        cityId: 'city-3',
        latitude: null,
        longitude: null,
      });
    });
  });
});
