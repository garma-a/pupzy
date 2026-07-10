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
    {
      nameEnglish: 'Aswan',
      nameArabic: 'أسوان',
      governorate: 'Aswan',
      centerPoint: sql`ST_GeomFromEWKT('SRID=4326;POINT(32.8998 24.0889)')`,
    },
    {
      nameEnglish: 'Kom Ombo',
      nameArabic: 'كوم أمبو',
      governorate: 'Aswan',
      centerPoint: sql`ST_GeomFromEWKT('SRID=4326;POINT(32.9461 24.4719)')`,
    },
    {
      nameEnglish: 'Edfu',
      nameArabic: 'إدفو',
      governorate: 'Aswan',
      centerPoint: sql`ST_GeomFromEWKT('SRID=4326;POINT(32.8752 24.9780)')`,
    },
    {
      nameEnglish: 'Daraw',
      nameArabic: 'دراو',
      governorate: 'Aswan',
      centerPoint: sql`ST_GeomFromEWKT('SRID=4326;POINT(32.9234 24.3985)')`,
    },
    {
      nameEnglish: 'Nasr Al Nuba',
      nameArabic: 'نصر النوبة',
      governorate: 'Aswan',
      centerPoint: sql`ST_GeomFromEWKT('SRID=4326;POINT(32.9902 24.5772)')`,
    },
    {
      nameEnglish: 'Abu Simbel',
      nameArabic: 'أبو سمبل',
      governorate: 'Aswan',
      centerPoint: sql`ST_GeomFromEWKT('SRID=4326;POINT(31.6210 22.3370)')`,
    },

    // --- Luxor Governorate ---
    {
      nameEnglish: 'Luxor',
      nameArabic: 'الأقصر',
      governorate: 'Luxor',
      centerPoint: sql`ST_GeomFromEWKT('SRID=4326;POINT(32.6396 25.6872)')`,
    },
    {
      nameEnglish: 'Esna',
      nameArabic: 'إسنا',
      governorate: 'Luxor',
      centerPoint: sql`ST_GeomFromEWKT('SRID=4326;POINT(32.5532 25.2934)')`,
    },
    {
      nameEnglish: 'Armant',
      nameArabic: 'أرمنت',
      governorate: 'Luxor',
      centerPoint: sql`ST_GeomFromEWKT('SRID=4326;POINT(32.5359 25.6186)')`,
    },

    // --- Qena Governorate ---
    {
      nameEnglish: 'Qena',
      nameArabic: 'قنا',
      governorate: 'Qena',
      centerPoint: sql`ST_GeomFromEWKT('SRID=4326;POINT(32.7181 26.1615)')`,
    },
    {
      nameEnglish: 'Nagaa Hammadi',
      nameArabic: 'نجع حمادي',
      governorate: 'Qena',
      centerPoint: sql`ST_GeomFromEWKT('SRID=4326;POINT(32.2415 26.0494)')`,
    },
    {
      nameEnglish: 'Qus',
      nameArabic: 'قوص',
      governorate: 'Qena',
      centerPoint: sql`ST_GeomFromEWKT('SRID=4326;POINT(32.7622 25.9145)')`,
    },
    {
      nameEnglish: 'Dishna',
      nameArabic: 'دشنا',
      governorate: 'Qena',
      centerPoint: sql`ST_GeomFromEWKT('SRID=4326;POINT(32.4644 26.1187)')`,
    },

    // --- Sohag Governorate ---
    {
      nameEnglish: 'Sohag',
      nameArabic: 'سوهاج',
      governorate: 'Sohag',
      centerPoint: sql`ST_GeomFromEWKT('SRID=4326;POINT(31.6917 26.5591)')`,
    },
    {
      nameEnglish: 'Akhmim',
      nameArabic: 'أخميم',
      governorate: 'Sohag',
      centerPoint: sql`ST_GeomFromEWKT('SRID=4326;POINT(31.7451 26.5622)')`,
    },
    {
      nameEnglish: 'Girga',
      nameArabic: 'جرجا',
      governorate: 'Sohag',
      centerPoint: sql`ST_GeomFromEWKT('SRID=4326;POINT(31.8885 26.3359)')`,
    },
    {
      nameEnglish: 'Tahta',
      nameArabic: 'طهطا',
      governorate: 'Sohag',
      centerPoint: sql`ST_GeomFromEWKT('SRID=4326;POINT(31.5021 26.7692)')`,
    },

    // --- Asyut Governorate ---
    {
      nameEnglish: 'Asyut',
      nameArabic: 'أسيوط',
      governorate: 'Asyut',
      centerPoint: sql`ST_GeomFromEWKT('SRID=4326;POINT(31.1837 27.1810)')`,
    },
    {
      nameEnglish: 'Manfalut',
      nameArabic: 'منفلوط',
      governorate: 'Asyut',
      centerPoint: sql`ST_GeomFromEWKT('SRID=4326;POINT(30.9696 27.3134)')`,
    },
    {
      nameEnglish: 'Abu Tig',
      nameArabic: 'أبو تيج',
      governorate: 'Asyut',
      centerPoint: sql`ST_GeomFromEWKT('SRID=4326;POINT(31.3175 27.0427)')`,
    },
    {
      nameEnglish: 'Dairut',
      nameArabic: 'ديروط',
      governorate: 'Asyut',
      centerPoint: sql`ST_GeomFromEWKT('SRID=4326;POINT(30.8122 27.5560)')`,
    },

    // --- Minya Governorate ---
    {
      nameEnglish: 'Minya',
      nameArabic: 'المنيا',
      governorate: 'Minya',
      centerPoint: sql`ST_GeomFromEWKT('SRID=4326;POINT(30.7671 28.1102)')`,
    },
    {
      nameEnglish: 'Maghagha',
      nameArabic: 'مغاغة',
      governorate: 'Minya',
      centerPoint: sql`ST_GeomFromEWKT('SRID=4326;POINT(30.8427 28.6479)')`,
    },
    {
      nameEnglish: 'Bani Mazar',
      nameArabic: 'بني مزار',
      governorate: 'Minya',
      centerPoint: sql`ST_GeomFromEWKT('SRID=4326;POINT(30.8000 28.4988)')`,
    },
    {
      nameEnglish: 'Mallawi',
      nameArabic: 'ملوي',
      governorate: 'Minya',
      centerPoint: sql`ST_GeomFromEWKT('SRID=4326;POINT(30.8385 27.7317)')`,
    },

    // --- Beni Suef Governorate ---
    {
      nameEnglish: 'Beni Suef',
      nameArabic: 'بني سويف',
      governorate: 'Beni Suef',
      centerPoint: sql`ST_GeomFromEWKT('SRID=4326;POINT(31.0968 29.0661)')`,
    },
    {
      nameEnglish: 'Biba',
      nameArabic: 'ببا',
      governorate: 'Beni Suef',
      centerPoint: sql`ST_GeomFromEWKT('SRID=4326;POINT(31.0021 28.9056)')`,
    },
    {
      nameEnglish: 'Al Wasta',
      nameArabic: 'الواسطى',
      governorate: 'Beni Suef',
      centerPoint: sql`ST_GeomFromEWKT('SRID=4326;POINT(31.2065 29.3364)')`,
    },

    // --- Fayoum Governorate ---
    {
      nameEnglish: 'Fayoum',
      nameArabic: 'الفيوم',
      governorate: 'Fayoum',
      centerPoint: sql`ST_GeomFromEWKT('SRID=4326;POINT(30.8428 29.3084)')`,
    },
    {
      nameEnglish: 'Tamiya',
      nameArabic: 'طامية',
      governorate: 'Fayoum',
      centerPoint: sql`ST_GeomFromEWKT('SRID=4326;POINT(30.9392 29.4795)')`,
    },
    {
      nameEnglish: 'Ibsheway',
      nameArabic: 'إبشواي',
      governorate: 'Fayoum',
      centerPoint: sql`ST_GeomFromEWKT('SRID=4326;POINT(30.6874 29.3601)')`,
    },

    // --- Cairo Governorate ---
    {
      nameEnglish: 'Cairo',
      nameArabic: 'القاهرة',
      governorate: 'Cairo',
      centerPoint: sql`ST_GeomFromEWKT('SRID=4326;POINT(31.2357 30.0444)')`,
    },
    {
      nameEnglish: 'New Cairo',
      nameArabic: 'القاهرة الجديدة',
      governorate: 'Cairo',
      centerPoint: sql`ST_GeomFromEWKT('SRID=4326;POINT(31.4700 30.0263)')`,
    },
    {
      nameEnglish: 'Nasr City',
      nameArabic: 'مدينة نصر',
      governorate: 'Cairo',
      centerPoint: sql`ST_GeomFromEWKT('SRID=4326;POINT(31.3323 30.0626)')`,
    },
    {
      nameEnglish: 'Heliopolis',
      nameArabic: 'مصر الجديدة',
      governorate: 'Cairo',
      centerPoint: sql`ST_GeomFromEWKT('SRID=4326;POINT(31.3262 30.1015)')`,
    },
    {
      nameEnglish: 'Maadi',
      nameArabic: 'المعادي',
      governorate: 'Cairo',
      centerPoint: sql`ST_GeomFromEWKT('SRID=4326;POINT(31.2644 29.9602)')`,
    },
    {
      nameEnglish: 'Shoubra',
      nameArabic: 'شبرا',
      governorate: 'Cairo',
      centerPoint: sql`ST_GeomFromEWKT('SRID=4326;POINT(31.2464 30.0767)')`,
    },
    {
      nameEnglish: 'El Marg',
      nameArabic: 'المرج',
      governorate: 'Cairo',
      centerPoint: sql`ST_GeomFromEWKT('SRID=4326;POINT(31.3392 30.1557)')`,
    },
    {
      nameEnglish: 'Helwan',
      nameArabic: 'حلوان',
      governorate: 'Cairo',
      centerPoint: sql`ST_GeomFromEWKT('SRID=4326;POINT(31.3150 29.8458)')`,
    },
    {
      nameEnglish: 'New Administrative Capital',
      nameArabic: 'العاصمة الإدارية الجديدة',
      governorate: 'Cairo',
      centerPoint: sql`ST_GeomFromEWKT('SRID=4326;POINT(31.7247 30.0076)')`,
    },

    // --- Giza Governorate ---
    {
      nameEnglish: 'Giza',
      nameArabic: 'الجيزة',
      governorate: 'Giza',
      centerPoint: sql`ST_GeomFromEWKT('SRID=4326;POINT(31.2089 30.0131)')`,
    },
    {
      nameEnglish: '6th of October',
      nameArabic: 'السادس من أكتوبر',
      governorate: 'Giza',
      centerPoint: sql`ST_GeomFromEWKT('SRID=4326;POINT(30.9329 29.9737)')`,
    },
    {
      nameEnglish: 'Sheikh Zayed',
      nameArabic: 'الشيخ زايد',
      governorate: 'Giza',
      centerPoint: sql`ST_GeomFromEWKT('SRID=4326;POINT(30.9926 30.0469)')`,
    },
    {
      nameEnglish: 'Hawamdiya',
      nameArabic: 'الحوامدية',
      governorate: 'Giza',
      centerPoint: sql`ST_GeomFromEWKT('SRID=4326;POINT(31.2652 29.9042)')`,
    },
    {
      nameEnglish: 'Badrashein',
      nameArabic: 'البدرشين',
      governorate: 'Giza',
      centerPoint: sql`ST_GeomFromEWKT('SRID=4326;POINT(31.2589 29.8517)')`,
    },
    {
      nameEnglish: 'Al Ayat',
      nameArabic: 'العياط',
      governorate: 'Giza',
      centerPoint: sql`ST_GeomFromEWKT('SRID=4326;POINT(31.2561 29.6190)')`,
    },
    {
      nameEnglish: 'Dokki',
      nameArabic: 'الدقي',
      governorate: 'Giza',
      centerPoint: sql`ST_GeomFromEWKT('SRID=4326;POINT(31.2093 30.0381)')`,
    },
    {
      nameEnglish: 'Mohandiseen',
      nameArabic: 'المهندسين',
      governorate: 'Giza',
      centerPoint: sql`ST_GeomFromEWKT('SRID=4326;POINT(31.1991 30.0526)')`,
    },

    // --- Alexandria Governorate ---
    {
      nameEnglish: 'Alexandria',
      nameArabic: 'الإسكندرية',
      governorate: 'Alexandria',
      centerPoint: sql`ST_GeomFromEWKT('SRID=4326;POINT(29.9187 31.2001)')`,
    },
    {
      nameEnglish: 'Borg El Arab',
      nameArabic: 'برج العرب',
      governorate: 'Alexandria',
      centerPoint: sql`ST_GeomFromEWKT('SRID=4326;POINT(29.5447 30.9238)')`,
    },
    {
      nameEnglish: 'Agami',
      nameArabic: 'العجمي',
      governorate: 'Alexandria',
      centerPoint: sql`ST_GeomFromEWKT('SRID=4326;POINT(29.7712 31.1118)')`,
    },
    {
      nameEnglish: 'Sidi Bishr',
      nameArabic: 'سيدي بشر',
      governorate: 'Alexandria',
      centerPoint: sql`ST_GeomFromEWKT('SRID=4326;POINT(29.9868 31.2635)')`,
    },
    {
      nameEnglish: 'Al Muntazah',
      nameArabic: 'المنتزه',
      governorate: 'Alexandria',
      centerPoint: sql`ST_GeomFromEWKT('SRID=4326;POINT(30.0210 31.2825)')`,
    },

    // --- Qalyubia Governorate ---
    {
      nameEnglish: 'Banha',
      nameArabic: 'بنها',
      governorate: 'Qalyubia',
      centerPoint: sql`ST_GeomFromEWKT('SRID=4326;POINT(31.1873 30.4658)')`,
    },
    {
      nameEnglish: 'Shubra El-Kheima',
      nameArabic: 'شبرا الخيمة',
      governorate: 'Qalyubia',
      centerPoint: sql`ST_GeomFromEWKT('SRID=4326;POINT(31.2655 30.1287)')`,
    },
    {
      nameEnglish: 'Qalyub',
      nameArabic: 'قليوب',
      governorate: 'Qalyubia',
      centerPoint: sql`ST_GeomFromEWKT('SRID=4326;POINT(31.2045 30.1834)')`,
    },
    {
      nameEnglish: 'Khanka',
      nameArabic: 'الخانكة',
      governorate: 'Qalyubia',
      centerPoint: sql`ST_GeomFromEWKT('SRID=4326;POINT(31.3656 30.2078)')`,
    },

    // --- Monufia Governorate ---
    {
      nameEnglish: 'Shibin El Kom',
      nameArabic: 'شبين الكوم',
      governorate: 'Monufia',
      centerPoint: sql`ST_GeomFromEWKT('SRID=4326;POINT(31.0116 30.5539)')`,
    },
    {
      nameEnglish: 'Sadat City',
      nameArabic: 'مدينة السادات',
      governorate: 'Monufia',
      centerPoint: sql`ST_GeomFromEWKT('SRID=4326;POINT(30.5050 30.3789)')`,
    },
    {
      nameEnglish: 'Ashmoun',
      nameArabic: 'أشمون',
      governorate: 'Monufia',
      centerPoint: sql`ST_GeomFromEWKT('SRID=4326;POINT(30.9765 30.2980)')`,
    },
    {
      nameEnglish: 'Menouf',
      nameArabic: 'منوف',
      governorate: 'Monufia',
      centerPoint: sql`ST_GeomFromEWKT('SRID=4326;POINT(30.9298 30.4636)')`,
    },

    // --- Gharbia Governorate ---
    {
      nameEnglish: 'Tanta',
      nameArabic: 'طنطا',
      governorate: 'Gharbia',
      centerPoint: sql`ST_GeomFromEWKT('SRID=4326;POINT(31.0016 30.7865)')`,
    },
    {
      nameEnglish: 'El Mahalla El Kubra',
      nameArabic: 'المحلة الكبرى',
      governorate: 'Gharbia',
      centerPoint: sql`ST_GeomFromEWKT('SRID=4326;POINT(31.1645 30.9680)')`,
    },
    {
      nameEnglish: 'Zifta',
      nameArabic: 'زفتى',
      governorate: 'Gharbia',
      centerPoint: sql`ST_GeomFromEWKT('SRID=4326;POINT(31.2464 30.7107)')`,
    },
    {
      nameEnglish: 'Kafr El Zayat',
      nameArabic: 'كفر الزيات',
      governorate: 'Gharbia',
      centerPoint: sql`ST_GeomFromEWKT('SRID=4326;POINT(30.8166 30.8248)')`,
    },

    // --- Dakahlia Governorate ---
    {
      nameEnglish: 'Mansoura',
      nameArabic: 'المنصورة',
      governorate: 'Dakahlia',
      centerPoint: sql`ST_GeomFromEWKT('SRID=4326;POINT(31.3807 31.0364)')`,
    },
    {
      nameEnglish: 'Talkha',
      nameArabic: 'طلخا',
      governorate: 'Dakahlia',
      centerPoint: sql`ST_GeomFromEWKT('SRID=4326;POINT(31.3789 31.0537)')`,
    },
    {
      nameEnglish: 'Mit Ghamr',
      nameArabic: 'ميت غمر',
      governorate: 'Dakahlia',
      centerPoint: sql`ST_GeomFromEWKT('SRID=4326;POINT(31.2588 30.7196)')`,
    },
    {
      nameEnglish: 'Dikirnis',
      nameArabic: 'دكرنس',
      governorate: 'Dakahlia',
      centerPoint: sql`ST_GeomFromEWKT('SRID=4326;POINT(31.6033 31.0847)')`,
    },

    // --- Sharqia Governorate ---
    {
      nameEnglish: 'Zagazig',
      nameArabic: 'الزقازيق',
      governorate: 'Sharqia',
      centerPoint: sql`ST_GeomFromEWKT('SRID=4326;POINT(31.5020 30.5877)')`,
    },
    {
      nameEnglish: '10th of Ramadan',
      nameArabic: 'العاشر من رمضان',
      governorate: 'Sharqia',
      centerPoint: sql`ST_GeomFromEWKT('SRID=4326;POINT(31.7455 30.3060)')`,
    },
    {
      nameEnglish: 'Bilbeis',
      nameArabic: 'بلبيس',
      governorate: 'Sharqia',
      centerPoint: sql`ST_GeomFromEWKT('SRID=4326;POINT(31.5649 30.4190)')`,
    },
    {
      nameEnglish: 'Minya El Qamh',
      nameArabic: 'منيا القمح',
      governorate: 'Sharqia',
      centerPoint: sql`ST_GeomFromEWKT('SRID=4326;POINT(31.3263 30.5134)')`,
    },

    // --- Beheira Governorate ---
    {
      nameEnglish: 'Damanhur',
      nameArabic: 'دمنهور',
      governorate: 'Beheira',
      centerPoint: sql`ST_GeomFromEWKT('SRID=4326;POINT(30.4690 31.0366)')`,
    },
    {
      nameEnglish: 'Kafr El Dawwar',
      nameArabic: 'كفر الدوار',
      governorate: 'Beheira',
      centerPoint: sql`ST_GeomFromEWKT('SRID=4326;POINT(30.1332 31.1340)')`,
    },
    {
      nameEnglish: 'Rashid',
      nameArabic: 'رشيد',
      governorate: 'Beheira',
      centerPoint: sql`ST_GeomFromEWKT('SRID=4326;POINT(30.4194 31.3999)')`,
    },
    {
      nameEnglish: 'Edku',
      nameArabic: 'إدكو',
      governorate: 'Beheira',
      centerPoint: sql`ST_GeomFromEWKT('SRID=4326;POINT(30.2985 31.3032)')`,
    },

    // --- Kafr El Sheikh Governorate ---
    {
      nameEnglish: 'Kafr El Sheikh',
      nameArabic: 'كفر الشيخ',
      governorate: 'Kafr El Sheikh',
      centerPoint: sql`ST_GeomFromEWKT('SRID=4326;POINT(30.9388 31.1090)')`,
    },
    {
      nameEnglish: 'Desouk',
      nameArabic: 'دسوق',
      governorate: 'Kafr El Sheikh',
      centerPoint: sql`ST_GeomFromEWKT('SRID=4326;POINT(30.6479 31.1306)')`,
    },
    {
      nameEnglish: 'Baltim',
      nameArabic: 'بلطيم',
      governorate: 'Kafr El Sheikh',
      centerPoint: sql`ST_GeomFromEWKT('SRID=4326;POINT(31.0844 31.5604)')`,
    },

    // --- Damietta Governorate ---
    {
      nameEnglish: 'Damietta',
      nameArabic: 'دمياط',
      governorate: 'Damietta',
      centerPoint: sql`ST_GeomFromEWKT('SRID=4326;POINT(31.8152 31.4175)')`,
    },
    {
      nameEnglish: 'New Damietta',
      nameArabic: 'دمياط الجديدة',
      governorate: 'Damietta',
      centerPoint: sql`ST_GeomFromEWKT('SRID=4326;POINT(31.6738 31.4339)')`,
    },
    {
      nameEnglish: 'Faraskur',
      nameArabic: 'فارسكور',
      governorate: 'Damietta',
      centerPoint: sql`ST_GeomFromEWKT('SRID=4326;POINT(31.7135 31.3283)')`,
    },

    // --- Port Said Governorate ---
    {
      nameEnglish: 'Port Said',
      nameArabic: 'بورسعيد',
      governorate: 'Port Said',
      centerPoint: sql`ST_GeomFromEWKT('SRID=4326;POINT(32.3019 31.2565)')`,
    },
    {
      nameEnglish: 'Port Fouad',
      nameArabic: 'بورفؤاد',
      governorate: 'Port Said',
      centerPoint: sql`ST_GeomFromEWKT('SRID=4326;POINT(32.3164 31.2505)')`,
    },

    // --- Ismailia Governorate ---
    {
      nameEnglish: 'Ismailia',
      nameArabic: 'الإسماعيلية',
      governorate: 'Ismailia',
      centerPoint: sql`ST_GeomFromEWKT('SRID=4326;POINT(32.2736 30.6043)')`,
    },
    {
      nameEnglish: 'Fayed',
      nameArabic: 'فايد',
      governorate: 'Ismailia',
      centerPoint: sql`ST_GeomFromEWKT('SRID=4326;POINT(32.2965 30.3308)')`,
    },
    {
      nameEnglish: 'El Qantara',
      nameArabic: 'القنطرة',
      governorate: 'Ismailia',
      centerPoint: sql`ST_GeomFromEWKT('SRID=4326;POINT(32.3188 30.8524)')`,
    },

    // --- Suez Governorate ---
    {
      nameEnglish: 'Suez',
      nameArabic: 'السويس',
      governorate: 'Suez',
      centerPoint: sql`ST_GeomFromEWKT('SRID=4326;POINT(32.5263 29.9668)')`,
    },
    {
      nameEnglish: 'Ain Sokhna',
      nameArabic: 'العين السخنة',
      governorate: 'Suez',
      centerPoint: sql`ST_GeomFromEWKT('SRID=4326;POINT(32.3275 29.6059)')`,
    },

    // --- Red Sea Governorate ---
    {
      nameEnglish: 'Hurghada',
      nameArabic: 'الغردقة',
      governorate: 'Red Sea',
      centerPoint: sql`ST_GeomFromEWKT('SRID=4326;POINT(33.8116 27.2579)')`,
    },
    {
      nameEnglish: 'Safaga',
      nameArabic: 'سفاجا',
      governorate: 'Red Sea',
      centerPoint: sql`ST_GeomFromEWKT('SRID=4326;POINT(33.9360 26.7505)')`,
    },
    {
      nameEnglish: 'Marsa Alam',
      nameArabic: 'مرسى علم',
      governorate: 'Red Sea',
      centerPoint: sql`ST_GeomFromEWKT('SRID=4326;POINT(34.8966 25.0684)')`,
    },
    {
      nameEnglish: 'El Quseir',
      nameArabic: 'القصير',
      governorate: 'Red Sea',
      centerPoint: sql`ST_GeomFromEWKT('SRID=4326;POINT(34.2818 26.1080)')`,
    },
    {
      nameEnglish: 'Ras Gharib',
      nameArabic: 'رأس غارب',
      governorate: 'Red Sea',
      centerPoint: sql`ST_GeomFromEWKT('SRID=4326;POINT(33.0784 28.3619)')`,
    },

    // --- South Sinai Governorate ---
    {
      nameEnglish: 'Sharm El-Sheikh',
      nameArabic: 'شرم الشيخ',
      governorate: 'South Sinai',
      centerPoint: sql`ST_GeomFromEWKT('SRID=4326;POINT(34.3299 27.9158)')`,
    },
    {
      nameEnglish: 'Dahab',
      nameArabic: 'دهب',
      governorate: 'South Sinai',
      centerPoint: sql`ST_GeomFromEWKT('SRID=4326;POINT(34.5134 28.5097)')`,
    },
    {
      nameEnglish: 'Nuweiba',
      nameArabic: 'نويبع',
      governorate: 'South Sinai',
      centerPoint: sql`ST_GeomFromEWKT('SRID=4326;POINT(34.6644 29.0345)')`,
    },
    {
      nameEnglish: 'El Tor',
      nameArabic: 'الطور',
      governorate: 'South Sinai',
      centerPoint: sql`ST_GeomFromEWKT('SRID=4326;POINT(33.6212 28.2359)')`,
    },
    {
      nameEnglish: 'Saint Catherine',
      nameArabic: 'سانت كاترين',
      governorate: 'South Sinai',
      centerPoint: sql`ST_GeomFromEWKT('SRID=4326;POINT(33.9515 28.5583)')`,
    },

    // --- North Sinai Governorate ---
    {
      nameEnglish: 'Arish',
      nameArabic: 'العريش',
      governorate: 'North Sinai',
      centerPoint: sql`ST_GeomFromEWKT('SRID=4326;POINT(33.8033 31.1316)')`,
    },
    {
      nameEnglish: 'Rafah',
      nameArabic: 'رفح',
      governorate: 'North Sinai',
      centerPoint: sql`ST_GeomFromEWKT('SRID=4326;POINT(34.2382 31.2828)')`,
    },

    // --- Matrouh Governorate ---
    {
      nameEnglish: 'Marsa Matrouh',
      nameArabic: 'مرسى مطروح',
      governorate: 'Matrouh',
      centerPoint: sql`ST_GeomFromEWKT('SRID=4326;POINT(27.2373 31.3521)')`,
    },
    {
      nameEnglish: 'El Alamein',
      nameArabic: 'العلمين',
      governorate: 'Matrouh',
      centerPoint: sql`ST_GeomFromEWKT('SRID=4326;POINT(28.9553 30.8242)')`,
    },
    {
      nameEnglish: 'Sidi Abdel Rahman',
      nameArabic: 'سيدي عبدالرحمن',
      governorate: 'Matrouh',
      centerPoint: sql`ST_GeomFromEWKT('SRID=4326;POINT(28.7188 30.9575)')`,
    },
    {
      nameEnglish: 'Siwa',
      nameArabic: 'سيوة',
      governorate: 'Matrouh',
      centerPoint: sql`ST_GeomFromEWKT('SRID=4326;POINT(25.5195 29.2014)')`,
    },

    // --- New Valley Governorate ---
    {
      nameEnglish: 'Kharga',
      nameArabic: 'الخارجة',
      governorate: 'New Valley',
      centerPoint: sql`ST_GeomFromEWKT('SRID=4326;POINT(30.5463 25.4390)')`,
    },
    {
      nameEnglish: 'Dakhla',
      nameArabic: 'الداخلة',
      governorate: 'New Valley',
      centerPoint: sql`ST_GeomFromEWKT('SRID=4326;POINT(28.9667 25.5167)')`,
    },
    {
      nameEnglish: 'Farafra',
      nameArabic: 'الفرافرة',
      governorate: 'New Valley',
      centerPoint: sql`ST_GeomFromEWKT('SRID=4326;POINT(27.9715 27.0560)')`,
    },
  ];

  for (const city of citiesData) {
    await db.insert(schema.cities).values(city).onConflictDoNothing(); // Basic prevention if run multiple times
  }

  console.log('Seeding complete. Seeded', citiesData.length, 'cities and districts.');
  await pool.end();
}

seed().catch((err) => {
  console.error(err);
  process.exit(1);
});
