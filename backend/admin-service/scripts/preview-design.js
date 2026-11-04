/** Local design review only: a fresh Docker database, synthetic accounts and repository photos. */
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import express from 'express';
import session from 'express-session';
import connectPgSimple from 'connect-pg-simple';
import bcrypt from 'bcryptjs';
import AdminJSExpress from '@adminjs/express';
import { TestDatabaseHelper, seedPrincipals, insertPost } from '../test/test-database.helper.js';
import { buildAdminJs } from '../src/adminjs/index.js';
import { buildAuthenticate } from '../src/auth/authenticate.js';
import { requireSameOrigin } from '../src/middleware/same-origin.js';
import { buildCsrfProtection } from '../src/middleware/csrf.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const database = new TestDatabaseHelper();
async function startPreview() {
  const connection = await database.start();
  if (!['localhost', '127.0.0.1', '::1'].includes(new URL(connection).hostname)) {
    await database.stop();
    throw new Error('The design preview requires its own local Docker database.');
  }
  const { pool } = database;
  const principals = await seedPrincipals(pool);
  const email = 'preview@pupzy.local';
  const password = 'PupzyPreview2026!';
  await pool.query('UPDATE admin_users SET email=$1,full_name=$2,password_hash=$3 WHERE id=$4', [
    email,
    'Design preview',
    await bcrypt.hash(password, 10),
    principals.adminId,
  ]);
  await pool.query('UPDATE users SET full_name=$1,email=$2 WHERE id=$3', [
    'Leila Samir',
    'leila@example.test',
    principals.userId,
  ]);
  const maadi = await pool.query("SELECT id FROM cities WHERE name_english='Maadi' AND governorate='Cairo' LIMIT 1");
  if (maadi.rows[0]) principals.cityId = maadi.rows[0].id;
  const reporter = await pool.query(
    `INSERT INTO users(firebase_user_id,email,full_name) VALUES('preview-reporter','omar@example.test','Omar Ali') RETURNING id`,
  );
  const fixtures = [
    ['Miso is ready for a new home', 'ADOPTION', 'PENDING_AUTO_REVIEW', 'cat_miso_1.png', 'Miso'],
    ['Found near Maadi station', 'LOST', 'FLAGGED', 'dog_bramble_1.png', 'Bramble'],
    ['A quiet home for Olive', 'ADOPTION', 'CLEAN', 'cat_olive.png', 'Olive'],
    ['Small kitten needs urgent care', 'RESCUE', 'FLAGGED', 'rescue_kitten_weak.png', 'Kitten'],
    ['Rex is looking for a mate', 'MATING', 'PENDING_AUTO_REVIEW', 'dog_rex.png', 'Rex'],
    ['Pet carrier, gently used', 'PRODUCT', 'PENDING_AUTO_REVIEW', 'product_carrier.png', 'Carrier'],
    ['Bramble is back with his family', 'LOST', 'CLEAN', 'dog_bramble_2.png', 'Bramble'],
    ['بطانية دافئة لقطتك', 'PRODUCT', 'CLEAN', 'product_blanket.png', 'Blanket'],
  ];
  const postIds = [];
  for (const [index, [title, type, moderationStatus, photo, pet]] of fixtures.entries()) {
    const id = await insertPost(pool, {
      userId: principals.userId,
      cityId: principals.cityId,
      postType: type,
      title,
      moderationStatus,
      urgency: ['RESCUE', 'LOST'].includes(type) ? 'URGENT' : undefined,
      marketCategory: type === 'PRODUCT' ? 'OTHER' : undefined,
      createdAt: new Date(Date.now() - (index + 1) * 43 * 60000),
    });
    postIds.push(id);
    await pool.query('UPDATE posts SET description=$1,area_name=$2 WHERE id=$3', [
      'A local preview listing with sample information. Miso is a gentle companion, comfortable around people and ready for a caring home.',
      'Degla',
      id,
    ]);
    if (type === 'ADOPTION') {
      await pool.query(
        `INSERT INTO adoption_posts(post_id,pet_name,species,gender,vaccinated,neutered,prior_pet_experience_required)
       VALUES($1,$2,'CAT','FEMALE',true,true,false)`,
        [id, pet],
      );
    } else if (type === 'LOST') {
      await pool.query(
        `INSERT INTO lost_posts(post_id,report_type,species,current_condition,is_currently_safe_with_reporter,date_found)
       VALUES($1,'FOUND_STRAY','DOG','HEALTHY',true,current_date)`,
        [id],
      );
    } else if (type === 'RESCUE') {
      await pool.query(
        `INSERT INTO rescue_posts(post_id,species,condition_summary,reporter_role,
      is_life_threatening,has_visible_serious_injury,is_in_dangerous_location,can_animal_move_or_escape)
      VALUES($1,'CAT','A weak kitten needs care','ON_SITE',false,false,false,false)`,
        [id],
      );
    } else if (type === 'MATING') {
      await pool.query(
        `INSERT INTO mating_posts(post_id,pet_name,species,gender,breed,age_value,age_unit,is_purebred)
       VALUES($1,$2,'DOG','MALE','Golden retriever',3,'YEARS',false)`,
        [id, pet],
      );
    } else {
      await pool.query(
        `INSERT INTO product_posts(post_id,category,condition,is_free) VALUES($1,'OTHER','LIKE_NEW',true)`,
        [id],
      );
    }
    await pool.query(
      `INSERT INTO post_media(post_id,public_url,cloudflare_storage_key,display_order,file_content_type,width,height)
     VALUES($1,$2,$3,0,'image/png',1024,1024)`,
      [id, `/preview-media/${photo}`, `preview/${id}/${photo}`],
    );
  }
  await pool.query(
    `INSERT INTO post_media(post_id,public_url,cloudflare_storage_key,display_order,file_content_type,width,height)
   VALUES($1,'/preview-media/cat_miso_2.png',$2,1,'image/png',1024,1024)`,
    [postIds[0], `preview/${postIds[0]}/cat_miso_2.png`],
  );
  for (const id of [postIds[1], postIds[3]]) {
    await pool.query(`INSERT INTO post_reports(post_id,reporter_id,reason,details) VALUES($1,$2,'SPAM',$3)`, [
      id,
      reporter.rows[0].id,
      'Please check the details and photos on this sample Post.',
    ]);
    await pool.query('UPDATE posts SET report_count=1 WHERE id=$1', [id]);
  }
  await pool.query(`INSERT INTO comments(post_id,author_id,text) VALUES($1,$2,$3)`, [
    postIds[0],
    reporter.rows[0].id,
    'Is Miso comfortable living with another cat? Happy to share more about our home.',
  ]);

  const built = await buildAdminJs(connection, new URL(connection).pathname.slice(1), pool);
  await built.admin.watch();
  const app = express();
  app.disable('x-powered-by');
  app.use('/admin/assets', express.static(path.join(here, '../src/adminjs/public')));
  app.use('/preview-media', express.static(path.join(here, '../../../frontend/assets/images')));
  app.get('/health', (_request, response) => response.json({ ok: true, preview: true }));
  app.get('/', (_request, response) => response.redirect('/admin'));
  app.use('/admin', requireSameOrigin);
  app.use('/admin', buildCsrfProtection('pupzy-local-design-preview-csrf-secret-2026'));
  const PgSession = connectPgSimple(session);
  app.use(
    '/admin',
    AdminJSExpress.buildAuthenticatedRouter(
      built.admin,
      {
        authenticate: buildAuthenticate(pool),
        cookiePassword: 'pupzy-local-design-preview-cookie-secret-2026',
        cookieName: 'pupzy_design_preview',
      },
      null,
      {
        store: new PgSession({
          pool,
          createTableIfMissing: false,
          pruneSessionInterval: false,
          tableName: 'admin_sessions',
        }),
        resave: false,
        saveUninitialized: false,
        secret: 'pupzy-local-design-preview-session-secret-2026',
        cookie: { httpOnly: true, sameSite: 'lax' },
      },
    ),
  );
  const port = Number(process.env.PUPZY_PREVIEW_PORT || 4100);
  const server = app.listen(port, '127.0.0.1', () => {
    console.log(`Local design preview: http://localhost:${port}/admin`);
    console.log(`Sample login: ${email} / ${password}`);
    console.log(`Sample Post: http://localhost:${port}/admin/resources/posts/records/${postIds[0]}/show`);
    console.log('Fresh disposable Docker database. Stop with Ctrl+C to remove it.');
  });
  let stopping = false;
  async function stop() {
    if (stopping) return;
    stopping = true;
    await new Promise((resolve) => server.close(resolve));
    await built.sqlAdapterPool.destroy();
    await database.stop();
    process.exit(0);
  }
  process.once('SIGINT', () => void stop());
  process.once('SIGTERM', () => void stop());
}

await startPreview().catch(async (error) => {
  console.error('Local preview could not start:', error.message);
  await database.stop().catch(() => {});
  process.exitCode = 1;
});
