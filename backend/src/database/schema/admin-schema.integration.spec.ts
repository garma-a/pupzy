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
});
