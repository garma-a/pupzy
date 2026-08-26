import { Pool } from 'pg';
import { drizzle } from 'drizzle-orm/node-postgres';
import { sql } from 'drizzle-orm';
import { faker } from '@faker-js/faker';
import * as schema from '../src/database/schema';
import { ensureOfficialCities } from '../src/cities/seed';

import * as dotenv from 'dotenv';
dotenv.config();

// ==========================================
// ADJUST THE NUMBER OF ROWS HERE
// ==========================================
const CONFIG = {
  NUM_USERS: 1000000,    // 1 Million users
  NUM_POSTS: 1000000,    // 1 Million posts
  BATCH_SIZE: 3000,      // Kept to 3000 to avoid Postgres parameter limits
};
// ==========================================

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
});

const db = drizzle(pool, { schema });

async function clearDatabase() {
  console.log('🗑️  Wiping existing posts and users to start fresh...');
  await db.execute(sql`TRUNCATE TABLE posts, users RESTART IDENTITY CASCADE`);
  console.log('✨ Posts and users wiped successfully!');
}

async function seed() {
  try {
    await clearDatabase();
    console.log(`🏗️  Starting MEMORY-EFFICIENT fake data generation...`);

    // 1. Fetch official Cities (reuses official catalog, zero fake cities)
    console.log('Loading official Cities catalog...');
    const cityEntries = await ensureOfficialCities(db);
    const cityIds = cityEntries.map((c) => c.id);
    console.log(`Reusing ${cityEntries.length} official Cities for benchmark generation.`);

    const userIds: string[] = [];

    // 2. Create Users
    console.log(`Inserting ${CONFIG.NUM_USERS} Users in batches...`);
    for (let i = 0; i < CONFIG.NUM_USERS; i += CONFIG.BATCH_SIZE) {
      const batchSize = Math.min(CONFIG.BATCH_SIZE, CONFIG.NUM_USERS - i);
      const batch = Array.from({ length: batchSize }).map((_, idx) => {
        return {
          firebaseUserId: (i + idx) < 1000 ? `k6-test-user-${i + idx}` : `firebase_uid_${i + idx}_${faker.string.uuid()}`,
          email: (i + idx) < 1000 ? `k6-${i + idx}@pupzy-test.internal` : `user_${i + idx}_${faker.internet.email()}`,
          fullName: faker.person.fullName(),
          homeCityId: faker.helpers.arrayElement(cityIds),
          isVerified: faker.datatype.boolean({ probability: 0.1 }),
          lastKnownLocation: sql`ST_GeomFromEWKT(${`SRID=4326;POINT(${faker.location.longitude()} ${faker.location.latitude()})`})`,
        };
      });
      const returned = await db.insert(schema.users).values(batch as any).returning({ id: schema.users.id });
      if (userIds.length < 10000) {
        userIds.push(...returned.map((r: any) => r.id));
      }
      process.stdout.write(`\rProgress: ${i + batchSize} / ${CONFIG.NUM_USERS}`);
    }
    console.log('');

    // 3. Create Posts
    console.log(`Inserting ${CONFIG.NUM_POSTS} Posts in batches...`);
    for (let i = 0; i < CONFIG.NUM_POSTS; i += CONFIG.BATCH_SIZE) {
      const batchSize = Math.min(CONFIG.BATCH_SIZE, CONFIG.NUM_POSTS - i);
      const batch = Array.from({ length: batchSize }).map(() => {
        const type = faker.helpers.arrayElement(['RESCUE', 'LOST', 'ADOPTION', 'PRODUCT', 'MATING']);
        const city = faker.helpers.arrayElement(cityEntries);
        return {
          creatorId: faker.helpers.arrayElement(userIds),
          postType: type,
          title: faker.lorem.sentence().substring(0, 200),
          description: faker.lorem.paragraph(),
          status: 'ACTIVE',
          moderationStatus: 'CLEAN',
          urgency: (type === 'RESCUE' || type === 'LOST') ? faker.helpers.arrayElement(['CRITICAL', 'URGENT', 'MODERATE']) : null,
          cityId: city.id,
          governorate: city.governorate,
          areaName: faker.location.street(),
          coordinates: sql`ST_GeomFromEWKT(${`SRID=4326;POINT(${faker.location.longitude()} ${faker.location.latitude()})`})`,
          upvoteCount: (type !== 'PRODUCT') ? faker.number.int({ min: 0, max: 100 }) : 0,
          saveCount: faker.number.int({ min: 0, max: 50 }),
          viewCount: faker.number.int({ min: 0, max: 5000 }),
          marketCategory: (type === 'PRODUCT') ? faker.helpers.arrayElement(['CARE', 'FOOD', 'TRANSPORT', 'ACCESSORIES', 'GROOMING', 'MEDICAL_SUPPLIES', 'OTHER']) : null,
        };
      });
      const returned = await db.insert(schema.posts).values(batch as any).returning({ id: schema.posts.id, postType: schema.posts.postType });
      
      const rescueRows: any[] = [];
      const adoptionRows: any[] = [];
      const productRows: any[] = [];
      const lostRows: any[] = [];
      const matingRows: any[] = [];

      for (const item of returned) {
        if (item.postType === 'RESCUE') {
          rescueRows.push({
            postId: item.id,
            species: faker.helpers.arrayElement(['DOG', 'CAT', 'BIRD', 'OTHER']),
            conditionSummary: faker.lorem.sentence(),
            reporterRole: faker.helpers.arrayElement(['BYSTANDER', 'RESCUER', 'SHELTER']),
          });
        } else if (item.postType === 'ADOPTION') {
          adoptionRows.push({
            postId: item.id,
            petName: faker.person.firstName(),
            species: faker.helpers.arrayElement(['DOG', 'CAT', 'BIRD', 'OTHER']),
            breed: faker.animal.dog(),
            ageValue: faker.number.int({ min: 1, max: 10 }),
            ageUnit: 'YEARS',
            gender: faker.helpers.arrayElement(['MALE', 'FEMALE']),
            vaccinated: true,
            neutered: true,
          });
        } else if (item.postType === 'PRODUCT') {
          productRows.push({
            postId: item.id,
            category: faker.helpers.arrayElement(['CARE', 'FOOD', 'TRANSPORT', 'ACCESSORIES', 'GROOMING', 'MEDICAL_SUPPLIES', 'OTHER']),
            condition: faker.helpers.arrayElement(['NEW', 'LIKE_NEW', 'GOOD', 'FAIR']),
            priceAmount: '50.00',
            isFree: false,
          });
        } else if (item.postType === 'LOST') {
          lostRows.push({
            postId: item.id,
            reportType: 'LOST_PET',
            petName: faker.person.firstName(),
            species: faker.helpers.arrayElement(['DOG', 'CAT']),
            dateLastSeen: new Date().toISOString(),
          });
        } else if (item.postType === 'MATING') {
          matingRows.push({
            postId: item.id,
            petName: faker.person.firstName(),
            species: faker.helpers.arrayElement(['DOG', 'CAT', 'BIRD', 'OTHER']),
            breed: faker.animal.dog(),
            gender: faker.helpers.arrayElement(['MALE', 'FEMALE']),
            ageValue: faker.number.int({ min: 1, max: 10 }),
            ageUnit: 'YEARS',
            isPurebred: faker.datatype.boolean(),
            hasPedigreeCertificate: faker.datatype.boolean(),
            vaccinated: true,
            dewormed: true,
          });
        }
      }

      if (rescueRows.length) await db.insert(schema.rescuePosts).values(rescueRows);
      if (adoptionRows.length) await db.insert(schema.adoptionPosts).values(adoptionRows);
      if (productRows.length) await db.insert(schema.productPosts).values(productRows);
      if (lostRows.length) await db.insert(schema.lostPosts).values(lostRows);
      if (matingRows.length) await db.insert(schema.matingPosts).values(matingRows);

      process.stdout.write(`\rProgress: ${i + batchSize} / ${CONFIG.NUM_POSTS}`);
    }
    console.log('');

    console.log('⚡ Running PostgreSQL ANALYZE to update query planner statistics...');
    await db.execute(sql`ANALYZE posts; ANALYZE rescue_posts; ANALYZE adoption_posts; ANALYZE product_posts; ANALYZE lost_posts; ANALYZE mating_posts;`);

    console.log('\n🎉 Massive Data seeding completed successfully!');

  } catch (error) {
    console.error('❌ Seeding failed:', error);
  } finally {
    await pool.end();
  }
}

if (require.main === module) {
  void seed();
}
