import { sql, eq } from 'drizzle-orm';
import { generateUuidV7 } from '../common/utils/generate-uuidv7';
import { TestDatabaseHelper } from '../../test/test-database.helper';
import { cities, vetClinics } from '../database/schema';
import { CitiesRepository } from '../cities/cities.repository';
import { CitiesService } from '../cities/cities.service';
import { VetClinicsResolver } from './vet-clinics.resolver';
import { VetClinicsService } from './vet-clinics.service';
import { VetClinicsRepository } from './vet-clinics.repository';
import type { Cache } from 'cache-manager';
import type { Request } from 'express';
import type { GqlContext } from '../common/types/gql-context.type';
import type { DataLoaders } from '../common/dataloaders/dataloaders.interface';

describe('Vet clinics schema & foreign key (integration)', () => {
  let dbHelper: TestDatabaseHelper;

  beforeAll(async () => {
    dbHelper = new TestDatabaseHelper();
    await dbHelper.start();
  }, 120_000);

  afterAll(async () => {
    await dbHelper.stop();
  });

  beforeEach(async () => {
    await dbHelper.clean();
  });

  async function insertOfficialCity(nameEnglish = 'Cairo', nameArabic = 'القاهرة') {
    const [city] = await dbHelper.db
      .insert(cities)
      .values({
        nameEnglish,
        nameArabic,
        governorate: nameEnglish,
        status: 'OFFICIAL',
        centerPoint: sql`ST_SetSRID(ST_MakePoint(31.2357, 30.0444), 4326)`,
      })
      .returning();
    return city;
  }

  it('rejects inserting a vet clinic with a nonexistent city_id foreign key', async () => {
    const fakeCityId = generateUuidV7();

    await expect(
      dbHelper.db.insert(vetClinics).values({
        nameEnglish: 'Nonexistent City Clinic',
        cityId: fakeCityId,
        coordinates: { longitude: 31.23, latitude: 30.04 },
        source: 'MANUAL',
      }),
    ).rejects.toMatchObject({
      cause: { code: '23503' }, // foreign_key_violation
    });
  });

  it('allows inserting a vet clinic with a valid official city foreign key and null city_id', async () => {
    const city = await insertOfficialCity();

    // 1. With valid official city
    const [clinicWithCity] = await dbHelper.db
      .insert(vetClinics)
      .values({
        nameEnglish: 'Official City Clinic',
        cityId: city.id,
        coordinates: { longitude: 31.23, latitude: 30.04 },
        source: 'MANUAL',
      })
      .returning();

    expect(clinicWithCity.id).toBeDefined();
    expect(clinicWithCity.cityId).toBe(city.id);

    // 2. With null city (import compatibility fallback)
    const [clinicNullCity] = await dbHelper.db
      .insert(vetClinics)
      .values({
        nameEnglish: 'Unassigned City Clinic',
        cityId: null,
        coordinates: { longitude: 31.23, latitude: 30.04 },
        source: 'OSM',
      })
      .returning();

    expect(clinicNullCity.id).toBeDefined();
    expect(clinicNullCity.cityId).toBeNull();
  });

  it('persists bilingual addresses, location provenance, capture time, and OSM identity', async () => {
    const city = await insertOfficialCity();
    const capturedAt = new Date();

    const [clinic] = await dbHelper.db
      .insert(vetClinics)
      .values({
        nameEnglish: 'Dokki Animal Hospital',
        nameArabic: 'مستشفى الدقي البيطري',
        cityId: city.id,
        coordinates: { longitude: 31.21, latitude: 30.04 },
        phoneNumber: '+201012345678',
        address: '15 Mossadak St, Dokki',
        addressEnglish: '15 Mossadak St, Dokki',
        addressArabic: '١٥ شارع مصدق، الدقي',
        locationProvenance: 'NOMINATIM',
        locationCapturedAt: capturedAt,
        osmType: 'node',
        osmId: 9876543210n,
        source: 'MANUAL',
      })
      .returning();

    expect(clinic.addressEnglish).toBe('15 Mossadak St, Dokki');
    expect(clinic.addressArabic).toBe('١٥ شارع مصدق، الدقي');
    expect(clinic.address).toBe('15 Mossadak St, Dokki');
    expect(clinic.locationProvenance).toBe('NOMINATIM');
    expect(clinic.osmType).toBe('node');
    expect(clinic.osmId).toBe(9876543210n);
    expect(clinic.locationCapturedAt?.toISOString()).toBe(capturedAt.toISOString());

    // Query back from DB
    const [fetched] = await dbHelper.db.select().from(vetClinics).where(eq(vetClinics.id, clinic.id));
    expect(fetched.nameArabic).toBe('مستشفى الدقي البيطري');
    expect(fetched.addressArabic).toBe('١٥ شارع مصدق، الدقي');
    expect(fetched.addressEnglish).toBe('15 Mossadak St, Dokki');
  });

  it('sets cityId to null when referenced city is deleted (ON DELETE SET NULL)', async () => {
    const city = await insertOfficialCity('Temporary City', 'مدينة مؤقتة');

    const [clinic] = await dbHelper.db
      .insert(vetClinics)
      .values({
        nameEnglish: 'Clinic in Temporary City',
        cityId: city.id,
        coordinates: { longitude: 31.23, latitude: 30.04 },
        source: 'OSM',
      })
      .returning();

    expect(clinic.cityId).toBe(city.id);

    // Delete city
    await dbHelper.db.delete(cities).where(eq(cities.id, city.id));

    // Surviving clinic has cityId = null
    const [survivingClinic] = await dbHelper.db.select().from(vetClinics).where(eq(vetClinics.id, clinic.id));
    expect(survivingClinic).toBeDefined();
    expect(survivingClinic.cityId).toBeNull();
  });

  describe('Complete City Data & DataLoader Resolution', () => {
    it('resolves complete City data (identity, names, governorate, status) across official, legacy, and retired lifecycles', async () => {
      // 1. Seed revision
      await dbHelper.pool.query(
        `INSERT INTO city_catalog_revisions (id, revision) VALUES (1, 1) ON CONFLICT (id) DO UPDATE SET revision = 1`,
      );

      // 2. Insert cities with each lifecycle status
      const [officialCity] = await dbHelper.db
        .insert(cities)
        .values({
          nameEnglish: 'Maadi',
          nameArabic: 'المعادي',
          governorate: 'Cairo',
          status: 'OFFICIAL',
          centerPoint: sql`ST_SetSRID(ST_MakePoint(31.2569, 29.9602), 4326)`,
        })
        .returning();

      const [legacyCity] = await dbHelper.db
        .insert(cities)
        .values({
          nameEnglish: 'Old Helwan District',
          nameArabic: 'حي حلوان القديم',
          governorate: 'Cairo',
          status: 'LEGACY',
          centerPoint: sql`ST_SetSRID(ST_MakePoint(31.33, 29.85), 4326)`,
        })
        .returning();

      const [retiredCity] = await dbHelper.db
        .insert(cities)
        .values({
          nameEnglish: 'Superseded Markaz',
          nameArabic: 'مركز ملغي',
          governorate: 'Giza',
          status: 'RETIRED',
          centerPoint: sql`ST_SetSRID(ST_MakePoint(31.2, 30.0), 4326)`,
        })
        .returning();

      // 3. Batch load cities via findByIds
      const citiesRepo = new CitiesRepository(dbHelper.db);
      const mockCache: jest.Mocked<Partial<Cache>> = {
        get: jest.fn(),
        set: jest.fn(),
        del: jest.fn(),
        reset: jest.fn(),
        wrap: jest.fn(),
      };
      const citiesService = new CitiesService(citiesRepo, mockCache as Cache);
      const cityLoader = citiesService.createCityByIdLoader();

      const vetRepo = new VetClinicsRepository(dbHelper.db);
      const vetService = new VetClinicsService(vetRepo, mockCache as Cache);
      const resolver = new VetClinicsResolver(vetService);

      const mockContext: GqlContext = {
        req: {} as Request,
        loaders: {
          cityById: cityLoader,
        } as unknown as DataLoaders,
      };

      // 4. Resolve official city
      const officialDto = {
        id: generateUuidV7(),
        nameEnglish: 'Official Clinic',
        nameArabic: 'عيادة رسمية',
        phoneNumber: null,
        address: '10 Road 9',
        addressEnglish: '10 Road 9',
        addressArabic: '١٠ شارع ٩',
        website: null,
        latitude: 29.9602,
        longitude: 31.2569,
        distanceKm: 0.5,
        googleMapsUrl: 'https://www.google.com/maps/search/?api=1&query=29.9602%2C31.2569',
        whatsappPhoneUrl: null,
        cityId: officialCity.id,
      };

      const resolvedOfficial = await resolver.city(officialDto, mockContext);
      expect(resolvedOfficial).toBeDefined();
      expect(resolvedOfficial?.id).toBe(officialCity.id);
      expect(resolvedOfficial?.nameEnglish).toBe('Maadi');
      expect(resolvedOfficial?.nameArabic).toBe('المعادي');
      expect(resolvedOfficial?.governorate).toBe('Cairo');
      expect(resolvedOfficial?.status).toBe('OFFICIAL');

      // 5. Resolve legacy city
      const legacyDto = {
        ...officialDto,
        id: generateUuidV7(),
        nameEnglish: 'Legacy Reference Clinic',
        cityId: legacyCity.id,
      };

      const resolvedLegacy = await resolver.city(legacyDto, mockContext);
      expect(resolvedLegacy).toBeDefined();
      expect(resolvedLegacy?.id).toBe(legacyCity.id);
      expect(resolvedLegacy?.nameEnglish).toBe('Old Helwan District');
      expect(resolvedLegacy?.nameArabic).toBe('حي حلوان القديم');
      expect(resolvedLegacy?.status).toBe('LEGACY');

      // 6. Resolve retired city
      const retiredDto = {
        ...officialDto,
        id: generateUuidV7(),
        nameEnglish: 'Retired Reference Clinic',
        cityId: retiredCity.id,
      };

      const resolvedRetired = await resolver.city(retiredDto, mockContext);
      expect(resolvedRetired).toBeDefined();
      expect(resolvedRetired?.id).toBe(retiredCity.id);
      expect(resolvedRetired?.nameEnglish).toBe('Superseded Markaz');
      expect(resolvedRetired?.status).toBe('RETIRED');

      // 7. Resolve null cityId without loading
      const nullCityDto = {
        ...officialDto,
        id: generateUuidV7(),
        cityId: null,
      };

      const resolvedNull = await resolver.city(nullCityDto, mockContext);
      expect(resolvedNull).toBeNull();
    });

    it('batches multiple VetClinic city resolutions in a single query via DataLoader', async () => {
      await dbHelper.pool.query(
        `INSERT INTO city_catalog_revisions (id, revision) VALUES (1, 1) ON CONFLICT (id) DO UPDATE SET revision = 1`,
      );

      const [cityA] = await dbHelper.db
        .insert(cities)
        .values({
          nameEnglish: 'City Alpha',
          nameArabic: 'مدينة ألفا',
          governorate: 'Cairo',
          status: 'OFFICIAL',
          centerPoint: sql`ST_SetSRID(ST_MakePoint(31.25, 30.0), 4326)`,
        })
        .returning();

      const [cityB] = await dbHelper.db
        .insert(cities)
        .values({
          nameEnglish: 'City Beta',
          nameArabic: 'مدينة بيتا',
          governorate: 'Giza',
          status: 'OFFICIAL',
          centerPoint: sql`ST_SetSRID(ST_MakePoint(31.2, 29.98), 4326)`,
        })
        .returning();

      const citiesRepo = new CitiesRepository(dbHelper.db);
      const spyWithCatalogRevision = jest.spyOn(citiesRepo, 'withCatalogRevision');

      const mockCache: jest.Mocked<Partial<Cache>> = {
        get: jest.fn(),
        set: jest.fn(),
        del: jest.fn(),
        reset: jest.fn(),
        wrap: jest.fn(),
      };
      const citiesService = new CitiesService(citiesRepo, mockCache as Cache);
      const cityLoader = citiesService.createCityByIdLoader();

      const vetRepo = new VetClinicsRepository(dbHelper.db);
      const vetService = new VetClinicsService(vetRepo, mockCache as Cache);
      const resolver = new VetClinicsResolver(vetService);

      const mockContext: GqlContext = {
        req: {} as Request,
        loaders: {
          cityById: cityLoader,
        } as unknown as DataLoaders,
      };

      const clinicDtos = [
        {
          id: 'c1',
          nameEnglish: 'Clinic 1',
          nameArabic: null,
          phoneNumber: null,
          address: null,
          addressEnglish: null,
          addressArabic: null,
          website: null,
          latitude: 30.0,
          longitude: 31.25,
          distanceKm: 0.1,
          googleMapsUrl: 'https://www.google.com/maps/search/?api=1&query=30%2C31.25',
          whatsappPhoneUrl: null,
          cityId: cityA.id,
        },
        {
          id: 'c2',
          nameEnglish: 'Clinic 2',
          nameArabic: null,
          phoneNumber: null,
          address: null,
          addressEnglish: null,
          addressArabic: null,
          website: null,
          latitude: 29.98,
          longitude: 31.2,
          distanceKm: 0.2,
          googleMapsUrl: 'https://www.google.com/maps/search/?api=1&query=29.98%2C31.2',
          whatsappPhoneUrl: null,
          cityId: cityB.id,
        },
        {
          id: 'c3',
          nameEnglish: 'Clinic 3',
          nameArabic: null,
          phoneNumber: null,
          address: null,
          addressEnglish: null,
          addressArabic: null,
          website: null,
          latitude: 30.01,
          longitude: 31.24,
          distanceKm: 0.3,
          googleMapsUrl: 'https://www.google.com/maps/search/?api=1&query=30.01%2C31.24',
          whatsappPhoneUrl: null,
          cityId: cityA.id, // duplicate cityId to test deduplication in batch
        },
        {
          id: 'c4',
          nameEnglish: 'Clinic 4 (No City)',
          nameArabic: null,
          phoneNumber: null,
          address: null,
          addressEnglish: null,
          addressArabic: null,
          website: null,
          latitude: 30.02,
          longitude: 31.23,
          distanceKm: 0.4,
          googleMapsUrl: 'https://www.google.com/maps/search/?api=1&query=30.02%2C31.23',
          whatsappPhoneUrl: null,
          cityId: null,
        },
      ];

      // Execute resolutions concurrently in one tick
      const results = await Promise.all(clinicDtos.map((c) => resolver.city(c, mockContext)));

      expect(results[0]?.nameEnglish).toBe('City Alpha');
      expect(results[1]?.nameEnglish).toBe('City Beta');
      expect(results[2]?.nameEnglish).toBe('City Alpha');
      expect(results[3]).toBeNull();

      // Ensure DataLoader batched the lookups into a single call with unique IDs
      expect(spyWithCatalogRevision).toHaveBeenCalledTimes(1);
    });
  });
});
