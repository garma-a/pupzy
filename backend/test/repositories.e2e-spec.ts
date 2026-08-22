import { TestDatabaseHelper } from './test-database.helper';
import { NotificationsRepository } from '../src/notifications/notifications.repository';
import { ContactsRepository } from '../src/contacts/contacts.repository';
import { AdoptionsRepository } from '../src/adoptions/adoptions.repository';
import { VetClinicsRepository } from '../src/vet-clinics/vet-clinics.repository';
import { PostsRepository } from '../src/posts/posts.repository';
import { generateUuidV7 } from '../src/common/utils/generate-uuidv7';
import { cities, users, posts, vetClinics } from '../src/database/schema';
import { sql } from 'drizzle-orm';
import type { NodePgDatabase } from 'drizzle-orm/node-postgres';

describe('Repository Layer with Testcontainers (Integration)', () => {
  let dbHelper: TestDatabaseHelper;
  let notificationsRepo: NotificationsRepository;
  let contactsRepo: ContactsRepository;
  let adoptionsRepo: AdoptionsRepository;
  let vetClinicsRepo: VetClinicsRepository;
  let postsRepo: PostsRepository;

  const testCityId = generateUuidV7();
  const testUserId1 = generateUuidV7();
  const testUserId2 = generateUuidV7();

  beforeAll(async () => {
    dbHelper = new TestDatabaseHelper();
    await dbHelper.start();

    const db = dbHelper.db as unknown as NodePgDatabase;
    notificationsRepo = new NotificationsRepository(db);
    contactsRepo = new ContactsRepository(db);
    adoptionsRepo = new AdoptionsRepository(db);
    vetClinicsRepo = new VetClinicsRepository(dbHelper.db);
    postsRepo = new PostsRepository(dbHelper.db);
  }, 120_000);

  afterAll(async () => {
    await dbHelper.stop();
  });

  beforeEach(async () => {
    await dbHelper.clean();

    // Insert base city
    await dbHelper.db.insert(cities).values({
      id: testCityId,
      nameEnglish: 'Cairo',
      nameArabic: 'القاهرة',
      governorate: 'Cairo',
      centerPoint: sql`ST_SetSRID(ST_MakePoint(31.2357, 30.0444), 4326)`,
    });

    // Insert base users
    await dbHelper.db.insert(users).values([
      {
        id: testUserId1,
        firebaseUserId: 'fb-user-1',
        email: 'user1@example.com',
        phoneNumber: '+201000000001',
        fullName: 'User One',
        homeCityId: testCityId,
      },
      {
        id: testUserId2,
        firebaseUserId: 'fb-user-2',
        email: 'user2@example.com',
        phoneNumber: '+201000000002',
        fullName: 'User Two',
        homeCityId: testCityId,
      },
    ]);
  });

  describe('NotificationsRepository', () => {
    it('creates, counts unread, finds by recipient with keyset cursor, and marks all as read', async () => {
      await notificationsRepo.create({
        id: generateUuidV7(),
        recipientId: testUserId1,
        type: 'SYSTEM_ANNOUNCEMENT',
        title: 'Notification 1',
        body: 'Body 1',
      });

      await notificationsRepo.create({
        id: generateUuidV7(),
        recipientId: testUserId1,
        type: 'SYSTEM_ANNOUNCEMENT',
        title: 'Notification 2',
        body: 'Body 2',
      });

      const unreadCount = await notificationsRepo.countUnread(testUserId1);
      expect(unreadCount).toBe(2);

      const firstPage = await notificationsRepo.findByRecipient({
        recipientId: testUserId1,
        limit: 1,
        cursor: null,
      });
      expect(firstPage.rows).toHaveLength(1);
      expect(firstPage.hasNextPage).toBe(true);

      const cursor = {
        createdAt: firstPage.rows[0].createdAt.toISOString(),
        id: firstPage.rows[0].id,
      };

      const secondPage = await notificationsRepo.findByRecipient({
        recipientId: testUserId1,
        limit: 1,
        cursor,
      });
      expect(secondPage.rows).toHaveLength(1);
      expect(secondPage.hasNextPage).toBe(false);

      const marked = await notificationsRepo.markAllRead(testUserId1);
      expect(marked).toBe(2);

      const countAfter = await notificationsRepo.countUnread(testUserId1);
      expect(countAfter).toBe(0);
    });
  });

  describe('VetClinicsRepository', () => {
    it('finds nearest vet clinic using PostGIS KNN distance query', async () => {
      const clinicId = generateUuidV7();
      await dbHelper.db.insert(vetClinics).values({
        id: clinicId,
        nameEnglish: 'Cairo Vet Clinic',
        nameArabic: 'عيادة القاهرة البيطرية',
        phoneNumber: '+201011111111',
        address: '10 Road 9, Maadi',
        coordinates: { longitude: 31.2569, latitude: 29.9602 },
        isActive: true,
      });

      const nearest = await vetClinicsRepo.findNearest(29.96, 31.25, 3);
      expect(nearest).toHaveLength(1);
      expect(nearest[0].id).toBe(clinicId);
      expect(typeof nearest[0].distanceKm).toBe('number');
      expect(typeof nearest[0].latitude).toBe('number');
      expect(typeof nearest[0].longitude).toBe('number');
    });

    it('finds nearest vet clinic for city center point', async () => {
      const clinicId = generateUuidV7();
      await dbHelper.db.insert(vetClinics).values({
        id: clinicId,
        nameEnglish: 'Downtown Clinic',
        nameArabic: 'عيادة وسط البلد',
        coordinates: { longitude: 31.24, latitude: 30.05 },
        isActive: true,
      });

      const nearestCity = await vetClinicsRepo.findNearestForCity(testCityId, 3);
      expect(nearestCity).toHaveLength(1);
      expect(nearestCity[0].id).toBe(clinicId);
      expect(typeof nearestCity[0].distanceKm).toBe('number');
    });
  });

  describe('PostsRepository', () => {
    it('creates rescue post with urgency and feeds query with Drizzle builder', async () => {
      const postId = generateUuidV7();
      const created = await postsRepo.createRescuePost(
        {
          id: postId,
          creatorId: testUserId1,
          postType: 'RESCUE',
          title: 'Stray dog in danger',
          description: 'Near highway',
          status: 'ACTIVE',
          moderationStatus: 'CLEAN',
          urgency: 'CRITICAL',
          cityId: testCityId,
          governorate: 'Cairo',
          coordinates: [31.2357, 30.0444],
          effectiveScore: 0,
        },
        {
          species: 'DOG',
          conditionSummary: 'Limping',
          reporterRole: 'ON_SITE',
          isLifeThreatening: true,
          hasVisibleSeriousInjury: true,
          isInDangerousLocation: true,
          canAnimalMoveOrEscape: false,
        },
        [],
      );

      expect(created.id).toBe(postId);
      expect(created.urgency).toBe('CRITICAL');

      // Test help feed
      const helpFeed = await postsRepo.findHelpFeed({
        governorate: 'Cairo',
        cityId: undefined,
        viewerLocation: undefined,
        radiusKm: 25,
        limit: 10,
        cursor: null,
      });
      expect(helpFeed.rows).toHaveLength(1);
      expect(helpFeed.rows[0].post.id).toBe(postId);

      // Test myPosts
      const myPosts = await postsRepo.findPostsCreatedByCurrentUser({
        creatorId: testUserId1,
        postType: 'RESCUE',
        limit: 10,
        cursor: null,
      });
      expect(myPosts.rows).toHaveLength(1);
      expect(myPosts.rows[0].post.id).toBe(postId);

      // Test toggleSave & mySavedPosts
      await postsRepo.toggleSave(postId, testUserId2);

      const mySaved = await postsRepo.findPostsSavedByCurrentUser({
        userId: testUserId2,
        limit: 10,
        cursor: null,
      });
      expect(mySaved.rows).toHaveLength(1);
      expect(mySaved.rows[0].post.id).toBe(postId);

      // Test DataLoaders with composite keys
      const savedLoader = postsRepo.createSavedByMeLoader();
      const isSavedUser2 = await savedLoader.load(`${testUserId2}:${postId}`);
      const isSavedUser1 = await savedLoader.load(`${testUserId1}:${postId}`);
      expect(isSavedUser2).toBe(true);
      expect(isSavedUser1).toBe(false);

      const upvoteLoader = postsRepo.createUpvotedByMeLoader();
      const isUpvotedBefore = await upvoteLoader.load(`${testUserId2}:${postId}`);
      expect(isUpvotedBefore).toBe(false);

      await postsRepo.toggleUpvote(postId, testUserId2);
      const freshUpvoteLoader = postsRepo.createUpvotedByMeLoader();
      const isUpvotedAfter = await freshUpvoteLoader.load(`${testUserId2}:${postId}`);
      expect(isUpvotedAfter).toBe(true);
    });
  });

  describe('ContactsRepository', () => {
    it('creates, finds by ID, updates status, and queries by requester and post with cursor', async () => {
      const postId = generateUuidV7();
      await dbHelper.db.insert(posts).values({
        id: postId,
        creatorId: testUserId1,
        postType: 'ADOPTION',
        title: 'Adoption Post for Contacts',
        description: 'Adoption description',
        status: 'ACTIVE',
        moderationStatus: 'CLEAN',
        cityId: testCityId,
        governorate: 'Cairo',
        coordinates: [31.2357, 30.0444],
        effectiveScore: 0,
      });

      const requestId = generateUuidV7();
      const request = await contactsRepo.create({
        id: requestId,
        postId,
        requesterId: testUserId2,
        message: 'I would like to contact you about this pet',
        status: 'PENDING',
      });
      expect(request.id).toBe(requestId);

      const found = await contactsRepo.findById(requestId);
      expect(found?.id).toBe(requestId);

      const existing = await contactsRepo.findExisting(postId, testUserId2);
      expect(existing?.id).toBe(requestId);

      const updated = await contactsRepo.updateStatus(requestId, 'APPROVED');
      expect(updated?.status).toBe('APPROVED');
      expect(updated?.respondedAt).toBeDefined();

      const byRequester = await contactsRepo.findByRequester({
        requesterId: testUserId2,
        limit: 10,
        cursor: null,
      });
      expect(byRequester.rows).toHaveLength(1);
      expect(byRequester.rows[0].id).toBe(requestId);

      const byPost = await contactsRepo.findByPost({
        postId,
        limit: 10,
        cursor: null,
      });
      expect(byPost.rows).toHaveLength(1);
      expect(byPost.rows[0].id).toBe(requestId);
    });
  });

  describe('AdoptionsRepository', () => {
    it('creates, finds by ID, updates status, and queries by applicant and post with cursor', async () => {
      const postId = generateUuidV7();
      await dbHelper.db.insert(posts).values({
        id: postId,
        creatorId: testUserId1,
        postType: 'ADOPTION',
        title: 'Adoption Post for Applications',
        description: 'Adoption description',
        status: 'ACTIVE',
        moderationStatus: 'CLEAN',
        cityId: testCityId,
        governorate: 'Cairo',
        coordinates: [31.2357, 30.0444],
        effectiveScore: 0,
      });

      const appId = generateUuidV7();
      const app = await adoptionsRepo.create({
        id: appId,
        targetPostId: postId,
        applicantId: testUserId2,
        status: 'PENDING',
        livingSituation: 'APARTMENT',
        hasOutdoorAccess: true,
        hasOtherPetsAtHome: false,
        hasChildrenAtHome: false,
        whyAdopt: 'We love dogs and have a great home for them.',
        consentHomeVisit: true,
        canProvideVetReference: true,
      });
      expect(app.id).toBe(appId);

      const found = await adoptionsRepo.findById(appId);
      expect(found?.id).toBe(appId);

      const existing = await adoptionsRepo.findExisting(postId, testUserId2);
      expect(existing?.id).toBe(appId);

      const updated = await adoptionsRepo.updateStatus(appId, 'APPROVED');
      expect(updated?.status).toBe('APPROVED');

      const byApplicant = await adoptionsRepo.findByApplicant({
        applicantId: testUserId2,
        limit: 10,
        cursor: null,
      });
      expect(byApplicant.rows).toHaveLength(1);
      expect(byApplicant.rows[0].id).toBe(appId);

      const byPost = await adoptionsRepo.findByPost({
        targetPostId: postId,
        limit: 10,
        cursor: null,
      });
      expect(byPost.rows).toHaveLength(1);
      expect(byPost.rows[0].id).toBe(appId);
    });
  });
});
