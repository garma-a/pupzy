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

  describe('Cache Coherence & Transactional Catalog Revision Enforcement (Integration)', () => {
    function createMemoryCache(): Cache {
      const store = new Map<string, unknown>();
      return {
        get: jest.fn().mockImplementation((key: string) => Promise.resolve(store.get(key))),
        set: jest.fn().mockImplementation((key: string, val: unknown) => {
          store.set(key, val);
          return Promise.resolve();
        }),
        del: jest.fn().mockImplementation((key: string) => {
          store.delete(key);
          return Promise.resolve();
        }),
        reset: jest.fn().mockImplementation(() => {
          store.clear();
          return Promise.resolve();
        }),
        wrap: jest.fn(),
      } as unknown as Cache;
    }

    it('primes process-local cache, advances revision from separate admin client boundary, and next read observes fresh catalog', async () => {
      // 1. Initialize catalog revision singleton to 1
      await dbHelper.pool.query(
        `INSERT INTO city_catalog_revisions (id, revision) VALUES (1, 1) ON CONFLICT (id) DO UPDATE SET revision = 1`,
      );

      // 2. Seed official city
      const city = await insertOfficialCity('Maadi District', 'حي المعادي');

      // 3. Seed initial clinic (Maadi Pet Hospital)
      await dbHelper.db
        .insert(vetClinics)
        .values({
          nameEnglish: 'Maadi Pet Hospital',
          nameArabic: 'مستشفى المعادي للحيوانات الأليفة',
          cityId: city.id,
          coordinates: { longitude: 31.2569, latitude: 29.9602 },
          phoneNumber: '+201001112222',
          addressEnglish: 'Road 9, Maadi',
          source: 'MANUAL',
          isActive: true,
        })
        .returning();

      // 4. Create API instance with process-local cache
      const cacheInstanceA = createMemoryCache();
      const vetRepo = new VetClinicsRepository(dbHelper.db);
      const vetService = new VetClinicsService(vetRepo, cacheInstanceA);

      // 5. Prime cache for City-level, Post-level, and Browse-list lookups
      const initialBrowse = await vetService.nearbyVetClinicsForCity(city.id);
      expect(initialBrowse).toHaveLength(1);
      expect(initialBrowse[0].nameEnglish).toBe('Maadi Pet Hospital');
      expect(vetService.getCacheGeneration()).toBe(0);

      const initialAdoptionPost = await vetService.nearestVetClinicsForPost({
        id: 'post-adoption-1',
        postType: 'ADOPTION',
        cityId: city.id,
        latitude: null,
        longitude: null,
      });
      expect(initialAdoptionPost).toHaveLength(1);
      expect(initialAdoptionPost[0].nameEnglish).toBe('Maadi Pet Hospital');

      const initialRescuePost = await vetService.nearestVetClinicsForPost({
        id: 'post-rescue-1',
        postType: 'RESCUE',
        cityId: city.id,
        latitude: 29.9602,
        longitude: 31.2569,
      });
      expect(initialRescuePost).toHaveLength(1);
      expect(initialRescuePost[0].nameEnglish).toBe('Maadi Pet Hospital');

      // Subsequent read hits cache in generation 0
      const cachedBrowse = await vetService.nearbyVetClinicsForCity(city.id);
      expect(cachedBrowse).toEqual(initialBrowse);
      expect(vetService.getCacheGeneration()).toBe(0);

      // 6. Perform administrative clinic creation from a separate process/client boundary in a single transaction
      const separateClient = await dbHelper.pool.connect();
      try {
        await separateClient.query('BEGIN');
        await separateClient.query(
          `INSERT INTO vet_clinics (name_english, name_arabic, city_id, coordinates, source, is_active)
           VALUES ($1, $2, $3, ST_SetSRID(ST_MakePoint($4, $5), 4326), 'MANUAL', true)`,
          ['Zamalek Vet Care', 'رعاية الزمالك البيطرية', city.id, 31.257, 29.9605],
        );
        await separateClient.query(`UPDATE city_catalog_revisions SET revision = revision + 1 WHERE id = 1`);
        await separateClient.query('COMMIT');
      } finally {
        separateClient.release();
      }

      // Verify DB revision has advanced to 2
      const revCheck = await dbHelper.pool.query<{ revision: number }>(
        `SELECT revision FROM city_catalog_revisions WHERE id = 1`,
      );
      expect(revCheck.rows[0].revision).toBe(2);

      // 7. Next API read observes committed catalog revision 2, invalidates process-local cache, and returns fresh data
      const updatedBrowse = await vetService.nearbyVetClinicsForCity(city.id);
      expect(vetService.getCacheGeneration()).toBe(1);
      expect(updatedBrowse).toHaveLength(2);
      const names = updatedBrowse.map((c) => c.nameEnglish);
      expect(names).toContain('Maadi Pet Hospital');
      expect(names).toContain('Zamalek Vet Care');

      // Post-level lookups also return fresh generation results
      const updatedAdoptionPost = await vetService.nearestVetClinicsForPost({
        id: 'post-adoption-1',
        postType: 'ADOPTION',
        cityId: city.id,
        latitude: null,
        longitude: null,
      });
      expect(updatedAdoptionPost).toHaveLength(2);
    });

    it('proves clinic deactivation and relocation immediately invalidate cache across separate API instances without Redis or polling', async () => {
      await dbHelper.pool.query(
        `INSERT INTO city_catalog_revisions (id, revision) VALUES (1, 1) ON CONFLICT (id) DO UPDATE SET revision = 1`,
      );

      const city = await insertOfficialCity('Heliopolis', 'مصر الجديدة');

      const [clinic1] = await dbHelper.db
        .insert(vetClinics)
        .values({
          nameEnglish: 'Heliopolis Pet Center',
          nameArabic: 'مركز هليوبوليس للحيوانات',
          cityId: city.id,
          coordinates: { longitude: 31.33, latitude: 30.09 },
          source: 'MANUAL',
          isActive: true,
        })
        .returning();

      const [clinic2] = await dbHelper.db
        .insert(vetClinics)
        .values({
          nameEnglish: 'Korba Animal Hospital',
          nameArabic: 'مستشفى الكوربة البيطري',
          cityId: city.id,
          coordinates: { longitude: 31.32, latitude: 30.08 },
          source: 'MANUAL',
          isActive: true,
        })
        .returning();

      // Spawn two independent running API instances (Instance A & Instance B)
      const vetRepo = new VetClinicsRepository(dbHelper.db);
      const instanceA = new VetClinicsService(vetRepo, createMemoryCache());
      const instanceB = new VetClinicsService(vetRepo, createMemoryCache());

      // Both instances prime their separate process-local caches
      const resA1 = await instanceA.nearbyVetClinicsForCity(city.id);
      const resB1 = await instanceB.nearbyVetClinicsForCity(city.id);
      expect(resA1).toHaveLength(2);
      expect(resB1).toHaveLength(2);
      expect(instanceA.getCacheGeneration()).toBe(0);
      expect(instanceB.getCacheGeneration()).toBe(0);

      // Perform administrative mutation from separate client:
      // Deactivate clinic2 and rename clinic1
      const separateClient = await dbHelper.pool.connect();
      try {
        await separateClient.query('BEGIN');
        await separateClient.query(`UPDATE vet_clinics SET is_active = false WHERE id = $1`, [clinic2.id]);
        await separateClient.query(`UPDATE vet_clinics SET name_english = $1 WHERE id = $2`, [
          'Heliopolis Elite Pet Clinic',
          clinic1.id,
        ]);
        await separateClient.query(`UPDATE city_catalog_revisions SET revision = revision + 1 WHERE id = 1`);
        await separateClient.query('COMMIT');
      } finally {
        separateClient.release();
      }

      // Instance A serves next request -> observes new revision, invalidates generation 0 -> generation 1
      const resA2 = await instanceA.nearbyVetClinicsForCity(city.id);
      expect(instanceA.getCacheGeneration()).toBe(1);
      expect(resA2).toHaveLength(1);
      expect(resA2[0].nameEnglish).toBe('Heliopolis Elite Pet Clinic');

      // Instance B serves next request -> also observes new revision and invalidates independently without polling
      const resB2 = await instanceB.nearbyVetClinicsForCity(city.id);
      expect(instanceB.getCacheGeneration()).toBe(1);
      expect(resB2).toHaveLength(1);
      expect(resB2[0].nameEnglish).toBe('Heliopolis Elite Pet Clinic');
    });

    it('proves a rolled back administrative transaction does not advance catalog revision or invalidate safe cache', async () => {
      await dbHelper.pool.query(
        `INSERT INTO city_catalog_revisions (id, revision) VALUES (1, 1) ON CONFLICT (id) DO UPDATE SET revision = 1`,
      );

      const city = await insertOfficialCity('Giza Center', 'مركز الجيزة');

      await dbHelper.db
        .insert(vetClinics)
        .values({
          nameEnglish: 'Pyramids Vet Clinic',
          nameArabic: 'عيادة الأهرام البيطرية',
          cityId: city.id,
          coordinates: { longitude: 31.2, latitude: 30.01 },
          source: 'MANUAL',
          isActive: true,
        })
        .returning();

      const vetRepo = new VetClinicsRepository(dbHelper.db);
      const vetService = new VetClinicsService(vetRepo, createMemoryCache());

      // Prime cache
      const primed = await vetService.nearbyVetClinicsForCity(city.id);
      expect(primed).toHaveLength(1);
      expect(vetService.getCacheGeneration()).toBe(0);

      // Failing administrative transaction (rolls back)
      const separateClient = await dbHelper.pool.connect();
      try {
        await separateClient.query('BEGIN');
        await separateClient.query(`UPDATE city_catalog_revisions SET revision = revision + 1 WHERE id = 1`);
        // Simulate failure / rollback
        await separateClient.query('ROLLBACK');
      } finally {
        separateClient.release();
      }

      // Verify DB revision is still 1
      const revCheck = await dbHelper.pool.query<{ revision: number }>(
        `SELECT revision FROM city_catalog_revisions WHERE id = 1`,
      );
      expect(revCheck.rows[0].revision).toBe(1);

      // Next read continues safely in generation 0
      const nextRead = await vetService.nearbyVetClinicsForCity(city.id);
      expect(nextRead).toEqual(primed);
      expect(vetService.getCacheGeneration()).toBe(0);
    });
  });
});
