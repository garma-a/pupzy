import { Pool } from 'pg';
import { drizzle } from 'drizzle-orm/node-postgres';
import { sql } from 'drizzle-orm';
import { faker } from '@faker-js/faker';
import * as schema from '../src/database/schema';

import * as dotenv from 'dotenv';
dotenv.config();

// ==========================================
// ADJUST THE NUMBER OF ROWS HERE
// ==========================================
const CONFIG = {
  NUM_CITIES: 1000,      // 1k cities
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
  console.log('🗑️  Wiping existing database records to start fresh...');
  await db.execute(sql`TRUNCATE TABLE posts, users, cities RESTART IDENTITY CASCADE`);
  console.log('✨ Database wiped successfully!');
}

async function seed() {
  try {
    await clearDatabase();
    console.log(`🏗️  Starting MEMORY-EFFICIENT fake data generation...`);

    const cityIds: string[] = [];
    const userIds: string[] = [];

    // 1. Create Cities
    console.log(`Inserting ${CONFIG.NUM_CITIES} Cities in batches...`);
    for (let i = 0; i < CONFIG.NUM_CITIES; i += CONFIG.BATCH_SIZE) {
      const batchSize = Math.min(CONFIG.BATCH_SIZE, CONFIG.NUM_CITIES - i);
      const batch = Array.from({ length: batchSize }).map((_, idx) => ({
        nameEnglish: `City ${i + idx} ${faker.location.city()}`,
        nameArabic: `مدينة ${i + idx}`,
        governorate: faker.helpers.arrayElement(['Cairo', 'Alexandria', 'Giza', 'Luxor', 'Aswan']),
        // Stored as EWKT text for PostGIS
        centerPoint: sql`ST_GeomFromEWKT(${`SRID=4326;POINT(${faker.location.longitude()} ${faker.location.latitude()})`})`,
      }));
      const returned = await db.insert(schema.cities).values(batch as any).returning({ id: schema.cities.id });
      cityIds.push(...returned.map((r: any) => r.id));
      process.stdout.write(`\rProgress: ${i + batchSize} / ${CONFIG.NUM_CITIES}`);
    }
    console.log('');

    // 2. Create Users
    console.log(`Inserting ${CONFIG.NUM_USERS} Users in batches...`);
    for (let i = 0; i < CONFIG.NUM_USERS; i += CONFIG.BATCH_SIZE) {
      const batchSize = Math.min(CONFIG.BATCH_SIZE, CONFIG.NUM_USERS - i);
      const batch = Array.from({ length: batchSize }).map((_, idx) => {
        return {
          firebaseUserId: `firebase_uid_${i + idx}_${faker.string.uuid()}`,
          email: `user_${i + idx}_${faker.internet.email()}`,
          fullName: faker.person.fullName(),
          homeCityId: faker.helpers.arrayElement(cityIds),
          isVerified: faker.datatype.boolean({ probability: 0.1 }),
          lastKnownLocation: sql`ST_GeomFromEWKT(${`SRID=4326;POINT(${faker.location.longitude()} ${faker.location.latitude()})`})`,
        };
      });
      const returned = await db.insert(schema.users).values(batch as any).returning({ id: schema.users.id });
      userIds.push(...returned.map((r: any) => r.id));
      process.stdout.write(`\rProgress: ${i + batchSize} / ${CONFIG.NUM_USERS}`);
    }
    console.log('');

    // 3. Create Posts
    console.log(`Inserting ${CONFIG.NUM_POSTS} Posts in batches...`);
    for (let i = 0; i < CONFIG.NUM_POSTS; i += CONFIG.BATCH_SIZE) {
      const batchSize = Math.min(CONFIG.BATCH_SIZE, CONFIG.NUM_POSTS - i);
      const batch = Array.from({ length: batchSize }).map(() => {
        const type = faker.helpers.arrayElement(['RESCUE', 'LOST', 'ADOPTION', 'PRODUCT']);
        return {
          creatorId: faker.helpers.arrayElement(userIds),
          postType: type,
          title: faker.lorem.sentence().substring(0, 200),
          description: faker.lorem.paragraph(),
          status: 'ACTIVE',
          moderationStatus: 'CLEAN',
          urgency: (type === 'RESCUE' || type === 'LOST') ? faker.helpers.arrayElement(['LOW', 'MODERATE', 'HIGH', 'CRITICAL']) : null,
          cityId: faker.helpers.arrayElement(cityIds),
          areaName: faker.location.street(),
          coordinates: sql`ST_GeomFromEWKT(${`SRID=4326;POINT(${faker.location.longitude()} ${faker.location.latitude()})`})`,
          upvoteCount: (type !== 'PRODUCT') ? faker.number.int({ min: 0, max: 100 }) : 0,
          saveCount: faker.number.int({ min: 0, max: 50 }),
          viewCount: faker.number.int({ min: 0, max: 5000 }),
          marketCategory: (type === 'PRODUCT') ? faker.helpers.arrayElement(['FOOD', 'TOYS', 'ACCESSORIES', 'MEDICINE', 'OTHER']) : null,
        };
      });
      await db.insert(schema.posts).values(batch as any);
      process.stdout.write(`\rProgress: ${i + batchSize} / ${CONFIG.NUM_POSTS}`);
    }
    console.log('');

    console.log('\n🎉 Massive Data seeding completed successfully!');

  } catch (error) {
    console.error('❌ Seeding failed:', error);
  } finally {
    pool.end();
  }
}

seed();
