import { db } from '@/database/db';
import * as schema from '@/drizzle/schema';
import { sql } from 'drizzle-orm';
async function run() {
  try {
    const user = await db.query.users.findFirst();
    const city = await db.query.cities.findFirst();
    await db.insert(schema.posts).values({
      creatorId: user.id,
      postType: 'RESCUE',
      title: 'Test',
      description: 'Test',
      status: 'ACTIVE',
      moderationStatus: 'APPROVED',
      urgency: 'HIGH',
      cityId: city.id,
      coordinates: sql`ST_GeomFromEWKT(${`SRID=4326;POINT(30 30)`})`,
    } as any);
    console.log("Success");
  } catch (e) {
    console.error("ERROR:", e);
  }
}
run();
