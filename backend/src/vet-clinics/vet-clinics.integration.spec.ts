import { sql, eq } from 'drizzle-orm';
import { generateUuidV7 } from '../common/utils/generate-uuidv7';
import { TestDatabaseHelper } from '../../test/test-database.helper';
import { cities, vetClinics } from '../database/schema';

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
});
