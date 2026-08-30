import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { after, before, beforeEach, describe, it } from 'node:test';
import AdminJSExpress from '@adminjs/express';
import bcrypt from 'bcryptjs';
import connectPgSimple from 'connect-pg-simple';
import express from 'express';
import helmet from 'helmet';
import puppeteer from 'puppeteer-core';
import session from 'express-session';
import rateLimit from 'express-rate-limit';

import { buildAdminJs } from '../src/adminjs/index.js';
import { buildAuthenticate } from '../src/auth/authenticate.js';
import { buildCsrfProtection } from '../src/middleware/csrf.js';
import { requireSameOrigin } from '../src/middleware/same-origin.js';
import { TestDatabaseHelper, seedPrincipals } from './test-database.helper.js';

const currentDirectory = path.dirname(fileURLToPath(import.meta.url));
const database = new TestDatabaseHelper();

let server;
let baseUrl;
let sqlAdapterPool;
let principals;
let browser;
let cairoId;
let gizaId;

function findChromePath() {
  if (process.env.CHROME_BIN && fs.existsSync(process.env.CHROME_BIN)) {
    return process.env.CHROME_BIN;
  }
  for (const p of ['/usr/bin/google-chrome', '/usr/bin/chromium-browser', '/usr/bin/chromium']) {
    if (fs.existsSync(p)) return p;
  }
  throw new Error('Chrome/Chromium binary not found on system.');
}

async function createTestPage(browserInstance, allowedErrors = []) {
  const page = await browserInstance.newPage();
  page.setDefaultTimeout(60000);
  page.setDefaultNavigationTimeout(60000);
  await page.setViewport({ width: 1280, height: 900 });

  const errors = [];
  page.on('pageerror', (err) => {
    errors.push(`PageError: ${err.message}`);
  });
  page.on('console', (msg) => {
    if (msg.type() === 'error') {
      const text = msg.text();
      const isAllowed = allowedErrors.some((pat) => (pat instanceof RegExp ? pat.test(text) : text.includes(pat)));
      if (!isAllowed) {
        errors.push(`ConsoleError: ${text}`);
      }
    }
  });

  await page.evaluateOnNewDocument(() => {
    window.__cspViolations = [];
    document.addEventListener('securitypolicyviolation', (e) => {
      window.__cspViolations.push({
        blockedURI: e.blockedURI,
        violatedDirective: e.violatedDirective,
        effectiveDirective: e.effectiveDirective,
        originalPolicy: e.originalPolicy,
      });
    });
  });

  return { page, errors };
}

async function loginAsAdmin(page, url, email = 'admin@example.com', password = 'super secure password') {
  await page.goto(`${url}/admin/login`, { waitUntil: 'networkidle0' });
  await page.type('input[name="email"]', email);
  await page.type('input[name="password"]', password);
  await Promise.all([page.waitForNavigation({ waitUntil: 'networkidle0' }), page.click('form button')]);
}

async function selectCityDropdown(page, cityName) {
  const cityInput = await page.evaluateHandle(() => {
    const label = Array.from(document.querySelectorAll('label')).find(
      (l) => l.innerText.includes('City Id') || l.innerText.includes('City'),
    );
    return label ? label.parentElement.querySelector('input') : null;
  });
  assert.ok(cityInput, 'City select input must exist');

  await cityInput.focus();
  await page.keyboard.type(cityName);
  await new Promise((r) => setTimeout(r, 400));
  await page.keyboard.press('Enter');
  await new Promise((r) => setTimeout(r, 600));
}

async function clearAndType(page, selector, text) {
  await page.click(selector);
  await page.evaluate((sel) => {
    const el = document.querySelector(sel);
    if (el) {
      const nativeInputValueSetter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value')?.set;
      if (nativeInputValueSetter) {
        nativeInputValueSetter.call(el, '');
      } else {
        el.value = '';
      }
      el.dispatchEvent(new Event('input', { bubbles: true }));
      el.dispatchEvent(new Event('change', { bubbles: true }));
    }
  }, selector);
  if (text) {
    await page.type(selector, text);
  }
  await new Promise((r) => setTimeout(r, 150));
}

before(async () => {
  const connectionString = await database.start();
  principals = await seedPrincipals(database.pool);
  const superHash = await bcrypt.hash('super secure password', 4);
  await database.pool.query(`UPDATE admin_users SET password_hash = $2 WHERE id = $1`, [principals.adminId, superHash]);

  const databaseName = new URL(connectionString).pathname.replace(/^\//, '');
  process.env.NODE_ENV = 'production';
  const built = await buildAdminJs(connectionString, databaseName, database.pool);
  sqlAdapterPool = built.sqlAdapterPool;
  await built.admin.initialize();

  const app = express();
  app.disable('x-powered-by');
  app.set('trust proxy', 1);
  app.use('/admin/assets', express.static(path.join(currentDirectory, '../src/adminjs/public')));
  app.use(
    helmet({
      contentSecurityPolicy: {
        directives: {
          defaultSrc: ["'self'"],
          scriptSrc: ["'self'", "'unsafe-inline'", 'https://unpkg.com'],
          styleSrc: ["'self'", "'unsafe-inline'", 'https://fonts.googleapis.com', 'https://unpkg.com'],
          fontSrc: ["'self'", 'https://fonts.gstatic.com', 'data:'],
          imgSrc: ["'self'", 'data:', 'https:'],
          connectSrc: ["'self'"],
        },
      },
    }),
  );
  app.use('/admin', requireSameOrigin);
  app.use('/admin', buildCsrfProtection('a test CSRF signing secret at least 32 chars'));
  const PgSession = connectPgSimple(session);
  app.use(
    '/admin/login',
    rateLimit({
      windowMs: 15 * 60 * 1000,
      limit: 100,
      standardHeaders: true,
      legacyHeaders: false,
    }),
  );
  app.use(
    '/admin',
    AdminJSExpress.buildAuthenticatedRouter(
      built.admin,
      {
        authenticate: buildAuthenticate(database.pool),
        cookiePassword: 'a test cookie password at least 32 chars',
        cookieName: 'pupzy_admin_test',
      },
      null,
      {
        store: new PgSession({
          pool: database.pool,
          createTableIfMissing: false,
          pruneSessionInterval: false,
          tableName: 'admin_sessions',
        }),
        resave: false,
        saveUninitialized: false,
        secret: 'a test session secret at least 32 chars',
        cookie: { httpOnly: true, sameSite: 'lax' },
      },
    ),
  );

  server = app.listen(0);
  await new Promise((resolve) => server.once('listening', resolve));
  baseUrl = `http://127.0.0.1:${server.address().port}`;

  // Warm up AdminJS bundling so the first test page navigation doesn't lag
  try {
    const res = await fetch(`${baseUrl}/admin/login`);
    await res.text();
  } catch {}

  browser = await puppeteer.launch({
    executablePath: findChromePath(),
    headless: true,
    args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage', '--disable-gpu'],
  });
});

beforeEach(async () => {
  await database.clean();
  await database.pool.query('DELETE FROM cities CASCADE');
  await database.pool.query(
    `INSERT INTO city_catalog_revisions (id, revision) VALUES (1, 1)
     ON CONFLICT (id) DO UPDATE SET revision = 1`,
  );

  const superHash = await bcrypt.hash('super secure password', 4);
  const adminRes = await database.pool.query(
    `INSERT INTO admin_users (email, password_hash, full_name, role, is_active)
     VALUES ('admin@example.com', $1, 'Test Admin', 'SUPER_ADMIN', true)
     RETURNING id`,
    [superHash],
  );
  principals = { adminId: adminRes.rows[0].id };

  const cairoRes = await database.pool.query(
    `INSERT INTO cities (source_code, name_english, name_arabic, governorate, status, center_point)
     VALUES ('EGY-CAI-1', 'Cairo', 'القاهرة', 'Cairo', 'OFFICIAL', ST_SetSRID(ST_MakePoint(31.2357, 30.0444), 4326))
     RETURNING id`,
  );
  cairoId = cairoRes.rows[0].id;

  const gizaRes = await database.pool.query(
    `INSERT INTO cities (source_code, name_english, name_arabic, governorate, status, center_point)
     VALUES ('EGY-GIZ-1', 'Giza', 'الجيزة', 'Giza', 'OFFICIAL', ST_SetSRID(ST_MakePoint(31.2000, 30.0100), 4326))
     RETURNING id`,
  );
  gizaId = gizaRes.rows[0].id;
});

after(async () => {
  if (browser) await browser.close();
  if (server) await new Promise((resolve) => server.close(resolve));
  await sqlAdapterPool?.destroy();
  await database.stop();
});

describe('Mapped Location Real Browser End-to-End Suite', { timeout: 90000 }, () => {
  it('authenticates through real login flow and loads Vet Clinic form under production CSP without errors', async () => {
    const { page, errors } = await createTestPage(browser);
    try {
      await loginAsAdmin(page, baseUrl);

      // Verify authenticated session cookie exists
      const cookies = await page.cookies();
      const sessionCookie = cookies.find((c) => c.name === 'pupzy_admin_test');
      assert.ok(sessionCookie, 'Session cookie pupzy_admin_test must be present after login');

      // Navigate to Vet Clinic New
      await page.goto(`${baseUrl}/admin/resources/vet_clinics/actions/new`, { waitUntil: 'networkidle0' });
      await page.waitForSelector('#mapped-location-picker-map.leaflet-container', { timeout: 10000 });

      // Verify Leaflet is loaded
      const leafletLoaded = await page.evaluate(() => typeof window.L !== 'undefined');
      assert.equal(leafletLoaded, true, 'Leaflet global window.L must be defined');

      // Check external CSP violations (e.g. blocked scripts, styles, tiles, fonts)
      const assetViolations = await page.evaluate(() => {
        return (window.__cspViolations || []).filter(
          (e) => e.blockedURI && e.blockedURI !== 'eval' && !e.blockedURI.startsWith('chrome-extension'),
        );
      });
      assert.deepEqual(assetViolations, [], 'Must have zero CSP violations for external map assets and styles');
      assert.deepEqual(errors, [], 'Must have zero browser console or page errors');
    } finally {
      await page.close();
    }
  });

  it('selecting an official City visibly recenters map without placing a clinic point or confirming location', async () => {
    const { page, errors } = await createTestPage(browser);
    try {
      await loginAsAdmin(page, baseUrl);
      await page.goto(`${baseUrl}/admin/resources/vet_clinics/actions/new`, { waitUntil: 'networkidle0' });
      await page.waitForSelector('#mapped-location-picker-map.leaflet-container');

      // Select official City: Cairo
      await selectCityDropdown(page, 'Cairo');

      // Verify status and input values
      const state = await page.evaluate(() => {
        const latVal = document.getElementById('mapped-lat')?.value;
        const lngVal = document.getElementById('mapped-lng')?.value;
        const confirmed = document.getElementById('location-confirmed')?.checked;
        const markerCount = document.querySelectorAll('.leaflet-marker-icon').length;
        const pageText = document.body.innerText;
        const hasCenteredNotice = pageText.includes('Map viewport centered on Cairo');
        const hasNoPinBadge = pageText.includes('NO PIN');

        return { latVal, lngVal, confirmed, markerCount, hasCenteredNotice, hasNoPinBadge };
      });

      assert.equal(state.latVal, '', 'Latitude must remain empty on City selection');
      assert.equal(state.lngVal, '', 'Longitude must remain empty on City selection');
      assert.equal(state.confirmed, false, 'Location confirmation must NOT be auto-checked on City selection');
      assert.equal(state.markerCount, 0, 'No Leaflet marker must be placed on City selection alone');
      assert.equal(state.hasCenteredNotice, true, 'Status banner must show map centered on Cairo');
      assert.equal(state.hasNoPinBadge, true, 'Badge must show NO PIN status');

      const assetViolations = await page.evaluate(() => {
        return (window.__cspViolations || []).filter(
          (e) => e.blockedURI && e.blockedURI !== 'eval' && !e.blockedURI.startsWith('chrome-extension'),
        );
      });
      assert.deepEqual(assetViolations, []);
      assert.deepEqual(errors, []);
    } finally {
      await page.close();
    }
  });

  it('map click and marker drag update visible WGS84 point, and confirmation is required again after changes', async () => {
    const { page, errors } = await createTestPage(browser);
    try {
      await loginAsAdmin(page, baseUrl);
      await page.goto(`${baseUrl}/admin/resources/vet_clinics/actions/new`, { waitUntil: 'networkidle0' });
      await page.waitForSelector('#mapped-location-picker-map.leaflet-container');

      // Select Cairo
      await selectCityDropdown(page, 'Cairo');

      // 1. Scroll map into view and click on the Leaflet map container to place marker
      await page.evaluate(() =>
        document.getElementById('mapped-location-picker-map')?.scrollIntoView({ block: 'center' }),
      );
      await new Promise((r) => setTimeout(r, 200));
      await page.click('#mapped-location-picker-map');
      await page.waitForSelector('.leaflet-marker-icon', { visible: true });

      const afterClickState = await page.evaluate(() => {
        const latVal = parseFloat(document.getElementById('mapped-lat')?.value || '');
        const lngVal = parseFloat(document.getElementById('mapped-lng')?.value || '');
        const confirmed = document.getElementById('location-confirmed')?.checked;
        const markerCount = document.querySelectorAll('.leaflet-marker-icon').length;
        const pageText = document.body.innerText;
        return {
          latVal,
          lngVal,
          confirmed,
          markerCount,
          isUnconfirmed: pageText.includes('UNCONFIRMED'),
        };
      });

      assert.equal(afterClickState.markerCount, 1, 'Clicking map must place a marker');
      assert.ok(
        Number.isFinite(afterClickState.latVal) && afterClickState.latVal > 20 && afterClickState.latVal < 33,
        'Latitude must be a valid Egyptian coordinate',
      );
      assert.ok(
        Number.isFinite(afterClickState.lngVal) && afterClickState.lngVal > 24 && afterClickState.lngVal < 37,
        'Longitude must be a valid Egyptian coordinate',
      );
      assert.equal(afterClickState.confirmed, false, 'Location must be UNCONFIRMED after click');
      assert.equal(afterClickState.isUnconfirmed, true, 'Badge must show UNCONFIRMED');

      const initialLat = afterClickState.latVal;
      const initialLng = afterClickState.lngVal;

      // 2. Drag the marker
      const markerHandle = await page.$('.leaflet-marker-icon');
      assert.ok(markerHandle, 'Marker element must exist');
      const markerBox = await markerHandle.boundingBox();
      assert.ok(markerBox, 'Marker must have a valid bounding box');
      await page.mouse.move(markerBox.x + markerBox.width / 2, markerBox.y + markerBox.height / 2);
      await page.mouse.down();
      await page.mouse.move(markerBox.x + markerBox.width / 2 + 50, markerBox.y + markerBox.height / 2 + 50, {
        steps: 10,
      });
      await page.mouse.up();
      await new Promise((r) => setTimeout(r, 400));

      const afterDragState = await page.evaluate(() => {
        const latVal = parseFloat(document.getElementById('mapped-lat')?.value || '');
        const lngVal = parseFloat(document.getElementById('mapped-lng')?.value || '');
        const confirmed = document.getElementById('location-confirmed')?.checked;
        return { latVal, lngVal, confirmed };
      });

      assert.notEqual(afterDragState.latVal, initialLat, 'Dragging marker must update latitude');
      assert.notEqual(afterDragState.lngVal, initialLng, 'Dragging marker must update longitude');
      assert.equal(afterDragState.confirmed, false, 'Location must remain UNCONFIRMED after drag');

      // 3. Confirm location
      await page.click('label[for="location-confirmed"]');
      await new Promise((r) => setTimeout(r, 300));
      let isConfirmed = await page.evaluate(() => document.getElementById('location-confirmed')?.checked);
      assert.equal(isConfirmed, true, 'Location must be CONFIRMED after checking confirmation box');

      // 4a. Change English Address -> resets confirmation
      await clearAndType(page, '#address-english', '123 Test Street');
      isConfirmed = await page.evaluate(() => document.getElementById('location-confirmed')?.checked);
      assert.equal(isConfirmed, false, 'Editing English address must uncheck location confirmation');

      // Re-confirm
      await page.click('label[for="location-confirmed"]');
      await new Promise((r) => setTimeout(r, 200));
      isConfirmed = await page.evaluate(() => document.getElementById('location-confirmed')?.checked);
      assert.equal(isConfirmed, true);

      // 4b. Change Arabic Address -> resets confirmation
      await clearAndType(page, '#address-arabic', '١٢٣ شارع تجريبي');
      isConfirmed = await page.evaluate(() => document.getElementById('location-confirmed')?.checked);
      assert.equal(isConfirmed, false, 'Editing Arabic address must uncheck location confirmation');

      // Re-confirm
      await page.click('label[for="location-confirmed"]');
      await new Promise((r) => setTimeout(r, 200));
      isConfirmed = await page.evaluate(() => document.getElementById('location-confirmed')?.checked);
      assert.equal(isConfirmed, true);

      // 4c. Change Latitude manually -> resets confirmation
      await clearAndType(page, '#mapped-lat', '30.0555');
      isConfirmed = await page.evaluate(() => document.getElementById('location-confirmed')?.checked);
      assert.equal(isConfirmed, false, 'Modifying latitude manually must uncheck location confirmation');

      // Re-confirm
      await page.click('label[for="location-confirmed"]');
      await new Promise((r) => setTimeout(r, 200));
      isConfirmed = await page.evaluate(() => document.getElementById('location-confirmed')?.checked);
      assert.equal(isConfirmed, true);

      // 4d. Change City in dropdown -> resets confirmation
      await selectCityDropdown(page, 'Giza');
      isConfirmed = await page.evaluate(() => document.getElementById('location-confirmed')?.checked);
      assert.equal(isConfirmed, false, 'Changing City dropdown must uncheck location confirmation');

      const assetViolations = await page.evaluate(() => {
        return (window.__cspViolations || []).filter(
          (e) => e.blockedURI && e.blockedURI !== 'eval' && !e.blockedURI.startsWith('chrome-extension'),
        );
      });
      assert.deepEqual(assetViolations, []);
      assert.deepEqual(errors, []);
    } finally {
      await page.close();
    }
  });

  it('non-location edit on an Imported Vet Clinic succeeds without replacing or reconfirming its existing location', async () => {
    // Seed an imported clinic with source OSM and location_provenance OSM
    const importedRes = await database.pool.query(
      `INSERT INTO vet_clinics (name_english, name_arabic, city_id, coordinates, source, location_provenance, address_english, address_arabic, address, phone_number, is_active)
       VALUES ('Imported Giza Clinic', 'عيادة الجيزة المستوردة', $1, ST_SetSRID(ST_MakePoint(31.2000, 30.0100), 4326), 'OSM', 'OSM', '120 Pyramids Rd', NULL, '120 Pyramids Rd', '+201000000000', true)
       RETURNING id`,
      [gizaId],
    );
    const importedId = importedRes.rows[0].id;

    const { page, errors } = await createTestPage(browser);
    try {
      await loginAsAdmin(page, baseUrl);

      // Navigate to Edit page of imported clinic
      await page.goto(`${baseUrl}/admin/resources/vet_clinics/records/${importedId}/edit`, {
        waitUntil: 'networkidle0',
      });
      await page.waitForSelector('#mapped-location-picker-map.leaflet-container');

      // Verify existing values rendered
      const initValues = await page.evaluate(() => {
        const nameVal = document.getElementById('name_english')?.value;
        const phoneVal = document.getElementById('phone_number')?.value;
        const latVal = document.getElementById('mapped-lat')?.value;
        const lngVal = document.getElementById('mapped-lng')?.value;
        const confirmed = document.getElementById('location-confirmed')?.checked;
        return { nameVal, phoneVal, latVal, lngVal, confirmed };
      });

      assert.equal(initValues.nameVal, 'Imported Giza Clinic');
      assert.equal(initValues.latVal, '30.01');
      assert.equal(initValues.lngVal, '31.2');
      assert.equal(initValues.confirmed, false, 'Imported clinic starts with confirmation unchecked');

      // Edit only non-location fields: name and phone_number
      await clearAndType(page, '#name_english', 'Imported Giza Clinic Renamed');
      await clearAndType(page, '#phone_number', '+201199887766');

      // Submit form by clicking Save button
      await page.click('button[data-testid="button-save"]');
      await page.waitForFunction(
        () =>
          document.body.innerText.includes('Successfully updated record') || !window.location.href.includes('/edit'),
        { timeout: 15000 },
      );

      // Verify in PostgreSQL database
      const dbCheck = await database.pool.query(`SELECT * FROM vet_clinics WHERE id = $1`, [importedId]);
      assert.equal(dbCheck.rowCount, 1);
      const row = dbCheck.rows[0];
      assert.equal(row.name_english, 'Imported Giza Clinic Renamed');
      assert.equal(row.phone_number, '+201199887766');
      assert.equal(row.source, 'OSM', 'Source must remain OSM');
      assert.equal(row.location_provenance, 'OSM', 'Location provenance must remain OSM');
      assert.equal(row.city_id, gizaId);

      // Verify no audit row created for non-location edit
      const auditCheck = await database.pool.query(
        `SELECT * FROM vet_clinic_location_audits WHERE vet_clinic_id = $1`,
        [importedId],
      );
      assert.equal(auditCheck.rowCount, 0, 'No audit record should be created on non-location edit');

      const assetViolations = await page.evaluate(() => {
        return (window.__cspViolations || []).filter(
          (e) => e.blockedURI && e.blockedURI !== 'eval' && !e.blockedURI.startsWith('chrome-extension'),
        );
      });
      assert.deepEqual(assetViolations, []);
      assert.deepEqual(errors, []);
    } finally {
      await page.close();
    }
  });

  it('completes City-disagreement override through rendered form with DB assertions proving clinic and audit commit together', async () => {
    const { page, errors } = await createTestPage(browser);
    try {
      await loginAsAdmin(page, baseUrl);

      // Navigate to New Vet Clinic
      await page.goto(`${baseUrl}/admin/resources/vet_clinics/actions/new`, { waitUntil: 'networkidle0' });
      await page.waitForSelector('#mapped-location-picker-map.leaflet-container');

      // 1. Fill Name
      await clearAndType(page, '#name_english', 'Boundary Care Clinic');
      await clearAndType(page, '#name_arabic', 'عيادة رعاية الحدود');

      // 2. Select City: Cairo
      await selectCityDropdown(page, 'Cairo');

      // 3. Place point near Giza (latitude 30.0105, longitude 31.2005) where nearest official city is Giza
      await clearAndType(page, '#mapped-lat', '30.0105');
      await clearAndType(page, '#mapped-lng', '31.2005');

      // 4. Fill Bilingual Addresses
      await clearAndType(page, '#address-english', '15 Nile Border Promenade, Cairo');
      await clearAndType(page, '#address-arabic', '١٥ كورنيش حدود النيل، القاهرة');

      // 5. Fill Override Reason
      const overrideReason = 'Clinic serves Cairo residents on the municipal border adjacent to Giza.';
      await clearAndType(page, '#override-reason', overrideReason);

      // 6. Confirm Location
      await page.click('label[for="location-confirmed"]');
      await new Promise((r) => setTimeout(r, 300));

      const isConfirmed = await page.evaluate(() => document.getElementById('location-confirmed')?.checked);
      assert.equal(isConfirmed, true, 'Location must be confirmed before save');

      // 7. Submit form via Save button
      await page.click('button[data-testid="button-save"]');
      await page.waitForFunction(
        () =>
          document.body.innerText.includes('Successfully created record') ||
          !window.location.href.includes('/actions/new'),
        { timeout: 15000 },
      );

      // 8. Verify database assertions for both vet_clinics and vet_clinic_location_audits
      const clinicRes = await database.pool.query(
        `SELECT * FROM vet_clinics WHERE name_english = 'Boundary Care Clinic'`,
      );
      assert.equal(clinicRes.rowCount, 1, 'Clinic record must be created in PostgreSQL');
      const clinic = clinicRes.rows[0];
      assert.equal(clinic.city_id, cairoId, 'Clinic city_id must be Cairo');
      assert.equal(clinic.address_english, '15 Nile Border Promenade, Cairo');
      assert.equal(clinic.address_arabic, '١٥ كورنيش حدود النيل، القاهرة');
      assert.equal(clinic.source, 'MANUAL');
      assert.equal(clinic.location_provenance, 'MANUAL');

      const auditRes = await database.pool.query(`SELECT * FROM vet_clinic_location_audits WHERE vet_clinic_id = $1`, [
        clinic.id,
      ]);
      assert.equal(auditRes.rowCount, 1, 'Append-only audit record must be committed');
      const audit = auditRes.rows[0];
      assert.equal(audit.admin_user_id, principals.adminId);
      assert.equal(audit.reason, overrideReason);
      assert.equal(audit.selected_city_id, cairoId);
      assert.equal(audit.nearest_city_id, gizaId);
      assert.match(
        audit.id,
        /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i,
        'Audit ID must be a valid UUIDv7',
      );

      const assetViolations = await page.evaluate(() => {
        return (window.__cspViolations || []).filter(
          (e) => e.blockedURI && e.blockedURI !== 'eval' && !e.blockedURI.startsWith('chrome-extension'),
        );
      });
      assert.deepEqual(assetViolations, []);
      assert.deepEqual(errors, []);
    } finally {
      await page.close();
    }
  });

  it('real-browser journey: address search explicitly disabled leaves deliberate manual placement and save fully available', async () => {
    const { page, errors } = await createTestPage(browser);
    try {
      await loginAsAdmin(page, baseUrl);

      await page.setRequestInterception(true);
      page.on('request', (req) => {
        if (req.url().includes('searchAddress')) {
          req.respond({
            status: 200,
            contentType: 'application/json',
            body: JSON.stringify({
              results: [],
              source: 'DISABLED',
              disabled: true,
              message: 'Address search is currently disabled. Please pin the location manually on the map.',
            }),
          });
        } else {
          req.continue();
        }
      });

      // Navigate to New Vet Clinic
      await page.goto(`${baseUrl}/admin/resources/vet_clinics/actions/new`, { waitUntil: 'networkidle0' });
      await page.waitForSelector('#mapped-location-picker-map.leaflet-container');

      // 1. Fill Name
      await clearAndType(page, '#name_english', 'Disabled Search Manual Clinic');
      await clearAndType(page, '#name_arabic', 'عيادة البحث المعطل اليدوية');

      // 2. Attempt address search
      await clearAndType(page, '#vet-clinic-search-input', '10 Kasr El Aini, Cairo');
      const searchButton = await page.evaluateHandle(() => {
        const buttons = Array.from(document.querySelectorAll('button'));
        return buttons.find((b) => b.innerText.includes('Search address'));
      });
      assert.ok(searchButton, 'Search address button must exist');
      await searchButton.click();

      // 3. Verify disabled search notice is visibly and accessibly displayed
      await page.waitForSelector('#vet-clinic-search-error');
      const disabledNotice = await page.evaluate(() => {
        const errorEl = document.getElementById('vet-clinic-search-error');
        return {
          text: errorEl?.innerText || '',
          role: errorEl?.getAttribute('role'),
          ariaLive: errorEl?.getAttribute('aria-live'),
        };
      });
      assert.match(disabledNotice.text, /Address search is currently disabled/i);
      assert.equal(disabledNotice.role, 'alert');
      assert.equal(disabledNotice.ariaLive, 'assertive');

      // 4. Deliberate manual workflow: Select City Cairo
      await selectCityDropdown(page, 'Cairo');

      // 5. Deliberate point placement: Coordinates in Cairo (30.0444, 31.2357)
      await clearAndType(page, '#mapped-lat', '30.0444');
      await clearAndType(page, '#mapped-lng', '31.2357');

      // 6. Bilingual address entry
      await clearAndType(page, '#address-english', '10 Kasr El Aini St, Cairo');
      await clearAndType(page, '#address-arabic', '١٠ شارع قصر العيني، القاهرة');

      // 7. Explicit confirmation
      await page.click('label[for="location-confirmed"]');
      await new Promise((r) => setTimeout(r, 300));
      const isConfirmed = await page.evaluate(() => document.getElementById('location-confirmed')?.checked);
      assert.equal(isConfirmed, true, 'Location must be confirmed');

      // 8. Save
      await page.click('button[data-testid="button-save"]');
      await page.waitForFunction(
        () =>
          document.body.innerText.includes('Successfully created record') ||
          !window.location.href.includes('/actions/new'),
        { timeout: 20000 },
      );

      // 9. Database assertions proving intended Vet Clinic state and provenance MANUAL
      const clinicRes = await database.pool.query(
        `SELECT * FROM vet_clinics WHERE name_english = 'Disabled Search Manual Clinic'`,
      );
      assert.equal(clinicRes.rowCount, 1, 'Clinic record must be saved in database');
      const clinic = clinicRes.rows[0];
      assert.equal(clinic.city_id, cairoId);
      assert.equal(clinic.address_english, '10 Kasr El Aini St, Cairo');
      assert.equal(clinic.address_arabic, '١٠ شارع قصر العيني، القاهرة');
      assert.equal(clinic.location_provenance, 'MANUAL');

      // Zero unintended audit rows
      const auditRes = await database.pool.query(`SELECT * FROM vet_clinic_location_audits WHERE vet_clinic_id = $1`, [
        clinic.id,
      ]);
      assert.equal(auditRes.rowCount, 0, 'No audit row created when city agrees');

      const assetViolations = await page.evaluate(() => {
        return (window.__cspViolations || []).filter(
          (e) => e.blockedURI && e.blockedURI !== 'eval' && !e.blockedURI.startsWith('chrome-extension'),
        );
      });
      assert.deepEqual(assetViolations, []);
      assert.deepEqual(errors, []);
    } finally {
      await page.close();
    }
  });

  it('real-browser journey: address search timeout or upstream outage degrades gracefully and leaves manual workflow fully available', async () => {
    const { page, errors } = await createTestPage(browser);
    try {
      await loginAsAdmin(page, baseUrl);

      await page.setRequestInterception(true);
      page.on('request', (req) => {
        if (req.url().includes('searchAddress')) {
          req.respond({
            status: 200,
            contentType: 'application/json',
            body: JSON.stringify({
              results: [],
              source: 'ERROR',
              error: 'Nominatim request timed out after 5000ms',
              message:
                'Address search is currently unavailable. You can click on the map to pin the clinic location manually.',
            }),
          });
        } else {
          req.continue();
        }
      });

      // Navigate to New Vet Clinic
      await page.goto(`${baseUrl}/admin/resources/vet_clinics/actions/new`, { waitUntil: 'networkidle0' });
      await page.waitForSelector('#mapped-location-picker-map.leaflet-container');

      // 1. Fill Name
      await clearAndType(page, '#name_english', 'Timeout Fallback Manual Clinic');
      await clearAndType(page, '#name_arabic', 'عيادة السقوط الاحتياطي اليدوية');

      // 2. Attempt address search that times out upstream
      await clearAndType(page, '#vet-clinic-search-input', '50 Pyramids St, Giza');
      const searchButton = await page.evaluateHandle(() => {
        const buttons = Array.from(document.querySelectorAll('button'));
        return buttons.find((b) => b.innerText.includes('Search address'));
      });
      assert.ok(searchButton, 'Search address button must exist');
      await searchButton.click();

      // 3. Verify outage notice is visibly and accessibly displayed
      await page.waitForSelector('#vet-clinic-search-error');
      const outageNotice = await page.evaluate(() => {
        const errorEl = document.getElementById('vet-clinic-search-error');
        const inputEl = document.getElementById('vet-clinic-search-input');
        return {
          text: errorEl?.innerText || '',
          role: errorEl?.getAttribute('role'),
          ariaLive: errorEl?.getAttribute('aria-live'),
          inputInvalid: inputEl?.getAttribute('aria-invalid'),
          inputDescribedBy: inputEl?.getAttribute('aria-describedby'),
        };
      });
      assert.match(outageNotice.text, /Address search is currently unavailable/i);
      assert.equal(outageNotice.role, 'alert');
      assert.equal(outageNotice.ariaLive, 'assertive');
      assert.equal(outageNotice.inputInvalid, 'true');
      assert.equal(outageNotice.inputDescribedBy, 'vet-clinic-search-error');

      // 4. Deliberate manual workflow: Select City Giza
      await selectCityDropdown(page, 'Giza');

      // 5. Deliberate point placement: Coordinates in Giza (30.0100, 31.2000)
      await clearAndType(page, '#mapped-lat', '30.0100');
      await clearAndType(page, '#mapped-lng', '31.2000');

      // 6. Bilingual address entry
      await clearAndType(page, '#address-english', '50 Pyramids St, Giza');
      await clearAndType(page, '#address-arabic', '٥٠ شارع الأهرام، الجيزة');

      // 7. Explicit confirmation
      await page.click('label[for="location-confirmed"]');
      await new Promise((r) => setTimeout(r, 300));
      const isConfirmed = await page.evaluate(() => document.getElementById('location-confirmed')?.checked);
      assert.equal(isConfirmed, true, 'Location must be confirmed');

      // 8. Save
      await page.click('button[data-testid="button-save"]');
      await page.waitForFunction(
        () =>
          document.body.innerText.includes('Successfully created record') ||
          !window.location.href.includes('/actions/new'),
        { timeout: 20000 },
      );

      // 9. Database assertions proving intended Vet Clinic state and provenance MANUAL
      const clinicRes = await database.pool.query(
        `SELECT * FROM vet_clinics WHERE name_english = 'Timeout Fallback Manual Clinic'`,
      );
      assert.equal(clinicRes.rowCount, 1, 'Clinic record must be saved in database');
      const clinic = clinicRes.rows[0];
      assert.equal(clinic.city_id, gizaId);
      assert.equal(clinic.address_english, '50 Pyramids St, Giza');
      assert.equal(clinic.address_arabic, '٥٠ شارع الأهرام، الجيزة');
      assert.equal(clinic.location_provenance, 'MANUAL');

      // Zero unintended audit rows
      const auditRes = await database.pool.query(`SELECT * FROM vet_clinic_location_audits WHERE vet_clinic_id = $1`, [
        clinic.id,
      ]);
      assert.equal(auditRes.rowCount, 0, 'No audit row created when city agrees');

      const assetViolations = await page.evaluate(() => {
        return (window.__cspViolations || []).filter(
          (e) => e.blockedURI && e.blockedURI !== 'eval' && !e.blockedURI.startsWith('chrome-extension'),
        );
      });
      assert.deepEqual(assetViolations, []);
      assert.deepEqual(errors, []);
    } finally {
      await page.close();
    }
  });

  it('failed and unconfirmed submissions expose visible, programmatically associated validation feedback and move focus accessibly', async () => {
    const { page, errors } = await createTestPage(browser);
    try {
      await loginAsAdmin(page, baseUrl);

      await page.goto(`${baseUrl}/admin/resources/vet_clinics/actions/new`, { waitUntil: 'networkidle0' });
      await page.waitForSelector('#mapped-location-picker-map.leaflet-container');

      // SUBCASE A: Unconfirmed location submission
      await clearAndType(page, '#name_english', 'Unconfirmed Validation Clinic');
      await clearAndType(page, '#name_arabic', 'عيادة التحقق غير المؤكدة');
      await selectCityDropdown(page, 'Cairo');
      await clearAndType(page, '#mapped-lat', '30.0444');
      await clearAndType(page, '#mapped-lng', '31.2357');
      await clearAndType(page, '#address-english', '10 Kasr El Aini St, Cairo');
      await clearAndType(page, '#address-arabic', '١٠ شارع قصر العيني، القاهرة');

      // Ensure location-confirmed is UNCHECKED
      const confirmedBefore = await page.evaluate(() => document.getElementById('location-confirmed')?.checked);
      assert.equal(confirmedBefore, false);

      // Attempt Save
      await page.click('button[data-testid="button-save"]');
      await page.waitForSelector('#mapped-location-coordinates-error');

      // Verify accessible error alert, programmatic association, and focus
      const errorA = await page.evaluate(() => {
        const errorEl = document.getElementById('mapped-location-coordinates-error');
        const confirmBox = document.getElementById('location-confirmed');
        const activeId = document.activeElement?.id;
        return {
          errorText: errorEl?.innerText || '',
          errorRole: errorEl?.getAttribute('role'),
          errorAriaLive: errorEl?.getAttribute('aria-live'),
          confirmAriaInvalid: confirmBox?.getAttribute('aria-invalid'),
          confirmAriaDescribedBy: confirmBox?.getAttribute('aria-describedby'),
          activeId,
        };
      });

      assert.match(errorA.errorText, /Location must be explicitly confirmed/i);
      assert.equal(errorA.errorRole, 'alert');
      assert.equal(errorA.errorAriaLive, 'assertive');
      assert.equal(errorA.confirmAriaInvalid, 'true');
      assert.equal(errorA.confirmAriaDescribedBy, 'mapped-location-coordinates-error');
      assert.equal(errorA.activeId, 'location-confirmed', 'Focus must move to location-confirmed on unconfirmed error');

      // Verify zero records in DB
      const dbCheckA = await database.pool.query(
        `SELECT * FROM vet_clinics WHERE name_english = 'Unconfirmed Validation Clinic'`,
      );
      assert.equal(dbCheckA.rowCount, 0, 'No record must be saved without confirmation');

      // SUBCASE B: Missing required English address
      await clearAndType(page, '#address-english', '');
      await page.click('label[for="location-confirmed"]');
      await new Promise((r) => setTimeout(r, 200));
      await page.click('button[data-testid="button-save"]');
      await page.waitForSelector('#address-english-error');

      const errorB = await page.evaluate(() => {
        const errorEl = document.getElementById('address-english-error');
        const inputEl = document.getElementById('address-english');
        const activeId = document.activeElement?.id;
        return {
          errorText: errorEl?.innerText || '',
          errorRole: errorEl?.getAttribute('role'),
          errorAriaLive: errorEl?.getAttribute('aria-live'),
          inputAriaInvalid: inputEl?.getAttribute('aria-invalid'),
          inputAriaDescribedBy: inputEl?.getAttribute('aria-describedby'),
          activeId,
        };
      });

      assert.match(errorB.errorText, /English address is required/i);
      assert.equal(errorB.errorRole, 'alert');
      assert.equal(errorB.errorAriaLive, 'assertive');
      assert.equal(errorB.inputAriaInvalid, 'true');
      assert.equal(errorB.inputAriaDescribedBy, 'address-english-error');
      assert.equal(errorB.activeId, 'address-english', 'Focus must move to address-english when missing');

      // SUBCASE C: Discrepancy without override reason
      await clearAndType(page, '#address-english', '15 Nile Border Promenade, Cairo');
      // Place near Giza (discrepancy)
      await clearAndType(page, '#mapped-lat', '30.0105');
      await clearAndType(page, '#mapped-lng', '31.2005');
      await clearAndType(page, '#override-reason', '');
      await page.click('label[for="location-confirmed"]'); // reconfirm
      await page.click('button[data-testid="button-save"]');
      await page.waitForSelector('#override-reason-error');

      const errorC = await page.evaluate(() => {
        const errorEl = document.getElementById('override-reason-error');
        const inputEl = document.getElementById('override-reason');
        const activeId = document.activeElement?.id;
        return {
          errorText: errorEl?.innerText || '',
          errorRole: errorEl?.getAttribute('role'),
          errorAriaLive: errorEl?.getAttribute('aria-live'),
          inputAriaInvalid: inputEl?.getAttribute('aria-invalid'),
          inputAriaDescribedBy: inputEl?.getAttribute('aria-describedby'),
          activeId,
        };
      });

      assert.match(errorC.errorText, /override reason/i);
      assert.equal(errorC.errorRole, 'alert');
      assert.equal(errorC.errorAriaLive, 'assertive');
      assert.equal(errorC.inputAriaInvalid, 'true');
      assert.equal(errorC.inputAriaDescribedBy, 'override-reason-error');
      assert.equal(errorC.activeId, 'override-reason', 'Focus must move to override-reason when missing');

      // Verify zero records in DB
      const dbCheckC = await database.pool.query(
        `SELECT * FROM vet_clinics WHERE name_english = 'Unconfirmed Validation Clinic'`,
      );
      assert.equal(dbCheckC.rowCount, 0);

      const assetViolations = await page.evaluate(() => {
        return (window.__cspViolations || []).filter(
          (e) => e.blockedURI && e.blockedURI !== 'eval' && !e.blockedURI.startsWith('chrome-extension'),
        );
      });
      assert.deepEqual(assetViolations, []);
      assert.deepEqual(errors, []);
    } finally {
      await page.close();
    }
  });

  it('keyboard-only operability: complete Mapped Location journey using keyboard navigation and verifies accessible labels', async () => {
    const { page, errors } = await createTestPage(browser);
    try {
      await loginAsAdmin(page, baseUrl);

      await page.goto(`${baseUrl}/admin/resources/vet_clinics/actions/new`, { waitUntil: 'networkidle0' });
      await page.waitForSelector('#mapped-location-picker-map.leaflet-container');

      // 1. Verify accessible labelling across all required controls
      const labels = await page.evaluate(() => {
        const searchInput = document.getElementById('vet-clinic-search-input');
        const mapRegion = document.getElementById('mapped-location-picker-map');
        const latInput = document.getElementById('mapped-lat');
        const lngInput = document.getElementById('mapped-lng');
        const addressEn = document.getElementById('address-english');
        const addressAr = document.getElementById('address-arabic');
        const confirmBox = document.getElementById('location-confirmed');
        const overrideInput = document.getElementById('override-reason');

        const getLabelFor = (id) => document.querySelector(`label[for="${id}"]`)?.innerText || '';

        return {
          searchAriaLabel: searchInput?.getAttribute('aria-label') || '',
          mapRole: mapRegion?.getAttribute('role') || '',
          mapAriaLabel: mapRegion?.getAttribute('aria-label') || '',
          mapTabIndex: mapRegion?.getAttribute('tabindex'),
          latLabel: getLabelFor('mapped-lat'),
          lngLabel: getLabelFor('mapped-lng'),
          addressEnLabel: getLabelFor('address-english'),
          addressArLabel: getLabelFor('address-arabic'),
          confirmLabel: getLabelFor('location-confirmed'),
          overrideLabel: getLabelFor('override-reason'),
        };
      });

      assert.match(labels.searchAriaLabel, /Search public clinic address/i);
      assert.equal(labels.mapRole, 'region');
      assert.match(labels.mapAriaLabel, /Interactive map/i);
      assert.equal(labels.mapTabIndex, '0');
      assert.match(labels.latLabel, /Latitude/i);
      assert.match(labels.lngLabel, /Longitude/i);
      assert.match(labels.addressEnLabel, /Address \(English\)/i);
      assert.match(labels.addressArLabel, /Address \(Arabic\)/i);
      assert.match(labels.confirmLabel, /I confirm this mapped location/i);
      assert.match(labels.overrideLabel, /Override Reason/i);

      // 2. Pure keyboard entry for form fields
      await page.focus('#name_english');
      await page.keyboard.type('Keyboard Operable Clinic');

      await page.focus('#name_arabic');
      await page.keyboard.type('عيادة قابلة للتشغيل بلوحة المفاتيح');

      // Select City via keyboard
      await selectCityDropdown(page, 'Cairo');

      // Focus map container with keyboard
      await page.focus('#mapped-location-picker-map');

      // Type Coordinates via keyboard
      await page.focus('#mapped-lat');
      await page.keyboard.type('30.0444');

      await page.focus('#mapped-lng');
      await page.keyboard.type('31.2357');

      // Type Addresses via keyboard
      await page.focus('#address-english');
      await page.keyboard.type('10 Kasr El Aini St, Cairo');

      await page.focus('#address-arabic');
      await page.keyboard.type('١٠ شارع قصر العيني، القاهرة');

      // Focus Confirmation CheckBox and activate with Space key
      await page.focus('#location-confirmed');
      await page.keyboard.press('Space');
      await new Promise((r) => setTimeout(r, 200));

      const isChecked = await page.evaluate(() => document.getElementById('location-confirmed')?.checked);
      assert.equal(isChecked, true, 'Space key must toggle confirmation checkbox');

      // Focus Save button and activate with Enter key
      await page.focus('button[data-testid="button-save"]');
      await page.keyboard.press('Enter');

      await page.waitForFunction(
        () =>
          document.body.innerText.includes('Successfully created record') ||
          !window.location.href.includes('/actions/new'),
        { timeout: 20000 },
      );

      // 3. Database assertion
      const clinicRes = await database.pool.query(
        `SELECT * FROM vet_clinics WHERE name_english = 'Keyboard Operable Clinic'`,
      );
      assert.equal(clinicRes.rowCount, 1, 'Keyboard submitted clinic must be saved in database');
      const clinic = clinicRes.rows[0];
      assert.equal(clinic.city_id, cairoId);
      assert.equal(clinic.address_english, '10 Kasr El Aini St, Cairo');
      assert.equal(clinic.address_arabic, '١٠ شارع قصر العيني، القاهرة');
      assert.equal(clinic.location_provenance, 'MANUAL');

      const assetViolations = await page.evaluate(() => {
        return (window.__cspViolations || []).filter(
          (e) => e.blockedURI && e.blockedURI !== 'eval' && !e.blockedURI.startsWith('chrome-extension'),
        );
      });
      assert.deepEqual(assetViolations, []);
      assert.deepEqual(errors, []);
    } finally {
      await page.close();
    }
  });
});
