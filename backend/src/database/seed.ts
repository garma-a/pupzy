import { Pool } from 'pg';
import { drizzle } from 'drizzle-orm/node-postgres';
import { sql } from 'drizzle-orm';
import * as schema from './schema';

import * as dotenv from 'dotenv';
dotenv.config();

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
});

const db = drizzle(pool, { schema });

async function seed() {
  console.log('Seeding cities...');

  const citiesData = [
    {
      nameEn: 'Cairo',
      nameAr: 'القاهرة',
      governorate: 'Cairo',
      centerGeom: sql`ST_GeomFromEWKT('SRID=4326;POINT(31.2357 30.0444)')`,
    },
    {
      nameEn: 'Giza',
      nameAr: 'الجيزة',
      governorate: 'Giza',
      centerGeom: sql`ST_GeomFromEWKT('SRID=4326;POINT(31.2089 30.0131)')`,
    },
    {
      nameEn: 'Alexandria',
      nameAr: 'الإسكندرية',
      governorate: 'Alexandria',
      centerGeom: sql`ST_GeomFromEWKT('SRID=4326;POINT(29.9187 31.2001)')`,
    },
    {
      nameEn: 'Mansoura',
      nameAr: 'المنصورة',
      governorate: 'Dakahlia',
      centerGeom: sql`ST_GeomFromEWKT('SRID=4326;POINT(31.3807 31.0364)')`,
    },
    {
      nameEn: 'Tanta',
      nameAr: 'طنطا',
      governorate: 'Gharbia',
      centerGeom: sql`ST_GeomFromEWKT('SRID=4326;POINT(31.0016 30.7865)')`,
    },
    {
      nameEn: 'Asyut',
      nameAr: 'أسيوط',
      governorate: 'Asyut',
      centerGeom: sql`ST_GeomFromEWKT('SRID=4326;POINT(31.1837 27.1810)')`,
    },
    {
      nameEn: 'Aswan',
      nameAr: 'أسوان',
      governorate: 'Aswan',
      centerGeom: sql`ST_GeomFromEWKT('SRID=4326;POINT(32.8998 24.0889)')`,
    },
    {
      nameEn: 'Luxor',
      nameAr: 'الأقصر',
      governorate: 'Luxor',
      centerGeom: sql`ST_GeomFromEWKT('SRID=4326;POINT(32.6396 25.6872)')`,
    },
    {
      nameEn: 'Hurghada',
      nameAr: 'الغردقة',
      governorate: 'Red Sea',
      centerGeom: sql`ST_GeomFromEWKT('SRID=4326;POINT(33.8116 27.2579)')`,
    },
    {
      nameEn: 'Sharm El-Sheikh',
      nameAr: 'شرم الشيخ',
      governorate: 'South Sinai',
      centerGeom: sql`ST_GeomFromEWKT('SRID=4326;POINT(34.3299 27.9158)')`,
    },
  ];

  for (const city of citiesData) {
    await db
      .insert(schema.cities)
      .values(city as any)
      .onConflictDoNothing(); // Basic prevention if run multiple times
  }

  console.log('Seeding complete.');
  await pool.end();
}

seed().catch((err) => {
  console.error(err);
  process.exit(1);
});
