import { eq, sql } from 'drizzle-orm';
import { generateUuidV7 } from '../../common/utils/generate-uuidv7';
import { TestDatabaseHelper } from '../../../test/test-database.helper';
import {
  adminUsers,
  cities,
  moderationActions,
  posts,
  users,
  vetClinics,
  vetClinicLocationAudits,
  addressSearchCache,
} from './index';

describe('Admin schema (integration)', () => {
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

  async function insertAdmin(email = 'admin@example.com') {
    const [admin] = await dbHelper.db
      .insert(adminUsers)
      .values({
        email,
        passwordHash: '$2b$12$test.hash.for.schema.tests.only',
        fullName: 'Schema Test Admin',
        role: 'SUPER_ADMIN',
      })
      .returning();
    return admin;
  }

  async function insertUserAndCity() {
    const [city] = await dbHelper.db
      .insert(cities)
      .values({
        nameEnglish: 'Cairo',
        nameArabic: 'القاهرة',
        governorate: 'Cairo',
        centerPoint: sql`ST_SetSRID(ST_MakePoint(31.2357, 30.0444), 4326)`,
      })
      .returning();
    const [user] = await dbHelper.db
      .insert(users)
      .values({
        firebaseUserId: `firebase-${generateUuidV7()}`,
        email: `${generateUuidV7()}@example.com`,
        fullName: 'Schema Test User',
        homeCityId: city.id,
      })
      .returning();
    return { user, city };
  }

  it('rejects duplicate admin email addresses', async () => {
    await insertAdmin();

    await expect(insertAdmin()).rejects.toMatchObject({
      cause: { code: '23505' },
    });
  });

  it('accepts a polymorphic moderation target without a target foreign key', async () => {
    const admin = await insertAdmin();
    const arbitraryTargetId = generateUuidV7();

    const [action] = await dbHelper.db
      .insert(moderationActions)
      .values({
        adminUserId: admin.id,
        actionType: 'POST_FLAGGED',
        targetType: 'POST',
        targetId: arbitraryTargetId,
        reason: 'Schema test',
      })
      .returning();

    expect(action.targetId).toBe(arbitraryTargetId);
  });

  it('sets users.bannedByAdminId to null when its admin is deleted', async () => {
    const admin = await insertAdmin();
    const { user } = await insertUserAndCity();
    await dbHelper.db
      .update(users)
      .set({ isBanned: true, bannedAt: new Date(), bannedByAdminId: admin.id })
      .where(eq(users.id, user.id));

    await dbHelper.db.delete(adminUsers).where(eq(adminUsers.id, admin.id));

    const [survivingUser] = await dbHelper.db.select().from(users).where(eq(users.id, user.id));
    expect(survivingUser).toBeDefined();
    expect(survivingUser.bannedByAdminId).toBeNull();
  });

  it('sets posts.moderatedByAdminId to null when its admin is deleted', async () => {
    const admin = await insertAdmin();
    const { user, city } = await insertUserAndCity();
    const [post] = await dbHelper.db
      .insert(posts)
      .values({
        creatorId: user.id,
        postType: 'ADOPTION',
        title: 'Moderated post',
        description: 'Schema FK test',
        cityId: city.id,
        coordinates: [31.2357, 30.0444],
        moderatedByAdminId: admin.id,
      })
      .returning();

    await dbHelper.db.delete(adminUsers).where(eq(adminUsers.id, admin.id));

    const [survivingPost] = await dbHelper.db.select().from(posts).where(eq(posts.id, post.id));
    expect(survivingPost).toBeDefined();
    expect(survivingPost.moderatedByAdminId).toBeNull();
  });

  it('uses idx_posts_needs_review for the review queue', async () => {
    const { user, city } = await insertUserAndCity();
    await dbHelper.db.insert(posts).values(
      ['PENDING_AUTO_REVIEW', 'FLAGGED', 'CLEAN'].map((moderationStatus, index) => ({
        creatorId: user.id,
        postType: 'ADOPTION' as const,
        title: `Review post ${index}`,
        description: 'Index plan test',
        status: 'ACTIVE' as const,
        moderationStatus: moderationStatus as 'PENDING_AUTO_REVIEW' | 'FLAGGED' | 'CLEAN',
        reportCount: index,
        cityId: city.id,
        coordinates: [31.2357, 30.0444] as [number, number],
      })),
    );

    const client = await dbHelper.pool.connect();
    try {
      await client.query('ANALYZE posts');
      await client.query('SET enable_seqscan = off');
      interface ExplainPlanRow {
        'QUERY PLAN': Array<{
          Plan: {
            'Node Type': string;
            'Index Name'?: string;
          };
        }>;
      }
      const { rows } = await client.query<ExplainPlanRow>(`
        EXPLAIN (FORMAT JSON)
        SELECT id, report_count, created_at
        FROM posts
        WHERE moderation_status IN ('PENDING_AUTO_REVIEW', 'FLAGGED') AND status = 'ACTIVE'
        ORDER BY report_count DESC, created_at DESC
      `);
      const plan = rows[0]['QUERY PLAN'][0].Plan;
      expect(plan['Node Type']).not.toBe('Seq Scan');
      expect(plan['Index Name']).toBe('idx_posts_needs_review');
    } finally {
      await client.query('RESET enable_seqscan');
      client.release();
    }
  });

  it('persists vet_clinic_location_audits with FK integrity and sets adminUserId to null on admin deletion', async () => {
    const admin = await insertAdmin('auditor@example.com');
    const { city } = await insertUserAndCity();

    const [nearestCity] = await dbHelper.db
      .insert(cities)
      .values({
        nameEnglish: 'Giza',
        nameArabic: 'الجيزة',
        governorate: 'Giza',
        centerPoint: sql`ST_SetSRID(ST_MakePoint(31.20, 30.01), 4326)`,
      })
      .returning();

    const [clinic] = await dbHelper.db
      .insert(vetClinics)
      .values({
        nameEnglish: 'Audited Clinic',
        nameArabic: 'عيادة موثقة',
        cityId: city.id,
        addressEnglish: 'Cairo-Giza Border',
        addressArabic: 'حدود القاهرة والجيزة',
        coordinates: { longitude: 31.2, latitude: 30.01 },
        source: 'MANUAL',
      })
      .returning();

    const [audit] = await dbHelper.db
      .insert(vetClinicLocationAudits)
      .values({
        vetClinicId: clinic.id,
        adminUserId: admin.id,
        selectedCityId: city.id,
        nearestCityId: nearestCity.id,
        coordinates: { longitude: 31.2, latitude: 30.01 },
        discrepancyDetails: { distance_km: 1.2 },
        reason: 'Clinic located on boundary road between Cairo and Giza',
      })
      .returning();

    expect(audit).toBeDefined();
    expect(audit.vetClinicId).toBe(clinic.id);
    expect(audit.adminUserId).toBe(admin.id);
    expect(audit.reason).toBe('Clinic located on boundary road between Cairo and Giza');

    // Admin deletion preserves audit log with null adminUserId
    await dbHelper.db.delete(adminUsers).where(eq(adminUsers.id, admin.id));
    const [survivingAudit] = await dbHelper.db
      .select()
      .from(vetClinicLocationAudits)
      .where(eq(vetClinicLocationAudits.id, audit.id));
    expect(survivingAudit).toBeDefined();
    expect(survivingAudit.adminUserId).toBeNull();

    // Check constraint rejects blank reason
    await expect(
      dbHelper.db.insert(vetClinicLocationAudits).values({
        vetClinicId: clinic.id,
        selectedCityId: city.id,
        nearestCityId: nearestCity.id,
        coordinates: { longitude: 31.2, latitude: 30.01 },
        reason: '   ',
      }),
    ).rejects.toThrow();
  });

  it('persists address_search_cache and enforces unique normalized query constraint', async () => {
    const [entry] = await dbHelper.db
      .insert(addressSearchCache)
      .values({
        normalizedQuery: 'maadi degla clinic',
        results: [
          {
            displayName: 'Degla Clinic',
            latitude: 29.96,
            longitude: 31.28,
            osmId: '12345',
          },
        ],
      })
      .returning();

    expect(entry).toBeDefined();
    expect(entry.normalizedQuery).toBe('maadi degla clinic');
    expect(Array.isArray(entry.results)).toBe(true);

    // Reject duplicate normalized_query
    await expect(
      dbHelper.db.insert(addressSearchCache).values({
        normalizedQuery: 'maadi degla clinic',
        results: [],
      }),
    ).rejects.toThrow();
  });

  it('verifies address_search_cache index state and proves unique index serves lookups via query plan', async () => {
    const client = await dbHelper.pool.connect();
    try {
      // 1. Verify schema indexes: exactly pkey and unique constraint index, no duplicate or created_at index
      const { rows: indexRows } = await client.query<{ indexname: string }>(`
        SELECT indexname
        FROM pg_indexes
        WHERE tablename = 'address_search_cache'
        ORDER BY indexname
      `);
      const indexNames = indexRows.map((r) => r.indexname);

      expect(indexNames).toContain('address_search_cache_pkey');
      expect(indexNames).toContain('address_search_cache_normalized_query_unique');
      expect(indexNames).not.toContain('idx_address_search_cache_normalized_query');
      expect(indexNames).not.toContain('idx_address_search_cache_created_at');
      expect(indexNames).toHaveLength(2);

      // 2. Pre-seed cache entries to test query plan
      await client.query(`
        INSERT INTO address_search_cache (id, normalized_query, results)
        VALUES
          (uuidv7(), 'heliopolis vet clinic', '[{"displayName": "Heliopolis Vet", "latitude": 30.08, "longitude": 31.32}]'::jsonb),
          (uuidv7(), 'zamalek vet clinic', '[{"displayName": "Zamalek Vet", "latitude": 30.06, "longitude": 31.22}]'::jsonb),
          (uuidv7(), 'nasr city vet clinic', '[{"displayName": "Nasr City Vet", "latitude": 30.05, "longitude": 31.34}]'::jsonb)
      `);

      await client.query('ANALYZE address_search_cache');
      await client.query('SET enable_seqscan = off');

      interface ExplainPlanNode {
        'Node Type': string;
        'Index Name'?: string;
        Plans?: ExplainPlanNode[];
      }

      interface ExplainPlanRow {
        'QUERY PLAN': Array<{
          Plan: ExplainPlanNode;
        }>;
      }

      const { rows: planRows } = await client.query<ExplainPlanRow>(`
        EXPLAIN (FORMAT JSON)
        SELECT results
        FROM address_search_cache
        WHERE normalized_query = 'heliopolis vet clinic'
      `);
      const plan = planRows[0]['QUERY PLAN'][0].Plan;
      const indexName = plan['Index Name'] || plan.Plans?.[0]?.['Index Name'];
      const nodeType = plan['Node Type'] === 'Limit' ? plan.Plans?.[0]?.['Node Type'] : plan['Node Type'];

      expect(nodeType).not.toBe('Seq Scan');
      expect(indexName).toBe('address_search_cache_normalized_query_unique');

      // 3. Verify upsert behavior on unique constraint
      const updatedResults = [
        { displayName: 'Updated Heliopolis Clinic', latitude: 30.081, longitude: 31.321, osmId: '99999' },
      ];
      await client.query(
        `INSERT INTO address_search_cache (id, normalized_query, results, created_at, updated_at)
         VALUES (uuidv7(), 'heliopolis vet clinic', $1::jsonb, now(), now())
         ON CONFLICT (normalized_query) DO UPDATE
           SET results = EXCLUDED.results, updated_at = now()`,
        [JSON.stringify(updatedResults)],
      );

      const { rows: readRows } = await client.query<{ results: typeof updatedResults }>(
        `SELECT results FROM address_search_cache WHERE normalized_query = $1`,
        ['heliopolis vet clinic'],
      );
      expect(readRows).toHaveLength(1);
      expect(readRows[0].results).toEqual(updatedResults);
    } finally {
      await client.query('RESET enable_seqscan');
      client.release();
    }
  });

  // ---------------------------------------------------------------------------
  // Ticket 06: UUIDv7 identity, FK SET NULL preservation, append-only trigger
  // ---------------------------------------------------------------------------

  async function insertAuditFixtures() {
    const admin = await insertAdmin('audit-fixture@example.com');
    const { city } = await insertUserAndCity();

    const [nearestCity] = await dbHelper.db
      .insert(cities)
      .values({
        nameEnglish: 'Giza',
        nameArabic: 'الجيزة',
        governorate: 'Giza',
        centerPoint: sql`ST_SetSRID(ST_MakePoint(31.20, 30.01), 4326)`,
      })
      .returning();

    const [clinic] = await dbHelper.db
      .insert(vetClinics)
      .values({
        nameEnglish: 'Audit Fixture Clinic',
        nameArabic: 'عيادة اختبار',
        cityId: city.id,
        addressEnglish: '1 Test Rd',
        addressArabic: '١ شارع الاختبار',
        coordinates: { longitude: 31.2, latitude: 30.01 },
        source: 'MANUAL',
      })
      .returning();

    return { admin, city, nearestCity, clinic };
  }

  it('audit id is assigned by the database as UUIDv7 (version nibble = 7)', async () => {
    const { clinic, city, nearestCity } = await insertAuditFixtures();

    const [audit] = await dbHelper.db
      .insert(vetClinicLocationAudits)
      .values({
        vetClinicId: clinic.id,
        selectedCityId: city.id,
        nearestCityId: nearestCity.id,
        coordinates: { longitude: 31.2, latitude: 30.01 },
        reason: 'UUIDv7 version check test',
      })
      .returning();

    expect(audit).toBeDefined();
    expect(audit.id).toBeTruthy();

    // Extract the version nibble from the UUID.
    // UUIDv7 byte layout: xxxxxxxx-xxxx-7xxx-xxxx-xxxxxxxxxxxx
    // The "7" appears at position 14 in the 32-hex-digit string (after removing dashes).
    const hexDigits = audit.id.replace(/-/g, '');
    const versionNibble = parseInt(hexDigits[12], 16); // byte 6, high nibble
    expect(versionNibble).toBe(7);
  });

  it('deleting a clinic sets audit.vetClinicId to NULL (FK SET NULL), audit row survives', async () => {
    const { clinic, city, nearestCity } = await insertAuditFixtures();

    const [audit] = await dbHelper.db
      .insert(vetClinicLocationAudits)
      .values({
        vetClinicId: clinic.id,
        selectedCityId: city.id,
        nearestCityId: nearestCity.id,
        coordinates: { longitude: 31.2, latitude: 30.01 },
        reason: 'FK set null test – clinic deletion',
      })
      .returning();

    // Delete the clinic
    await dbHelper.db.delete(vetClinics).where(eq(vetClinics.id, clinic.id));

    // Audit row must still exist
    const [surviving] = await dbHelper.db
      .select()
      .from(vetClinicLocationAudits)
      .where(eq(vetClinicLocationAudits.id, audit.id));

    expect(surviving).toBeDefined();
    expect(surviving.vetClinicId).toBeNull();
    // Other FKs untouched
    expect(surviving.selectedCityId).toBe(city.id);
    expect(surviving.nearestCityId).toBe(nearestCity.id);
  });

  it('deleting a city sets audit.selectedCityId and nearestCityId to NULL, audit row survives', async () => {
    const { clinic, city, nearestCity } = await insertAuditFixtures();

    const [audit] = await dbHelper.db
      .insert(vetClinicLocationAudits)
      .values({
        vetClinicId: clinic.id,
        selectedCityId: city.id,
        nearestCityId: nearestCity.id,
        coordinates: { longitude: 31.2, latitude: 30.01 },
        reason: 'FK set null test – city deletion',
      })
      .returning();

    // Delete the selected city (nearestCity is a different row and survives)
    await dbHelper.db.delete(cities).where(eq(cities.id, city.id));

    const [surviving] = await dbHelper.db
      .select()
      .from(vetClinicLocationAudits)
      .where(eq(vetClinicLocationAudits.id, audit.id));

    expect(surviving).toBeDefined();
    expect(surviving.selectedCityId).toBeNull();
    // vetClinicId and nearestCityId untouched
    expect(surviving.vetClinicId).toBe(clinic.id);
    expect(surviving.nearestCityId).toBe(nearestCity.id);
  });

  it('append-only trigger rejects direct UPDATE on a committed audit row', async () => {
    const { clinic, city, nearestCity } = await insertAuditFixtures();

    const [audit] = await dbHelper.db
      .insert(vetClinicLocationAudits)
      .values({
        vetClinicId: clinic.id,
        selectedCityId: city.id,
        nearestCityId: nearestCity.id,
        coordinates: { longitude: 31.2, latitude: 30.01 },
        reason: 'Original reason before attempted mutation',
      })
      .returning();

    await expect(
      dbHelper.pool.query(`UPDATE vet_clinic_location_audits SET reason = 'tampered' WHERE id = $1`, [audit.id]),
    ).rejects.toThrow(/append-only/i);
  });

  it('append-only trigger rejects direct DELETE on a committed audit row', async () => {
    const { clinic, city, nearestCity } = await insertAuditFixtures();

    const [audit] = await dbHelper.db
      .insert(vetClinicLocationAudits)
      .values({
        vetClinicId: clinic.id,
        selectedCityId: city.id,
        nearestCityId: nearestCity.id,
        coordinates: { longitude: 31.2, latitude: 30.01 },
        reason: 'Row that must not be deletable',
      })
      .returning();

    await expect(
      dbHelper.pool.query(`DELETE FROM vet_clinic_location_audits WHERE id = $1`, [audit.id]),
    ).rejects.toThrow(/append-only/i);

    // Row still exists
    const [still] = await dbHelper.db
      .select()
      .from(vetClinicLocationAudits)
      .where(eq(vetClinicLocationAudits.id, audit.id));
    expect(still).toBeDefined();
  });

  it('normal atomic audit creation succeeds and returns a row with a valid UUIDv7 id', async () => {
    const { admin, clinic, city, nearestCity } = await insertAuditFixtures();

    const [audit] = await dbHelper.db
      .insert(vetClinicLocationAudits)
      .values({
        vetClinicId: clinic.id,
        adminUserId: admin.id,
        selectedCityId: city.id,
        nearestCityId: nearestCity.id,
        coordinates: { longitude: 31.2, latitude: 30.01 },
        discrepancyDetails: { distance_km: 0.8 },
        reason: 'Atomic audit creation – full happy path',
      })
      .returning();

    expect(audit).toBeDefined();
    expect(audit.id).toBeTruthy();
    expect(audit.vetClinicId).toBe(clinic.id);
    expect(audit.adminUserId).toBe(admin.id);
    expect(audit.selectedCityId).toBe(city.id);
    expect(audit.nearestCityId).toBe(nearestCity.id);
    expect(audit.reason).toBe('Atomic audit creation – full happy path');
    expect(audit.createdAt).toBeInstanceOf(Date);

    // UUIDv7 version check
    const hexDigits = audit.id.replace(/-/g, '');
    expect(parseInt(hexDigits[12], 16)).toBe(7);
  });
});
