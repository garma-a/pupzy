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
    // --- Aswan Governorate ---
    { nameEn: 'Aswan', nameAr: 'أسوان', governorate: 'Aswan', centerGeom: sql`ST_GeomFromEWKT('SRID=4326;POINT(32.8998 24.0889)')` },
    { nameEn: 'Kom Ombo', nameAr: 'كوم أمبو', governorate: 'Aswan', centerGeom: sql`ST_GeomFromEWKT('SRID=4326;POINT(32.9461 24.4719)')` },
    { nameEn: 'Edfu', nameAr: 'إدفو', governorate: 'Aswan', centerGeom: sql`ST_GeomFromEWKT('SRID=4326;POINT(32.8752 24.9780)')` },
    { nameEn: 'Daraw', nameAr: 'دراو', governorate: 'Aswan', centerGeom: sql`ST_GeomFromEWKT('SRID=4326;POINT(32.9234 24.3985)')` },
    { nameEn: 'Nasr Al Nuba', nameAr: 'نصر النوبة', governorate: 'Aswan', centerGeom: sql`ST_GeomFromEWKT('SRID=4326;POINT(32.9902 24.5772)')` },
    { nameEn: 'Abu Simbel', nameAr: 'أبو سمبل', governorate: 'Aswan', centerGeom: sql`ST_GeomFromEWKT('SRID=4326;POINT(31.6210 22.3370)')` },

    // --- Luxor Governorate ---
    { nameEn: 'Luxor', nameAr: 'الأقصر', governorate: 'Luxor', centerGeom: sql`ST_GeomFromEWKT('SRID=4326;POINT(32.6396 25.6872)')` },
    { nameEn: 'Esna', nameAr: 'إسنا', governorate: 'Luxor', centerGeom: sql`ST_GeomFromEWKT('SRID=4326;POINT(32.5532 25.2934)')` },
    { nameEn: 'Armant', nameAr: 'أرمنت', governorate: 'Luxor', centerGeom: sql`ST_GeomFromEWKT('SRID=4326;POINT(32.5359 25.6186)')` },

    // --- Qena Governorate ---
    { nameEn: 'Qena', nameAr: 'قنا', governorate: 'Qena', centerGeom: sql`ST_GeomFromEWKT('SRID=4326;POINT(32.7181 26.1615)')` },
    { nameEn: 'Nagaa Hammadi', nameAr: 'نجع حمادي', governorate: 'Qena', centerGeom: sql`ST_GeomFromEWKT('SRID=4326;POINT(32.2415 26.0494)')` },
    { nameEn: 'Qus', nameAr: 'قوص', governorate: 'Qena', centerGeom: sql`ST_GeomFromEWKT('SRID=4326;POINT(32.7622 25.9145)')` },
    { nameEn: 'Dishna', nameAr: 'دشنا', governorate: 'Qena', centerGeom: sql`ST_GeomFromEWKT('SRID=4326;POINT(32.4644 26.1187)')` },

    // --- Sohag Governorate ---
    { nameEn: 'Sohag', nameAr: 'سوهاج', governorate: 'Sohag', centerGeom: sql`ST_GeomFromEWKT('SRID=4326;POINT(31.6917 26.5591)')` },
    { nameEn: 'Akhmim', nameAr: 'أخميم', governorate: 'Sohag', centerGeom: sql`ST_GeomFromEWKT('SRID=4326;POINT(31.7451 26.5622)')` },
    { nameEn: 'Girga', nameAr: 'جرجا', governorate: 'Sohag', centerGeom: sql`ST_GeomFromEWKT('SRID=4326;POINT(31.8885 26.3359)')` },
    { nameEn: 'Tahta', nameAr: 'طهطا', governorate: 'Sohag', centerGeom: sql`ST_GeomFromEWKT('SRID=4326;POINT(31.5021 26.7692)')` },

    // --- Asyut Governorate ---
    { nameEn: 'Asyut', nameAr: 'أسيوط', governorate: 'Asyut', centerGeom: sql`ST_GeomFromEWKT('SRID=4326;POINT(31.1837 27.1810)')` },
    { nameEn: 'Manfalut', nameAr: 'منفلوط', governorate: 'Asyut', centerGeom: sql`ST_GeomFromEWKT('SRID=4326;POINT(30.9696 27.3134)')` },
    { nameEn: 'Abu Tig', nameAr: 'أبو تيج', governorate: 'Asyut', centerGeom: sql`ST_GeomFromEWKT('SRID=4326;POINT(31.3175 27.0427)')` },
    { nameEn: 'Dairut', nameAr: 'ديروط', governorate: 'Asyut', centerGeom: sql`ST_GeomFromEWKT('SRID=4326;POINT(30.8122 27.5560)')` },

    // --- Minya Governorate ---
    { nameEn: 'Minya', nameAr: 'المنيا', governorate: 'Minya', centerGeom: sql`ST_GeomFromEWKT('SRID=4326;POINT(30.7671 28.1102)')` },
    { nameEn: 'Maghagha', nameAr: 'مغاغة', governorate: 'Minya', centerGeom: sql`ST_GeomFromEWKT('SRID=4326;POINT(30.8427 28.6479)')` },
    { nameEn: 'Bani Mazar', nameAr: 'بني مزار', governorate: 'Minya', centerGeom: sql`ST_GeomFromEWKT('SRID=4326;POINT(30.8000 28.4988)')` },
    { nameEn: 'Mallawi', nameAr: 'ملوي', governorate: 'Minya', centerGeom: sql`ST_GeomFromEWKT('SRID=4326;POINT(30.8385 27.7317)')` },

    // --- Beni Suef Governorate ---
    { nameEn: 'Beni Suef', nameAr: 'بني سويف', governorate: 'Beni Suef', centerGeom: sql`ST_GeomFromEWKT('SRID=4326;POINT(31.0968 29.0661)')` },
    { nameEn: 'Biba', nameAr: 'ببا', governorate: 'Beni Suef', centerGeom: sql`ST_GeomFromEWKT('SRID=4326;POINT(31.0021 28.9056)')` },
    { nameEn: 'Al Wasta', nameAr: 'الواسطى', governorate: 'Beni Suef', centerGeom: sql`ST_GeomFromEWKT('SRID=4326;POINT(31.2065 29.3364)')` },

    // --- Fayoum Governorate ---
    { nameEn: 'Fayoum', nameAr: 'الفيوم', governorate: 'Fayoum', centerGeom: sql`ST_GeomFromEWKT('SRID=4326;POINT(30.8428 29.3084)')` },
    { nameEn: 'Tamiya', nameAr: 'طامية', governorate: 'Fayoum', centerGeom: sql`ST_GeomFromEWKT('SRID=4326;POINT(30.9392 29.4795)')` },
    { nameEn: 'Ibsheway', nameAr: 'إبشواي', governorate: 'Fayoum', centerGeom: sql`ST_GeomFromEWKT('SRID=4326;POINT(30.6874 29.3601)')` },

    // --- Cairo Governorate ---
    { nameEn: 'Cairo', nameAr: 'القاهرة', governorate: 'Cairo', centerGeom: sql`ST_GeomFromEWKT('SRID=4326;POINT(31.2357 30.0444)')` },
    { nameEn: 'New Cairo', nameAr: 'القاهرة الجديدة', governorate: 'Cairo', centerGeom: sql`ST_GeomFromEWKT('SRID=4326;POINT(31.4700 30.0263)')` },
    { nameEn: 'Nasr City', nameAr: 'مدينة نصر', governorate: 'Cairo', centerGeom: sql`ST_GeomFromEWKT('SRID=4326;POINT(31.3323 30.0626)')` },
    { nameEn: 'Heliopolis', nameAr: 'مصر الجديدة', governorate: 'Cairo', centerGeom: sql`ST_GeomFromEWKT('SRID=4326;POINT(31.3262 30.1015)')` },
    { nameEn: 'Maadi', nameAr: 'المعادي', governorate: 'Cairo', centerGeom: sql`ST_GeomFromEWKT('SRID=4326;POINT(31.2644 29.9602)')` },
    { nameEn: 'Shoubra', nameAr: 'شبرا', governorate: 'Cairo', centerGeom: sql`ST_GeomFromEWKT('SRID=4326;POINT(31.2464 30.0767)')` },
    { nameEn: 'El Marg', nameAr: 'المرج', governorate: 'Cairo', centerGeom: sql`ST_GeomFromEWKT('SRID=4326;POINT(31.3392 30.1557)')` },
    { nameEn: 'Helwan', nameAr: 'حلوان', governorate: 'Cairo', centerGeom: sql`ST_GeomFromEWKT('SRID=4326;POINT(31.3150 29.8458)')` },
    { nameEn: 'New Administrative Capital', nameAr: 'العاصمة الإدارية الجديدة', governorate: 'Cairo', centerGeom: sql`ST_GeomFromEWKT('SRID=4326;POINT(31.7247 30.0076)')` },

    // --- Giza Governorate ---
    { nameEn: 'Giza', nameAr: 'الجيزة', governorate: 'Giza', centerGeom: sql`ST_GeomFromEWKT('SRID=4326;POINT(31.2089 30.0131)')` },
    { nameEn: '6th of October', nameAr: 'السادس من أكتوبر', governorate: 'Giza', centerGeom: sql`ST_GeomFromEWKT('SRID=4326;POINT(30.9329 29.9737)')` },
    { nameEn: 'Sheikh Zayed', nameAr: 'الشيخ زايد', governorate: 'Giza', centerGeom: sql`ST_GeomFromEWKT('SRID=4326;POINT(30.9926 30.0469)')` },
    { nameEn: 'Hawamdiya', nameAr: 'الحوامدية', governorate: 'Giza', centerGeom: sql`ST_GeomFromEWKT('SRID=4326;POINT(31.2652 29.9042)')` },
    { nameEn: 'Badrashein', nameAr: 'البدرشين', governorate: 'Giza', centerGeom: sql`ST_GeomFromEWKT('SRID=4326;POINT(31.2589 29.8517)')` },
    { nameEn: 'Al Ayat', nameAr: 'العياط', governorate: 'Giza', centerGeom: sql`ST_GeomFromEWKT('SRID=4326;POINT(31.2561 29.6190)')` },
    { nameEn: 'Dokki', nameAr: 'الدقي', governorate: 'Giza', centerGeom: sql`ST_GeomFromEWKT('SRID=4326;POINT(31.2093 30.0381)')` },
    { nameEn: 'Mohandiseen', nameAr: 'المهندسين', governorate: 'Giza', centerGeom: sql`ST_GeomFromEWKT('SRID=4326;POINT(31.1991 30.0526)')` },

    // --- Alexandria Governorate ---
    { nameEn: 'Alexandria', nameAr: 'الإسكندرية', governorate: 'Alexandria', centerGeom: sql`ST_GeomFromEWKT('SRID=4326;POINT(29.9187 31.2001)')` },
    { nameEn: 'Borg El Arab', nameAr: 'برج العرب', governorate: 'Alexandria', centerGeom: sql`ST_GeomFromEWKT('SRID=4326;POINT(29.5447 30.9238)')` },
    { nameEn: 'Agami', nameAr: 'العجمي', governorate: 'Alexandria', centerGeom: sql`ST_GeomFromEWKT('SRID=4326;POINT(29.7712 31.1118)')` },
    { nameEn: 'Sidi Bishr', nameAr: 'سيدي بشر', governorate: 'Alexandria', centerGeom: sql`ST_GeomFromEWKT('SRID=4326;POINT(29.9868 31.2635)')` },
    { nameEn: 'Al Muntazah', nameAr: 'المنتزه', governorate: 'Alexandria', centerGeom: sql`ST_GeomFromEWKT('SRID=4326;POINT(30.0210 31.2825)')` },

    // --- Qalyubia Governorate ---
    { nameEn: 'Banha', nameAr: 'بنها', governorate: 'Qalyubia', centerGeom: sql`ST_GeomFromEWKT('SRID=4326;POINT(31.1873 30.4658)')` },
    { nameEn: 'Shubra El-Kheima', nameAr: 'شبرا الخيمة', governorate: 'Qalyubia', centerGeom: sql`ST_GeomFromEWKT('SRID=4326;POINT(31.2655 30.1287)')` },
    { nameEn: 'Qalyub', nameAr: 'قليوب', governorate: 'Qalyubia', centerGeom: sql`ST_GeomFromEWKT('SRID=4326;POINT(31.2045 30.1834)')` },
    { nameEn: 'Khanka', nameAr: 'الخانكة', governorate: 'Qalyubia', centerGeom: sql`ST_GeomFromEWKT('SRID=4326;POINT(31.3656 30.2078)')` },

    // --- Monufia Governorate ---
    { nameEn: 'Shibin El Kom', nameAr: 'شبين الكوم', governorate: 'Monufia', centerGeom: sql`ST_GeomFromEWKT('SRID=4326;POINT(31.0116 30.5539)')` },
    { nameEn: 'Sadat City', nameAr: 'مدينة السادات', governorate: 'Monufia', centerGeom: sql`ST_GeomFromEWKT('SRID=4326;POINT(30.5050 30.3789)')` },
    { nameEn: 'Ashmoun', nameAr: 'أشمون', governorate: 'Monufia', centerGeom: sql`ST_GeomFromEWKT('SRID=4326;POINT(30.9765 30.2980)')` },
    { nameEn: 'Menouf', nameAr: 'منوف', governorate: 'Monufia', centerGeom: sql`ST_GeomFromEWKT('SRID=4326;POINT(30.9298 30.4636)')` },

    // --- Gharbia Governorate ---
    { nameEn: 'Tanta', nameAr: 'طنطا', governorate: 'Gharbia', centerGeom: sql`ST_GeomFromEWKT('SRID=4326;POINT(31.0016 30.7865)')` },
    { nameEn: 'El Mahalla El Kubra', nameAr: 'المحلة الكبرى', governorate: 'Gharbia', centerGeom: sql`ST_GeomFromEWKT('SRID=4326;POINT(31.1645 30.9680)')` },
    { nameEn: 'Zifta', nameAr: 'زفتى', governorate: 'Gharbia', centerGeom: sql`ST_GeomFromEWKT('SRID=4326;POINT(31.2464 30.7107)')` },
    { nameEn: 'Kafr El Zayat', nameAr: 'كفر الزيات', governorate: 'Gharbia', centerGeom: sql`ST_GeomFromEWKT('SRID=4326;POINT(30.8166 30.8248)')` },

    // --- Dakahlia Governorate ---
    { nameEn: 'Mansoura', nameAr: 'المنصورة', governorate: 'Dakahlia', centerGeom: sql`ST_GeomFromEWKT('SRID=4326;POINT(31.3807 31.0364)')` },
    { nameEn: 'Talkha', nameAr: 'طلخا', governorate: 'Dakahlia', centerGeom: sql`ST_GeomFromEWKT('SRID=4326;POINT(31.3789 31.0537)')` },
    { nameEn: 'Mit Ghamr', nameAr: 'ميت غمر', governorate: 'Dakahlia', centerGeom: sql`ST_GeomFromEWKT('SRID=4326;POINT(31.2588 30.7196)')` },
    { nameEn: 'Dikirnis', nameAr: 'دكرنس', governorate: 'Dakahlia', centerGeom: sql`ST_GeomFromEWKT('SRID=4326;POINT(31.6033 31.0847)')` },

    // --- Sharqia Governorate ---
    { nameEn: 'Zagazig', nameAr: 'الزقازيق', governorate: 'Sharqia', centerGeom: sql`ST_GeomFromEWKT('SRID=4326;POINT(31.5020 30.5877)')` },
    { nameEn: '10th of Ramadan', nameAr: 'العاشر من رمضان', governorate: 'Sharqia', centerGeom: sql`ST_GeomFromEWKT('SRID=4326;POINT(31.7455 30.3060)')` },
    { nameEn: 'Bilbeis', nameAr: 'بلبيس', governorate: 'Sharqia', centerGeom: sql`ST_GeomFromEWKT('SRID=4326;POINT(31.5649 30.4190)')` },
    { nameEn: 'Minya El Qamh', nameAr: 'منيا القمح', governorate: 'Sharqia', centerGeom: sql`ST_GeomFromEWKT('SRID=4326;POINT(31.3263 30.5134)')` },

    // --- Beheira Governorate ---
    { nameEn: 'Damanhur', nameAr: 'دمنهور', governorate: 'Beheira', centerGeom: sql`ST_GeomFromEWKT('SRID=4326;POINT(30.4690 31.0366)')` },
    { nameEn: 'Kafr El Dawwar', nameAr: 'كفر الدوار', governorate: 'Beheira', centerGeom: sql`ST_GeomFromEWKT('SRID=4326;POINT(30.1332 31.1340)')` },
    { nameEn: 'Rashid', nameAr: 'رشيد', governorate: 'Beheira', centerGeom: sql`ST_GeomFromEWKT('SRID=4326;POINT(30.4194 31.3999)')` },
    { nameEn: 'Edku', nameAr: 'إدكو', governorate: 'Beheira', centerGeom: sql`ST_GeomFromEWKT('SRID=4326;POINT(30.2985 31.3032)')` },

    // --- Kafr El Sheikh Governorate ---
    { nameEn: 'Kafr El Sheikh', nameAr: 'كفر الشيخ', governorate: 'Kafr El Sheikh', centerGeom: sql`ST_GeomFromEWKT('SRID=4326;POINT(30.9388 31.1090)')` },
    { nameEn: 'Desouk', nameAr: 'دسوق', governorate: 'Kafr El Sheikh', centerGeom: sql`ST_GeomFromEWKT('SRID=4326;POINT(30.6479 31.1306)')` },
    { nameEn: 'Baltim', nameAr: 'بلطيم', governorate: 'Kafr El Sheikh', centerGeom: sql`ST_GeomFromEWKT('SRID=4326;POINT(31.0844 31.5604)')` },

    // --- Damietta Governorate ---
    { nameEn: 'Damietta', nameAr: 'دمياط', governorate: 'Damietta', centerGeom: sql`ST_GeomFromEWKT('SRID=4326;POINT(31.8152 31.4175)')` },
    { nameEn: 'New Damietta', nameAr: 'دمياط الجديدة', governorate: 'Damietta', centerGeom: sql`ST_GeomFromEWKT('SRID=4326;POINT(31.6738 31.4339)')` },
    { nameEn: 'Faraskur', nameAr: 'فارسكور', governorate: 'Damietta', centerGeom: sql`ST_GeomFromEWKT('SRID=4326;POINT(31.7135 31.3283)')` },

    // --- Port Said Governorate ---
    { nameEn: 'Port Said', nameAr: 'بورسعيد', governorate: 'Port Said', centerGeom: sql`ST_GeomFromEWKT('SRID=4326;POINT(32.3019 31.2565)')` },
    { nameEn: 'Port Fouad', nameAr: 'بورفؤاد', governorate: 'Port Said', centerGeom: sql`ST_GeomFromEWKT('SRID=4326;POINT(32.3164 31.2505)')` },

    // --- Ismailia Governorate ---
    { nameEn: 'Ismailia', nameAr: 'الإسماعيلية', governorate: 'Ismailia', centerGeom: sql`ST_GeomFromEWKT('SRID=4326;POINT(32.2736 30.6043)')` },
    { nameEn: 'Fayed', nameAr: 'فايد', governorate: 'Ismailia', centerGeom: sql`ST_GeomFromEWKT('SRID=4326;POINT(32.2965 30.3308)')` },
    { nameEn: 'El Qantara', nameAr: 'القنطرة', governorate: 'Ismailia', centerGeom: sql`ST_GeomFromEWKT('SRID=4326;POINT(32.3188 30.8524)')` },

    // --- Suez Governorate ---
    { nameEn: 'Suez', nameAr: 'السويس', governorate: 'Suez', centerGeom: sql`ST_GeomFromEWKT('SRID=4326;POINT(32.5263 29.9668)')` },
    { nameEn: 'Ain Sokhna', nameAr: 'العين السخنة', governorate: 'Suez', centerGeom: sql`ST_GeomFromEWKT('SRID=4326;POINT(32.3275 29.6059)')` },

    // --- Red Sea Governorate ---
    { nameEn: 'Hurghada', nameAr: 'الغردقة', governorate: 'Red Sea', centerGeom: sql`ST_GeomFromEWKT('SRID=4326;POINT(33.8116 27.2579)')` },
    { nameEn: 'Safaga', nameAr: 'سفاجا', governorate: 'Red Sea', centerGeom: sql`ST_GeomFromEWKT('SRID=4326;POINT(33.9360 26.7505)')` },
    { nameEn: 'Marsa Alam', nameAr: 'مرسى علم', governorate: 'Red Sea', centerGeom: sql`ST_GeomFromEWKT('SRID=4326;POINT(34.8966 25.0684)')` },
    { nameEn: 'El Quseir', nameAr: 'القصير', governorate: 'Red Sea', centerGeom: sql`ST_GeomFromEWKT('SRID=4326;POINT(34.2818 26.1080)')` },
    { nameEn: 'Ras Gharib', nameAr: 'رأس غارب', governorate: 'Red Sea', centerGeom: sql`ST_GeomFromEWKT('SRID=4326;POINT(33.0784 28.3619)')` },

    // --- South Sinai Governorate ---
    { nameEn: 'Sharm El-Sheikh', nameAr: 'شرم الشيخ', governorate: 'South Sinai', centerGeom: sql`ST_GeomFromEWKT('SRID=4326;POINT(34.3299 27.9158)')` },
    { nameEn: 'Dahab', nameAr: 'دهب', governorate: 'South Sinai', centerGeom: sql`ST_GeomFromEWKT('SRID=4326;POINT(34.5134 28.5097)')` },
    { nameEn: 'Nuweiba', nameAr: 'نويبع', governorate: 'South Sinai', centerGeom: sql`ST_GeomFromEWKT('SRID=4326;POINT(34.6644 29.0345)')` },
    { nameEn: 'El Tor', nameAr: 'الطور', governorate: 'South Sinai', centerGeom: sql`ST_GeomFromEWKT('SRID=4326;POINT(33.6212 28.2359)')` },
    { nameEn: 'Saint Catherine', nameAr: 'سانت كاترين', governorate: 'South Sinai', centerGeom: sql`ST_GeomFromEWKT('SRID=4326;POINT(33.9515 28.5583)')` },

    // --- North Sinai Governorate ---
    { nameEn: 'Arish', nameAr: 'العريش', governorate: 'North Sinai', centerGeom: sql`ST_GeomFromEWKT('SRID=4326;POINT(33.8033 31.1316)')` },
    { nameEn: 'Rafah', nameAr: 'رفح', governorate: 'North Sinai', centerGeom: sql`ST_GeomFromEWKT('SRID=4326;POINT(34.2382 31.2828)')` },

    // --- Matrouh Governorate ---
    { nameEn: 'Marsa Matrouh', nameAr: 'مرسى مطروح', governorate: 'Matrouh', centerGeom: sql`ST_GeomFromEWKT('SRID=4326;POINT(27.2373 31.3521)')` },
    { nameEn: 'El Alamein', nameAr: 'العلمين', governorate: 'Matrouh', centerGeom: sql`ST_GeomFromEWKT('SRID=4326;POINT(28.9553 30.8242)')` },
    { nameEn: 'Sidi Abdel Rahman', nameAr: 'سيدي عبدالرحمن', governorate: 'Matrouh', centerGeom: sql`ST_GeomFromEWKT('SRID=4326;POINT(28.7188 30.9575)')` },
    { nameEn: 'Siwa', nameAr: 'سيوة', governorate: 'Matrouh', centerGeom: sql`ST_GeomFromEWKT('SRID=4326;POINT(25.5195 29.2014)')` },

    // --- New Valley Governorate ---
    { nameEn: 'Kharga', nameAr: 'الخارجة', governorate: 'New Valley', centerGeom: sql`ST_GeomFromEWKT('SRID=4326;POINT(30.5463 25.4390)')` },
    { nameEn: 'Dakhla', nameAr: 'الداخلة', governorate: 'New Valley', centerGeom: sql`ST_GeomFromEWKT('SRID=4326;POINT(28.9667 25.5167)')` },
    { nameEn: 'Farafra', nameAr: 'الفرافرة', governorate: 'New Valley', centerGeom: sql`ST_GeomFromEWKT('SRID=4326;POINT(27.9715 27.0560)')` }
  ];

  for (const city of citiesData) {
    await db
      .insert(schema.cities)
      .values(city as any)
      .onConflictDoNothing(); // Basic prevention if run multiple times
  }

  console.log('Seeding complete. Seeded', citiesData.length, 'cities and districts.');
  await pool.end();
}

seed().catch((err) => {
  console.error(err);
  process.exit(1);
});
