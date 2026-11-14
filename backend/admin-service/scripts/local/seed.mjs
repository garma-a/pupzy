// Realistic LOCAL-ONLY demo data for the admin service. Never run against a real database.
import bcrypt from 'bcryptjs';

export const LOCAL_LOGINS = {
  superAdmin: { email: 'superadmin@pupzy.local', password: 'LocalSuper#2026', name: 'Sara Super (local)', role: 'SUPER_ADMIN' },
  admin: { email: 'moderator@pupzy.local', password: 'LocalMod#2026x', name: 'Mona Moderator (local)', role: 'ADMIN' },
};

const USERS = [
  { key: 'omar', name: 'Omar Hassan', ar: 'عمر حسن', avatar: 'user1.png' },
  { key: 'nour', name: 'Nour El-Din', ar: 'نور الدين', avatar: 'user2.png' },
  { key: 'mariam', name: 'Mariam Adel', ar: 'مريم عادل', avatar: 'user3.png' },
  { key: 'youssef', name: 'Youssef Samir', ar: 'يوسف سمير', avatar: null },
  { key: 'laila', name: 'Laila Farouk', ar: 'ليلى فاروق', avatar: 'user4.png' },
  { key: 'karim', name: 'Karim Mostafa', ar: null, avatar: null },
  { key: 'hana', name: null, ar: 'هنا إبراهيم', avatar: null },
  { key: 'spammer', name: 'Cheap Deals Seller', ar: null, avatar: null, banned: true },
];

export async function seed(pool, mediaBase) {
  const q = (text, params) => pool.query(text, params).then((r) => r.rows);
  const one = async (text, params) => (await q(text, params))[0];

  for (const a of Object.values(LOCAL_LOGINS)) {
    await q(`INSERT INTO admin_users (email, password_hash, full_name, role) VALUES ($1,$2,$3,$4)`, [
      a.email, await bcrypt.hash(a.password, 10), a.name, a.role,
    ]);
  }

  const cityRows = await q(
    `SELECT id, name_english FROM cities WHERE name_english IN ('Nasr City','Maadi','Smouha','Heliopolis') ORDER BY name_english`,
  );
  const cities = cityRows.length ? cityRows : await q(`SELECT id, name_english FROM cities LIMIT 4`);
  const cityId = (i) => cities[i % cities.length].id;

  const users = {};
  for (const [i, u] of USERS.entries()) {
    const row = await one(
      `INSERT INTO users (firebase_user_id, email, full_name, full_name_arabic, profile_picture_url, home_city_id,
         phone_number, language_preference, is_banned, banned_at, ban_reason, last_seen_at, created_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11, now() - ($12 || ' hours')::interval, now() - ($13 || ' days')::interval)
       RETURNING id`,
      [
        `local-fb-${u.key}`, `${u.key}@example.test`, u.name, u.ar,
        u.avatar ? `${mediaBase}/avatars/${u.avatar}` : null, cityId(i), `+2010000000${i}`,
        i % 2 ? 'ar' : 'en', false, null, null, String(i * 5 + 1), String(30 + i * 9),
      ],
    );
    users[u.key] = row.id;
  }

  let photoNo = 0;
  async function post(key, type, title, description, extra = {}) {
    const row = await one(
      `INSERT INTO posts (creator_id, post_type, title, description, status, moderation_status, urgency, city_id, area_name,
         coordinates, market_category, report_count, created_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9, ST_SetSRID(ST_MakePoint($10,$11),4326), $12, 0, now() - ($13 || ' hours')::interval)
       RETURNING id`,
      [
        users[extra.creator], type, title, description, extra.status ?? 'ACTIVE', extra.moderation ?? 'PENDING_AUTO_REVIEW',
        ['RESCUE', 'LOST'].includes(type) ? (extra.urgency ?? 'URGENT') : null, cityId(extra.city ?? 0), extra.area ?? null,
        31.3 + Math.random() * 0.1, 30.0 + Math.random() * 0.1, type === 'PRODUCT' ? 'FOOD' : null, String(extra.age ?? 5),
      ],
    );
    for (let n = 0; n < (extra.photos ?? 2); n += 1) {
      photoNo = (photoNo % 6) + 1;
      await q(
        `INSERT INTO post_media (post_id, public_url, cloudflare_storage_key, display_order, file_content_type, width, height)
         VALUES ($1,$2,$3,$4,'image/jpeg',800,600)`,
        [row.id, `${mediaBase}/posts/photo${photoNo}.jpg`, `posts/${row.id}/photo${photoNo}.jpg`, n],
      );
    }
    return row.id;
  }

  const P = {};
  P.rescue = await post('rescue', 'RESCUE', 'Injured kitten under a car near Nasr City mall', 'Small grey kitten, limping, hiding under a parked car since morning. Needs a vet.', { creator: 'omar', city: 0, area: 'Nasr City', urgency: 'CRITICAL', moderation: 'FLAGGED', age: 3 });
  await q(`INSERT INTO rescue_posts (post_id, species, condition_summary, reporter_role, is_life_threatening, has_visible_serious_injury, is_in_dangerous_location, can_animal_move_or_escape) VALUES ($1,'CAT','Limping, bleeding paw','REPORTING',true,true,true,false)`, [P.rescue]);
  P.lost = await post('lost', 'LOST', 'Lost golden retriever "Bella" in Maadi', 'Last seen near Road 9 wearing a red collar. Very friendly.', { creator: 'nour', city: 1, area: 'Maadi', moderation: 'PENDING_AUTO_REVIEW', age: 20 });
  await q(`INSERT INTO lost_posts (post_id, report_type, species, breed, color_and_markings, has_collar_with_identification_tag, pet_name, date_last_seen) VALUES ($1,'LOST_PET','DOG','Golden Retriever','Golden, white chest',true,'Bella', current_date - 1)`, [P.lost]);
  P.adoption = await post('adoption', 'ADOPTION', 'Free adoption: two playful puppies', 'Vaccinated, 3 months old, good with kids.', { creator: 'mariam', city: 2, area: 'Smouha', moderation: 'CLEAN', age: 48 });
  await q(`INSERT INTO adoption_posts (post_id, pet_name, species, breed, age_value, age_unit, gender, vaccinated) VALUES ($1,'Coco & Max','DOG','Mixed',3,'MONTHS','UNKNOWN',true)`, [P.adoption]);
  P.product = await post('product', 'PRODUCT', 'Premium dry cat food 10kg, sealed', 'Unopened bag, selling because my cat switched diet. Price negotiable.', { creator: 'youssef', city: 3, area: 'Heliopolis', moderation: 'FLAGGED', age: 70 });
  await q(`INSERT INTO product_posts (post_id, category, condition, price_amount, open_to_offers) VALUES ($1,'FOOD','NEW',900,true)`, [P.product]);
  P.mating = await post('mating', 'MATING', 'Purebred Persian male looking for a mate', 'Pedigree certificate available, vaccinated.', { creator: 'laila', city: 0, moderation: 'PENDING_AUTO_REVIEW', age: 100 });
  await q(`INSERT INTO mating_posts (post_id, pet_name, species, breed, gender, age_value, age_unit) VALUES ($1,'Simba','CAT','Persian','MALE',2,'YEARS')`, [P.mating]);
  P.spam = await post('spam', 'PRODUCT', 'CHEAP iPhones whatsapp me now!!!', 'Click my link for amazing deals. Not about animals at all.', { creator: 'spammer', city: 1, moderation: 'FLAGGED', photos: 1, age: 200 });
  await q(`INSERT INTO product_posts (post_id, category, condition, price_amount) VALUES ($1,'OTHER','NEW',100)`, [P.spam]);
  P.rescue2 = await post('rescue2', 'RESCUE', 'Dog with a rope around its neck, Heliopolis', 'Street dog, rope very tight. Rescuers needed.', { creator: 'karim', city: 3, area: 'Heliopolis', urgency: 'URGENT', moderation: 'CLEAN', age: 8 });
  await q(`INSERT INTO rescue_posts (post_id, species, condition_summary, reporter_role, is_life_threatening, has_visible_serious_injury, is_in_dangerous_location, can_animal_move_or_escape) VALUES ($1,'DOG','Rope around neck','ON_SITE',false,true,false,true)`, [P.rescue2]);

  async function comment(postKey, author, text, { parent = null, images = 0, status = 'ACTIVE', ageMin = 30 } = {}) {
    const row = await one(
      `INSERT INTO comments (post_id, author_id, parent_id, text, status, created_at)
       VALUES ($1,$2,$3,$4,$5, now() - ($6 || ' minutes')::interval) RETURNING id`,
      [P[postKey], users[author], parent, text, status, String(ageMin)],
    );
    for (let n = 0; n < images; n += 1) {
      const file = `evidence${((photoNo + n) % 4) + 1}.webp`;
      photoNo += 1;
      await q(
        `INSERT INTO comment_media (comment_id, storage_key, sha256, width, height, file_size_bytes, file_content_type, display_order)
         VALUES ($1,$2,$3,640,480,20000,'image/webp',$4)`,
        [row.id, `comments/${row.id}/${file}`, row.id.replace(/-/g, '').padEnd(64, 'a'), n],
      );
    }
    if (parent) await q(`UPDATE comments SET reply_count = reply_count + 1 WHERE id = $1`, [parent]);
    await q(`UPDATE posts SET comment_count = comment_count + 1 WHERE id = $1`, [P[postKey]]);
    return row.id;
  }

  const C = {};
  C.rescueEvidence = await comment('rescue', 'mariam', 'I am on site now, here are two photos of the kitten, it is breathing but very weak.', { images: 2, ageMin: 90 });
  C.rescueReply = await comment('rescue', 'omar', 'Thank you! Is anyone able to carry it to a clinic?', { parent: C.rescueEvidence, ageMin: 80 });
  C.rescueReply2 = await comment('rescue', 'karim', 'I can transport it in 30 minutes. Photo of my car attached is not possible, but I am coming.', { parent: C.rescueEvidence, ageMin: 70 });
  C.rescueBad = await comment('rescue', 'spammer', 'Call this number for cheap pet transport 01000000000 !!!', { images: 1, ageMin: 60 });
  C.lostSighting = await comment('lost', 'laila', 'Saw a golden dog like this near the club gate this morning, photo attached.', { images: 1, ageMin: 200 });
  C.lostReply = await comment('lost', 'nour', 'Thank you so much, going there now!', { parent: C.lostSighting, ageMin: 190 });
  C.adoptionText = await comment('adoption', 'omar', 'Are they still available? Is the vaccination card included?', { ageMin: 600 });
  C.adoptionReply = await comment('adoption', 'mariam', 'Yes, still available. Card included.', { parent: C.adoptionText, ageMin: 590 });
  C.productText = await comment('product', 'nour', 'Is the expiry date 2027?', { ageMin: 400 });
  C.matingText = await comment('mating', 'hana', 'مبروك على القطة الجميلة، هل لديها شهادة نسب؟', { ageMin: 500 });

  const [reporterA, reporterB] = [users.nour, users.hana];
  const pr = (post, reporter, reason, details) =>
    q(`INSERT INTO post_reports (post_id, reporter_id, reason, details) VALUES ($1,$2,$3,$4)`, [P[post], reporter, reason, details]);
  await pr('rescue', users.karim, 'DUPLICATE', 'Same kitten was posted yesterday by someone else.');
  await pr('product', reporterA, 'SPAM', 'Looks like a recycled listing.');
  await pr('spam', reporterA, 'UNRELATED_TO_ANIMALS', 'This sells phones, not pet products.');
  await pr('spam', reporterB, 'SCAM', 'Asks to move to WhatsApp immediately.');
  await pr('mating', users.omar, 'INAPPROPRIATE_CONTENT', null);
  await pr('lost', users.youssef, 'OTHER', 'Photos look stolen from the internet.');
  await q(`UPDATE posts p SET report_count = (SELECT count(*) FROM post_reports r WHERE r.post_id = p.id)`);

  const cr = (comment, reporter, reason, details) =>
    q(`INSERT INTO comment_reports (comment_id, reporter_id, reason, details) VALUES ($1,$2,$3,$4)`, [C[comment], reporter, reason, details]);
  await cr('rescueBad', users.omar, 'SPAM', 'Advertising a phone number on an emergency rescue.');
  await cr('rescueBad', users.mariam, 'SCAM', null);
  await cr('rescueEvidence', users.spammer, 'OTHER', 'These photos look fake (retaliation report).');
  await cr('lostReply', users.hana, 'INAPPROPRIATE_CONTENT', 'Rude language.');
  await cr('adoptionReply', users.karim, 'SPAM', null);

  const ar = (reported, reporter, reason, details, source = null) =>
    q(`INSERT INTO account_reports (reporter_id, reported_user_id, reason, details, source_type, source_id) VALUES ($1,$2,$3,$4,$5,$6)`,
      [users[reporter], users[reported], reason, details, source?.[0] ?? null, source?.[1] ?? null]);
  await ar('spammer', 'omar', 'SPAM', 'Messages everyone with ads.', ['POST', P.spam]);
  await ar('spammer', 'mariam', 'SCAM_OR_FRAUD', 'Tried to sell me a fake item.');
  await ar('karim', 'youssef', 'HARASSMENT', 'Keeps insulting me in comments.', ['COMMENT', C.productText]);
  await ar('laila', 'hana', 'IMPERSONATION', 'Uses my name and photo.');

  // One already-closed historical report so "reviewed" states exist from the start.
  await q(`UPDATE post_reports SET reviewed_at = now() - interval '2 days',
      reviewed_by_admin_id = (SELECT id FROM admin_users WHERE role='ADMIN'), review_outcome='NO_ACTION'
    WHERE reason = 'OTHER' AND post_id = $1`, [P.lost]);

  // Ban last: the DB forbids an active post whose creator is already banned.
  await q(`UPDATE users SET is_banned = true, banned_at = now(), ban_reason = 'Repeated spam listings' WHERE id = $1`, [users.spammer]);

  return { users, posts: P, comments: C };
}
