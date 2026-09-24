/**
 * Seeds a dozen realistic MATING posts into a LOCAL development database so the
 * Mating feed, detail screen and contact-request flow can be exercised by hand.
 *
 * The posts are owned by real, completed accounts that already exist in the
 * database (not throwaway users), alternating between them. That way you can
 * sign in as one account to request contact and as the other to approve it —
 * both sides of the handshake work, including the WhatsApp link.
 *
 * Usage:
 *   npm run db:seed:mock-mating                          # owners = every completed account
 *   npm run db:seed:mock-mating -- --owner a@x.com       # only this account (repeatable)
 *   npm run db:seed:mock-mating -- --city "Maadi"        # target city (repeatable)
 *   npm run db:seed:mock-mating -- --reset               # replace previously seeded posts
 *
 * Cities default to the owners' home cities, because the Mating feed is scoped
 * to the viewer's city — posts elsewhere would never show up.
 *
 * Seeded posts are recognised by their media storage keys (`mock-seed/mating/…`),
 * which never collide with real upload keys (`posts/…`). Photos are hot-linked
 * breed photos (dog.ceo / thecatapi) stored in `post_media.public_url`, which
 * the API serves verbatim, so no R2 upload is involved.
 */
import { Pool } from 'pg';
import { drizzle } from 'drizzle-orm/node-postgres';
import { sql } from 'drizzle-orm';
import * as schema from '../src/database/schema';

import * as dotenv from 'dotenv';
dotenv.config();

const MOCK_KEY_PREFIX = 'mock-seed/mating/';

type Species = 'DOG' | 'CAT';
type Gender = 'MALE' | 'FEMALE';

interface MockPet {
  title: string;
  description: string;
  petName: string;
  species: Species;
  breed: string;
  gender: Gender;
  ageValue: number;
  ageUnit: 'MONTHS' | 'YEARS';
  isPurebred: boolean;
  hasPedigreeCertificate: boolean;
  vaccinated: boolean;
  dewormed: boolean;
  termsSummary: string | null;
  matingConditions: string | null;
  photos: string[];
}

const DOG = 'https://images.dog.ceo/breeds';
const CAT = 'https://s3.us-west-2.amazonaws.com/cdn2.thecatapi.com/images';

const PETS: MockPet[] = [
  {
    title: 'German Shepherd male for mating — imported bloodline',
    description:
      'Rex is a calm, well-trained German Shepherd with a straight back and a dark saddle. Imported parents from Serbia, excellent temperament with kids. Available for serious breeders only.',
    petName: 'Rex',
    species: 'DOG',
    breed: 'German Shepherd',
    gender: 'MALE',
    ageValue: 3,
    ageUnit: 'YEARS',
    isPurebred: true,
    hasPedigreeCertificate: true,
    vaccinated: true,
    dewormed: true,
    termsSummary: 'First pick of the litter',
    matingConditions: 'Female must be vaccinated and dewormed. Mating at our place, evenings only.',
    photos: [`${DOG}/german-shepherd/n02106662_104.jpg`, `${DOG}/german-shepherd/n02106662_13368.jpg`],
  },
  {
    title: 'جولدن ريتريفر أنثى للتزاوج',
    description:
      'هاني جولدن ريتريفر أنثى، هادية جدًا ومتعودة على الناس والأطفال. محتاجين ذكر جولدن نقي وبصحة كويسة. التطعيمات كاملة ومعاها كارنيه.',
    petName: 'Honey',
    species: 'DOG',
    breed: 'Golden Retriever',
    gender: 'FEMALE',
    ageValue: 2,
    ageUnit: 'YEARS',
    isPurebred: true,
    hasPedigreeCertificate: false,
    vaccinated: true,
    dewormed: true,
    termsSummary: 'نقسم الولادة بالاتفاق',
    matingConditions: 'الذكر لازم يكون متطعم وعنده كشف بيطري حديث.',
    photos: [`${DOG}/retriever-golden/pxl_20220125_060304705.mp.jpg`, `${DOG}/retriever-golden/n02099601_6980.jpg`],
  },
  {
    title: 'Siberian Husky male, blue eyes',
    description:
      'Storm is a friendly, high-energy Husky with striking blue eyes and a full double coat. Healthy, active, and very social with other dogs.',
    petName: 'Storm',
    species: 'DOG',
    breed: 'Siberian Husky',
    gender: 'MALE',
    ageValue: 4,
    ageUnit: 'YEARS',
    isPurebred: true,
    hasPedigreeCertificate: false,
    vaccinated: true,
    dewormed: true,
    termsSummary: 'One puppy from the litter',
    matingConditions: 'Purebred Husky females only. Please share vaccination records first.',
    photos: [`${DOG}/husky/n02110185_9712.jpg`, `${DOG}/husky/n02110185_5159.jpg`],
  },
  {
    title: 'بومرينيان أنثى صغيرة الحجم',
    description:
      'لولو بومرينيان أنثى لونها كريمي، حجمها صغير جدًا وشعرها كثيف. عايزين ذكر بومرينيان نفس الحجم تقريبًا.',
    petName: 'Lulu',
    species: 'DOG',
    breed: 'Pomeranian',
    gender: 'FEMALE',
    ageValue: 18,
    ageUnit: 'MONTHS',
    isPurebred: true,
    hasPedigreeCertificate: false,
    vaccinated: true,
    dewormed: true,
    termsSummary: 'جرو واحد لصاحب الذكر',
    matingConditions: 'المقابلة الأولى عندنا عشان الكلاب تتعرف على بعض.',
    photos: [`${DOG}/pomeranian/n02112018_7127.jpg`, `${DOG}/pomeranian/n02112018_6319.jpg`],
  },
  {
    title: 'Rottweiler male — strong, pedigree certified',
    description:
      'Tyson is a well-built Rottweiler with a big head and a balanced, confident temperament. Hip-checked by our vet last month. Pedigree papers available to see in person.',
    petName: 'Tyson',
    species: 'DOG',
    breed: 'Rottweiler',
    gender: 'MALE',
    ageValue: 3,
    ageUnit: 'YEARS',
    isPurebred: true,
    hasPedigreeCertificate: true,
    vaccinated: true,
    dewormed: true,
    termsSummary: 'Fee or first pick — negotiable',
    matingConditions: 'Female must be at least 2 years old and in good health.',
    photos: [`${DOG}/rottweiler/n02106550_11465.jpg`],
  },
  {
    title: 'مالتيز ذكر أبيض للتزاوج',
    description: 'كوتون مالتيز ذكر، أبيض بالكامل، لطيف جدًا ومتعود على البيت. صحته ممتازة وبياكل دراي فود بس.',
    petName: 'Cotton',
    species: 'DOG',
    breed: 'Maltese',
    gender: 'MALE',
    ageValue: 2,
    ageUnit: 'YEARS',
    isPurebred: true,
    hasPedigreeCertificate: false,
    vaccinated: true,
    dewormed: true,
    termsSummary: 'مجاني لأصحاب الإناث المالتيز النقية',
    matingConditions: null,
    photos: [`${DOG}/maltese/n02085936_3677.jpg`, `${DOG}/maltese/n02085936_9136.jpg`],
  },
  {
    title: 'Chow Chow female looking for a male',
    description:
      'Mishmish is a fluffy cinnamon Chow Chow with the classic blue-black tongue. Very calm and a bit independent, like every chow. Looking for a healthy purebred male.',
    petName: 'Mishmish',
    species: 'DOG',
    breed: 'Chow Chow',
    gender: 'FEMALE',
    ageValue: 2,
    ageUnit: 'YEARS',
    isPurebred: true,
    hasPedigreeCertificate: false,
    vaccinated: true,
    dewormed: true,
    termsSummary: 'Split the litter',
    matingConditions: 'Male must be vaccinated. We can travel within Cairo.',
    photos: [`${DOG}/chow/n02112137_2106.jpg`, `${DOG}/chow/n02112137_14004.jpg`],
  },
  {
    title: 'Labrador female, yellow — first mating',
    description:
      "Bella is a sweet yellow Labrador, great with kids and other dogs. This will be her first litter, so we're looking for an experienced, gentle male.",
    petName: 'Bella',
    species: 'DOG',
    breed: 'Labrador Retriever',
    gender: 'FEMALE',
    ageValue: 2,
    ageUnit: 'YEARS',
    isPurebred: true,
    hasPedigreeCertificate: false,
    vaccinated: true,
    dewormed: true,
    termsSummary: 'Pick of the litter for the male owner',
    matingConditions: 'Experienced males preferred. Vet check required for both.',
    photos: [`${DOG}/labrador/n02099712_3698.jpg`],
  },
  {
    title: 'قطة هيمالايا أنثى عيونها زرقا',
    description:
      'لونا قطة هيمالايا، عيونها زرقا وشعرها طويل. هادية جدًا وبتحب الناس. محتاجين ذكر هيمالايا أو شيرازي نقي.',
    petName: 'Luna',
    species: 'CAT',
    breed: 'Himalayan',
    gender: 'FEMALE',
    ageValue: 14,
    ageUnit: 'MONTHS',
    isPurebred: true,
    hasPedigreeCertificate: false,
    vaccinated: true,
    dewormed: true,
    termsSummary: 'قطة من الولادة لصاحب الذكر',
    matingConditions: 'الذكر لازم يكون متطعم ومفيهوش أي أمراض جلدية.',
    photos: [`${CAT}/lZOJKmkxY.jpg`],
  },
  {
    title: 'Scottish Fold male — folded ears',
    description:
      'Oscar is a Scottish Fold with perfectly folded ears and a round face. Very affectionate and relaxed. Only for straight-eared females (fold × straight is the healthy pairing).',
    petName: 'Oscar',
    species: 'CAT',
    breed: 'Scottish Fold',
    gender: 'MALE',
    ageValue: 2,
    ageUnit: 'YEARS',
    isPurebred: true,
    hasPedigreeCertificate: true,
    vaccinated: true,
    dewormed: true,
    termsSummary: 'One kitten from the litter',
    matingConditions: 'Straight-eared females only — no fold × fold pairings.',
    photos: [`${CAT}/dne.jpg`, `${CAT}/blc.jpg`],
  },
  {
    title: 'Bengal male with rosette pattern',
    description:
      'Simba is an active Bengal with a clear spotted coat and green-gold eyes. Very playful and curious. Healthy and fully vaccinated.',
    petName: 'Simba',
    species: 'CAT',
    breed: 'Bengal',
    gender: 'MALE',
    ageValue: 3,
    ageUnit: 'YEARS',
    isPurebred: true,
    hasPedigreeCertificate: false,
    vaccinated: true,
    dewormed: true,
    termsSummary: 'Fee negotiable',
    matingConditions: 'Female stays with us for 3–4 days in a separate room.',
    photos: [`${CAT}/Ba-qRZ_8n.jpg`],
  },
  {
    title: 'تركي أنجورا أنثى بيضاء',
    description:
      'سكر قطة تركي أنجورا، بيضاء بالكامل وعيونها خضرا. رقيقة جدًا ومتربية في البيت. عايزين ذكر أنجورا أو شيرازي أبيض.',
    petName: 'Sukkar',
    species: 'CAT',
    breed: 'Turkish Angora',
    gender: 'FEMALE',
    ageValue: 20,
    ageUnit: 'MONTHS',
    isPurebred: true,
    hasPedigreeCertificate: false,
    vaccinated: true,
    dewormed: true,
    termsSummary: 'نقسم الولادة',
    matingConditions: null,
    photos: [`${CAT}/eh4.png`],
  },
];

function parseArgs(argv: string[]) {
  const owners: string[] = [];
  const cities: string[] = [];
  let reset = false;
  let allowRemote = false;
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--owner') owners.push(argv[++i]?.trim().toLowerCase());
    else if (arg === '--city') cities.push(argv[++i]?.trim());
    else if (arg === '--reset') reset = true;
    else if (arg === '--allow-remote') allowRemote = true;
    else throw new Error(`Unknown argument: ${arg}`);
  }
  if (owners.some((o) => !o) || cities.some((c) => !c)) throw new Error('--owner and --city need a value');
  return { owners, cities, reset, allowRemote };
}

/** Mock data belongs in a developer's database, never a shared or production one. */
function assertLocalDatabase(url: string | undefined, allowRemote: boolean) {
  if (!url) throw new Error('DATABASE_URL is not set');
  const host = new URL(url).hostname;
  if (!['localhost', '127.0.0.1', '::1', '[::1]'].includes(host) && !allowRemote) {
    throw new Error(
      `Refusing to seed mock posts into a non-local database (${host}). Pass --allow-remote to override.`,
    );
  }
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  assertLocalDatabase(process.env.DATABASE_URL, args.allowRemote);

  const pool = new Pool({ connectionString: process.env.DATABASE_URL });
  const db = drizzle(pool, { schema });

  try {
    const existing = await db.execute<{ id: string }>(sql`
      SELECT DISTINCT pm.post_id AS id FROM post_media pm
      WHERE pm.cloudflare_storage_key LIKE ${MOCK_KEY_PREFIX + '%'}
    `);
    if (existing.rows.length > 0 && !args.reset) {
      console.log(`ℹ ${existing.rows.length} mock mating posts already exist. Re-run with --reset to replace them.`);
      return;
    }

    // Owners: completed, unbanned accounts. A phone number is required so an
    // approved contact request can actually hand out a WhatsApp link.
    const owners = await db.execute<{ id: string; email: string; full_name: string; home_city_id: string | null }>(sql`
      SELECT id, email, full_name, home_city_id FROM users
      WHERE full_name IS NOT NULL AND phone_number IS NOT NULL AND is_banned = false
      ${
        args.owners.length
          ? sql`AND lower(email) IN (${sql.join(
              args.owners.map((o) => sql`${o}`),
              sql`, `,
            )})`
          : sql``
      }
      ORDER BY created_at
    `);
    if (owners.rows.length === 0) {
      throw new Error('No completed, unbanned accounts found to own the posts. Complete a profile in the app first.');
    }
    const missingOwners = args.owners.filter((o) => !owners.rows.some((r) => r.email.toLowerCase() === o));
    if (missingOwners.length) throw new Error(`No completed account for: ${missingOwners.join(', ')}`);

    const cityRows = await db.execute<{
      id: string;
      name_english: string;
      governorate: string;
      lon: number;
      lat: number;
    }>(
      args.cities.length
        ? sql`
            SELECT id, name_english, governorate, ST_X(center_point) AS lon, ST_Y(center_point) AS lat FROM cities
            WHERE status = 'OFFICIAL' AND lower(name_english) IN (${sql.join(
              args.cities.map((c) => sql`${c.toLowerCase()}`),
              sql`, `,
            )})`
        : sql`
            SELECT DISTINCT c.id, c.name_english, c.governorate, ST_X(c.center_point) AS lon, ST_Y(c.center_point) AS lat
            FROM cities c
            WHERE c.id IN (${sql.join(
              owners.rows.filter((o) => o.home_city_id).map((o) => sql`${o.home_city_id}`),
              sql`, `,
            )})`,
    );
    if (cityRows.rows.length === 0) throw new Error('No target city found — pass --city "<English city name>".');
    const missingCities = args.cities.filter(
      (c) => !cityRows.rows.some((r) => r.name_english.toLowerCase() === c.toLowerCase()),
    );
    if (missingCities.length) throw new Error(`Unknown official city: ${missingCities.join(', ')}`);
    const cities = cityRows.rows;

    await db.transaction(async (tx) => {
      if (existing.rows.length > 0) {
        await tx.execute(sql`
          DELETE FROM posts WHERE id IN (${sql.join(
            existing.rows.map((r) => sql`${r.id}`),
            sql`, `,
          )})
        `);
        console.log(`🗑  Removed ${existing.rows.length} previously seeded mock mating posts.`);
      }

      const now = Date.now();
      for (const [i, pet] of PETS.entries()) {
        // Owners alternate per post; cities rotate per pair of posts. With two
        // owners and two cities, every city's feed gets posts from both owners
        // and a mix of dogs and cats (PETS lists all dogs before the cats).
        const owner = owners.rows[i % owners.rows.length];
        const city = cities[Math.floor(i / owners.rows.length) % cities.length];
        // Stagger creation so the feed's createdAt ordering looks natural.
        const createdAt = new Date(now - i * 5 * 60 * 60 * 1000);

        const [post] = await tx
          .insert(schema.posts)
          .values({
            creatorId: owner.id,
            postType: 'MATING',
            title: pet.title,
            description: pet.description,
            status: 'ACTIVE',
            moderationStatus: 'CLEAN',
            urgency: null,
            cityId: city.id,
            governorate: city.governorate,
            // MATING never collects GPS: the city centroid only satisfies NOT NULL.
            coordinates: sql`ST_SetSRID(ST_MakePoint(${city.lon}, ${city.lat}), 4326)`,
            viewCount: 20 + ((i * 37) % 180),
            lastEngagedAt: createdAt,
            createdAt,
            updatedAt: createdAt,
          })
          .returning({ id: schema.posts.id });

        await tx.insert(schema.matingPosts).values({
          postId: post.id,
          petName: pet.petName,
          species: pet.species,
          breed: pet.breed,
          gender: pet.gender,
          ageValue: pet.ageValue,
          ageUnit: pet.ageUnit,
          isPurebred: pet.isPurebred,
          hasPedigreeCertificate: pet.hasPedigreeCertificate,
          vaccinated: pet.vaccinated,
          dewormed: pet.dewormed,
          termsSummary: pet.termsSummary,
          matingConditions: pet.matingConditions,
        });

        await tx.insert(schema.postMedia).values(
          pet.photos.map((url, order) => ({
            postId: post.id,
            publicUrl: url,
            cloudflareStorageKey: `${MOCK_KEY_PREFIX}${post.id}/${order}`,
            displayOrder: order,
            fileContentType: url.endsWith('.png') ? 'image/png' : 'image/jpeg',
          })),
        );

        console.log(`✓ ${pet.species.padEnd(3)} ${pet.petName.padEnd(9)} → ${owner.email} · ${city.name_english}`);
      }
    });

    console.log(`\n✅ Seeded ${PETS.length} mock mating posts across ${cities.map((c) => c.name_english).join(', ')}.`);
    console.log('   Browse one of those cities in the app (top-bar location pill) to see them.');
  } finally {
    await pool.end();
  }
}

main().catch((err) => {
  // Drizzle wraps driver errors; the Postgres reason lives on `cause`.
  const cause = err instanceof Error && err.cause instanceof Error ? err.cause.message : '';
  console.error('❌', err instanceof Error ? err.message.split('\n')[0] : err);
  if (cause) console.error('  ', cause);
  process.exit(1);
});
