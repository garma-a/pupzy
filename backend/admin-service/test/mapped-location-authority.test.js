import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { after, before, beforeEach, describe, it } from 'node:test';
import { ValidationError } from 'adminjs';
import knexFactory from 'knex';

import {
  createVetClinicCommand,
  updateVetClinicCommand,
  createClinicInTransaction,
  updateClinicInTransaction,
  findAdminUserById,
  acquireCityCatalogRevisionFence,
  executeVetClinicTransaction,
  createVetClinicPersistenceAdapter,
  PostgresVetClinicPersistenceAdapter,
  KnexVetClinicPersistenceAdapter,
} from '../src/adminjs/resources/vet-clinics.mutations.js';
import { TestDatabaseHelper, seedPrincipals } from './test-database.helper.js';

const database = new TestDatabaseHelper();
let principals;
let knex;

before(async () => {
  const connectionString = await database.start();
  knex = knexFactory({
    client: 'pg',
    connection: connectionString,
    pool: { min: 1, max: 8 },
  });
});

beforeEach(async () => {
  await database.clean();
  await database.pool.query('DELETE FROM cities CASCADE');
  await database.pool.query(
    `INSERT INTO city_catalog_revisions (id, revision) VALUES (1, 1)
     ON CONFLICT (id) DO UPDATE SET revision = 1`,
  );
  principals = await seedPrincipals(database.pool);
});

after(async () => {
  await knex?.destroy();
  await database.stop();
});

describe('Mapped Location Transactional Authorization and City Catalog Revision Fencing', () => {
  it('discrepancy override queries administrator inside transaction and rejects when admin is deactivated concurrently', async () => {
    // 1. Clear and seed two distinct official cities: Cairo and Giza
    await database.pool.query('DELETE FROM cities CASCADE');
    const cairoRes = await database.pool.query(
      `INSERT INTO cities (name_english, name_arabic, governorate, status, center_point)
       VALUES ('Cairo ${Date.now()}', 'القاهرة', 'Cairo', 'OFFICIAL', ST_SetSRID(ST_MakePoint(31.2357, 30.0444), 4326))
       RETURNING id`,
    );
    const cairoId = cairoRes.rows[0].id;

    const gizaRes = await database.pool.query(
      `INSERT INTO cities (name_english, name_arabic, governorate, status, center_point)
       VALUES ('Giza ${Date.now()}', 'الجيزة', 'Giza', 'OFFICIAL', ST_SetSRID(ST_MakePoint(31.2000, 30.0100), 4326))
       RETURNING id`,
    );
    const gizaId = gizaRes.rows[0].id;

    // 2. Create an active Admin user in DB
    const adminRes = await database.pool.query(
      `INSERT INTO admin_users (email, password_hash, full_name, role, is_active)
       VALUES ('racing-admin@pupzy.app', '$2a$12$placeholder', 'Racing Admin', 'ADMIN', true)
       RETURNING id`,
    );
    const adminId = adminRes.rows[0].id;

    const clientA = await database.pool.connect(); // Deactivates admin
    const clientB = await database.pool.connect(); // Clinic override writer

    try {
      // Step 1: Client A starts transaction and deactivates administrator (holds exclusive row lock on admin_users)
      await clientA.query('BEGIN');
      await clientA.query(`UPDATE admin_users SET is_active = false WHERE id = $1`, [adminId]);

      // Step 2: Client B attempts to create clinic with Cairo selected, location near Giza (discrepancy),
      // and valid override reason. Client B queries admin_users with FOR SHARE inside transaction and blocks.
      let clientBFinished = false;
      let clientBError = null;
      const clinicName = 'Deactivation Race Clinic ' + crypto.randomUUID();

      const clinicPromise = (async () => {
        try {
          await clientB.query('BEGIN');
          await createClinicInTransaction(
            clientB,
            'pg',
            {
              name_english: clinicName,
              city_id: cairoId, // Cairo selected, but coordinates closest to Giza
              latitude: 30.01,
              longitude: 31.2,
              address_english: '10 Nile St',
              address_arabic: '١٠ شارع النيل',
              location_confirmed: true,
              override_reason: 'Operating on Cairo-Giza border line.',
            },
            { id: adminId, role: 'ADMIN', is_active: true }, // Session claims active
          );
          await clientB.query('COMMIT');
        } catch (err) {
          await clientB.query('ROLLBACK').catch(() => {});
          clientBError = err;
        } finally {
          clientBFinished = true;
        }
      })();

      // Give time for Client B to execute and block on admin_users row lock
      await new Promise((r) => setTimeout(r, 80));
      assert.equal(clientBFinished, false, 'Client B must block waiting for Client A lock on admin_users');

      // Step 3: Client A commits admin deactivation
      await clientA.query('COMMIT');

      // Step 4: Client B unblocks, reads is_active = false from DB under lock, and fails closed
      await clinicPromise;

      assert.ok(clientBError, 'Client B must reject with ValidationError');
      assert.ok(clientBError instanceof ValidationError);
      assert.match(clientBError.propertyErrors.override_reason.message, /active administrators/i);

      // Verify no clinic was created
      const clinicCheck = await database.pool.query(`SELECT * FROM vet_clinics WHERE name_english = $1`, [clinicName]);
      assert.equal(clinicCheck.rowCount, 0, 'No clinic record must be committed on deactivated admin race');

      // Verify no audit log was created
      const auditCheck = await database.pool.query(
        `SELECT * FROM vet_clinic_location_audits WHERE admin_user_id = $1`,
        [adminId],
      );
      assert.equal(auditCheck.rowCount, 0, 'No audit record must be committed on deactivated admin race');
    } finally {
      await clientA.query('ROLLBACK').catch(() => {});
      await clientB.query('ROLLBACK').catch(() => {});
      clientA.release();
      clientB.release();
    }
  });

  it('discrepancy override queries administrator inside transaction and rejects when admin account is deleted concurrently', async () => {
    // 1. Clear and seed two official cities: Cairo and Giza
    await database.pool.query('DELETE FROM cities CASCADE');
    const cairoRes = await database.pool.query(
      `INSERT INTO cities (name_english, name_arabic, governorate, status, center_point)
       VALUES ('Cairo Delete Test ${Date.now()}', 'القاهرة', 'Cairo', 'OFFICIAL', ST_SetSRID(ST_MakePoint(31.2357, 30.0444), 4326))
       RETURNING id`,
    );
    const cairoId = cairoRes.rows[0].id;

    const gizaRes = await database.pool.query(
      `INSERT INTO cities (name_english, name_arabic, governorate, status, center_point)
       VALUES ('Giza Delete Test ${Date.now()}', 'الجيزة', 'Giza', 'OFFICIAL', ST_SetSRID(ST_MakePoint(31.2000, 30.0100), 4326))
       RETURNING id`,
    );
    const gizaId = gizaRes.rows[0].id;

    // 2. Create existing clinic in Cairo
    const clinicRes = await database.pool.query(
      `INSERT INTO vet_clinics (name_english, name_arabic, city_id, coordinates, address_english, address_arabic, source, location_provenance, is_active)
       VALUES ('Relocation Clinic ${Date.now()}', 'عيادة النقل', $1, ST_SetSRID(ST_MakePoint(31.2357, 30.0444), 4326), 'Old Address', 'عنوان قديم', 'MANUAL', 'MANUAL', true)
       RETURNING id`,
      [cairoId],
    );
    const clinicId = clinicRes.rows[0].id;

    // 3. Create active Admin
    const adminRes = await database.pool.query(
      `INSERT INTO admin_users (email, password_hash, full_name, role, is_active)
       VALUES ('deleting-admin@pupzy.app', '$2a$12$placeholder', 'Deleting Admin', 'ADMIN', true)
       RETURNING id`,
    );
    const adminId = adminRes.rows[0].id;

    const clientA = await database.pool.connect(); // Deletes admin
    const clientB = await database.pool.connect(); // Clinic relocation writer

    try {
      // Step 1: Client A starts transaction and deletes admin (holds exclusive lock on admin_users row)
      await clientA.query('BEGIN');
      await clientA.query(`DELETE FROM admin_users WHERE id = $1`, [adminId]);

      // Step 2: Client B attempts update with discrepant relocation in parallel
      let clientBFinished = false;
      let clientBError = null;

      const updatePromise = (async () => {
        try {
          await clientB.query('BEGIN');
          await updateClinicInTransaction(
            clientB,
            'pg',
            clinicId,
            {
              city_id: cairoId,
              latitude: 30.01,
              longitude: 31.2,
              address_english: 'New Border Address',
              address_arabic: 'عنوان الحدود الجديد',
              location_confirmed: true,
              override_reason: 'Relocating to boundary.',
            },
            { id: adminId, role: 'ADMIN', is_active: true }, // Session attributes claim active Admin
          );
          await clientB.query('COMMIT');
        } catch (err) {
          await clientB.query('ROLLBACK').catch(() => {});
          clientBError = err;
        } finally {
          clientBFinished = true;
        }
      })();

      await new Promise((r) => setTimeout(r, 80));
      assert.equal(clientBFinished, false, 'Client B must block waiting for Client A lock on admin_users');

      // Step 3: Client A commits deletion
      await clientA.query('COMMIT');

      // Step 4: Client B unblocks, finds no admin in DB, and rejects
      await updatePromise;

      assert.ok(clientBError, 'Client B must reject with ValidationError');
      assert.ok(clientBError instanceof ValidationError);
      assert.match(clientBError.propertyErrors.override_reason.message, /active administrators/i);

      // Verify clinic location was NOT updated
      const clinicCheck = await database.pool.query(`SELECT address_english FROM vet_clinics WHERE id = $1`, [
        clinicId,
      ]);
      assert.equal(clinicCheck.rows[0].address_english, 'Old Address');

      // Verify no audit log exists
      const auditCheck = await database.pool.query(
        `SELECT * FROM vet_clinic_location_audits WHERE vet_clinic_id = $1`,
        [clinicId],
      );
      assert.equal(auditCheck.rowCount, 0);
    } finally {
      await clientA.query('ROLLBACK').catch(() => {});
      await clientB.query('ROLLBACK').catch(() => {});
      clientA.release();
      clientB.release();
    }
  });

  it('active override transaction holds FOR SHARE lock on admin_users, serializing concurrent deactivation until commit', async () => {
    // 1. Clear and seed two official cities
    await database.pool.query('DELETE FROM cities CASCADE');
    const cairoRes = await database.pool.query(
      `INSERT INTO cities (name_english, name_arabic, governorate, status, center_point)
       VALUES ('Cairo Lock Test ${Date.now()}', 'القاهرة', 'Cairo', 'OFFICIAL', ST_SetSRID(ST_MakePoint(31.2357, 30.0444), 4326))
       RETURNING id`,
    );
    const cairoId = cairoRes.rows[0].id;

    const gizaRes = await database.pool.query(
      `INSERT INTO cities (name_english, name_arabic, governorate, status, center_point)
       VALUES ('Giza Lock Test ${Date.now()}', 'الجيزة', 'Giza', 'OFFICIAL', ST_SetSRID(ST_MakePoint(31.2000, 30.0100), 4326))
       RETURNING id`,
    );
    const gizaId = gizaRes.rows[0].id;

    // 2. Active Super Admin
    const adminRes = await database.pool.query(
      `INSERT INTO admin_users (email, password_hash, full_name, role, is_active)
       VALUES ('active-authorizer@pupzy.app', '$2a$12$placeholder', 'Authorizing Admin', 'SUPER_ADMIN', true)
       RETURNING id`,
    );
    const adminId = adminRes.rows[0].id;

    const clientA = await database.pool.connect(); // Clinic writer (holds FOR SHARE on admin)
    const clientB = await database.pool.connect(); // Deactivator (attempts UPDATE)

    try {
      // Step 1: Client A starts transaction and creates clinic with discrepancy override (acquires FOR SHARE on admin_users)
      await clientA.query('BEGIN');
      const clinicName = 'Authoritative Override Clinic ' + crypto.randomUUID();
      const clinic = await createClinicInTransaction(
        clientA,
        'pg',
        {
          name_english: clinicName,
          city_id: cairoId,
          latitude: 30.01,
          longitude: 31.2,
          address_english: '10 Nile St',
          address_arabic: '١٠ شارع النيل',
          location_confirmed: true,
          override_reason: 'Authorized boundary override.',
        },
        { id: adminId, role: 'SUPER_ADMIN', is_active: true },
      );
      assert.ok(clinic);

      // Step 2: Client B attempts to deactivate admin in parallel (will block on Client A's share lock)
      let clientBFinished = false;
      const deactivationPromise = (async () => {
        await clientB.query('BEGIN');
        await clientB.query(`UPDATE admin_users SET is_active = false WHERE id = $1`, [adminId]);
        await clientB.query('COMMIT');
        clientBFinished = true;
      })();

      await new Promise((r) => setTimeout(r, 80));
      assert.equal(clientBFinished, false, 'Client B must block while Client A holds FOR SHARE lock on administrator');

      // Step 3: Client A commits clinic and audit creation
      await clientA.query('COMMIT');

      // Step 4: Client B unblocks and commits deactivation
      await deactivationPromise;
      assert.equal(clientBFinished, true);

      // Verify clinic and audit were committed
      const clinicCheck = await database.pool.query(`SELECT * FROM vet_clinics WHERE id = $1`, [clinic.id]);
      assert.equal(clinicCheck.rowCount, 1);

      const auditCheck = await database.pool.query(
        `SELECT * FROM vet_clinic_location_audits WHERE vet_clinic_id = $1`,
        [clinic.id],
      );
      assert.equal(auditCheck.rowCount, 1);
      assert.equal(auditCheck.rows[0].admin_user_id, adminId);
      assert.equal(auditCheck.rows[0].reason, 'Authorized boundary override.');

      // Verify admin is now deactivated
      const adminCheck = await database.pool.query(`SELECT is_active FROM admin_users WHERE id = $1`, [adminId]);
      assert.equal(adminCheck.rows[0].is_active, false);
    } finally {
      await clientA.query('ROLLBACK').catch(() => {});
      await clientB.query('ROLLBACK').catch(() => {});
      clientA.release();
      clientB.release();
    }
  });

  it('concurrent City release activating a closer City blocks Mapped Location validation and makes discrepancy detection authoritative', async () => {
    // 1. Clear and insert only Cairo (at 30.0444, 31.2357)
    await database.pool.query('DELETE FROM cities CASCADE');
    const cairoRes = await database.pool.query(
      `INSERT INTO cities (source_code, name_english, name_arabic, governorate, status, center_point)
       VALUES ('EGY-CAI-1', 'Cairo Initial ${Date.now()}', 'القاهرة', 'Cairo', 'OFFICIAL', ST_SetSRID(ST_MakePoint(31.2357, 30.0444), 4326))
       RETURNING id`,
    );
    const cairoId = cairoRes.rows[0].id;

    const clientA = await database.pool.connect(); // City release (activates Giza)
    const clientB = await database.pool.connect(); // Clinic writer (without override)

    try {
      // Step 1: Client A starts release transaction: acquires exclusive catalog revision fence and adds official Giza
      await clientA.query('BEGIN');
      await clientA.query(`UPDATE city_catalog_revisions SET revision = revision + 1 WHERE id = 1`);
      await clientA.query(
        `INSERT INTO cities (source_code, name_english, name_arabic, governorate, status, center_point)
         VALUES ('EGY-GIZ-1', 'Giza Released ${Date.now()}', 'الجيزة', 'Giza', 'OFFICIAL', ST_SetSRID(ST_MakePoint(31.2000, 30.0100), 4326))
         RETURNING id`,
      );

      // Step 2: Client B attempts to create clinic near Giza coordinates (30.01, 31.20) with Cairo selected and NO override.
      // Client B attempts to acquire shared catalog fence and blocks on Client A's exclusive lock.
      let clientBFinished = false;
      let clientBError = null;
      const clinicName = 'New Release Clinic ' + crypto.randomUUID();

      const clinicPromise = (async () => {
        try {
          await clientB.query('BEGIN');
          await createClinicInTransaction(
            clientB,
            'pg',
            {
              name_english: clinicName,
              city_id: cairoId, // Cairo selected
              latitude: 30.01, // 0 km from newly released Giza
              longitude: 31.2,
              address_english: '10 Pyramids Rd',
              address_arabic: '١٠ طريق الأهرام',
              location_confirmed: true,
              // No override_reason provided!
            },
            { id: principals.adminId, role: 'SUPER_ADMIN', is_active: true },
          );
          await clientB.query('COMMIT');
        } catch (err) {
          await clientB.query('ROLLBACK').catch(() => {});
          clientBError = err;
        } finally {
          clientBFinished = true;
        }
      })();

      await new Promise((r) => setTimeout(r, 80));
      assert.equal(
        clientBFinished,
        false,
        'Client B must block waiting for City release to commit its catalog revision',
      );

      // Step 3: Client A commits release transaction (catalog revision 2 now live with Giza)
      await clientA.query('COMMIT');

      // Step 4: Client B unblocks, reads catalog revision 2, computes nearest city against new catalog (Giza),
      // detects discrepancy between selected Cairo and nearest Giza, and rejects because no override was provided!
      await clinicPromise;

      assert.ok(clientBError, 'Client B must reject because Giza is now the nearest official city');
      assert.ok(clientBError instanceof ValidationError);
      assert.ok(
        clientBError.propertyErrors.override_reason,
        'Must require override reason on newly detected discrepancy',
      );
      assert.match(clientBError.propertyErrors.override_reason.message, /closest to Giza/i);

      // Verify no clinic was created
      const check = await database.pool.query(`SELECT * FROM vet_clinics WHERE name_english = $1`, [clinicName]);
      assert.equal(check.rowCount, 0, 'No clinic committed against stale catalog snapshot');
    } finally {
      await clientA.query('ROLLBACK').catch(() => {});
      await clientB.query('ROLLBACK').catch(() => {});
      clientA.release();
      clientB.release();
    }
  });

  it('concurrent City release moving representative point of an unlocked City blocks Mapped Location validation', async () => {
    // 1. Clear and insert Cairo and Alexandria
    await database.pool.query('DELETE FROM cities CASCADE');
    const cairoRes = await database.pool.query(
      `INSERT INTO cities (source_code, name_english, name_arabic, governorate, status, center_point)
       VALUES ('EGY-CAI-2', 'Cairo Pt Test ${Date.now()}', 'القاهرة', 'Cairo', 'OFFICIAL', ST_SetSRID(ST_MakePoint(31.2357, 30.0444), 4326))
       RETURNING id`,
    );
    const cairoId = cairoRes.rows[0].id;

    const alexRes = await database.pool.query(
      `INSERT INTO cities (source_code, name_english, name_arabic, governorate, status, center_point)
       VALUES ('EGY-ALX-1', 'Alexandria Pt Test ${Date.now()}', 'الإسكندرية', 'Alexandria', 'OFFICIAL', ST_SetSRID(ST_MakePoint(29.9200, 31.2000), 4326))
       RETURNING id`,
    );
    const alexId = alexRes.rows[0].id;

    const clientA = await database.pool.connect(); // Release moving Alex representative point
    const clientB = await database.pool.connect(); // Clinic writer

    try {
      // Step 1: Client A starts release transaction and moves Alexandria center_point to (31.21, 30.02)
      await clientA.query('BEGIN');
      await clientA.query(`UPDATE city_catalog_revisions SET revision = revision + 1 WHERE id = 1`);
      await clientA.query(
        `UPDATE cities SET center_point = ST_SetSRID(ST_MakePoint(31.2100, 30.0200), 4326) WHERE id = $1`,
        [alexId],
      );

      // Step 2: Client B attempts to create clinic at (30.02, 31.21) with Cairo selected (no override reason).
      // Client B blocks on shared catalog revision fence.
      let clientBFinished = false;
      let clientBError = null;
      const clinicName = 'Point Movement Clinic ' + crypto.randomUUID();

      const clinicPromise = (async () => {
        try {
          await clientB.query('BEGIN');
          await createClinicInTransaction(
            clientB,
            'pg',
            {
              name_english: clinicName,
              city_id: cairoId,
              latitude: 30.02,
              longitude: 31.21,
              address_english: '10 Moved Point Rd',
              address_arabic: '١٠ طريق النقطة المنقولة',
              location_confirmed: true,
            },
            { id: principals.adminId, role: 'SUPER_ADMIN', is_active: true },
          );
          await clientB.query('COMMIT');
        } catch (err) {
          await clientB.query('ROLLBACK').catch(() => {});
          clientBError = err;
        } finally {
          clientBFinished = true;
        }
      })();

      await new Promise((r) => setTimeout(r, 80));
      assert.equal(clientBFinished, false, 'Client B must block waiting for City release point movement');

      // Step 3: Client A commits release
      await clientA.query('COMMIT');

      // Step 4: Client B unblocks, observes newly moved Alex point as nearest, and rejects without override
      await clinicPromise;

      assert.ok(clientBError, 'Client B must reject with discrepancy on moved representative point');
      assert.ok(clientBError instanceof ValidationError);
      assert.match(clientBError.propertyErrors.override_reason.message, /closest to Alexandria/i);

      const check = await database.pool.query(`SELECT * FROM vet_clinics WHERE name_english = $1`, [clinicName]);
      assert.equal(check.rowCount, 0);
    } finally {
      await clientA.query('ROLLBACK').catch(() => {});
      await clientB.query('ROLLBACK').catch(() => {});
      clientA.release();
      clientB.release();
    }
  });

  it('in-flight Mapped Location transaction holds shared catalog revision fence, blocking concurrent City release from committing', async () => {
    // 1. Clear and seed official Cairo
    await database.pool.query('DELETE FROM cities CASCADE');
    const cairoRes = await database.pool.query(
      `INSERT INTO cities (name_english, name_arabic, governorate, status, center_point)
       VALUES ('Cairo Shared Fence Test ${Date.now()}', 'القاهرة', 'Cairo', 'OFFICIAL', ST_SetSRID(ST_MakePoint(31.2357, 30.0444), 4326))
       RETURNING id`,
    );
    const cairoId = cairoRes.rows[0].id;

    const clientA = await database.pool.connect(); // Clinic writer (holds shared fence)
    const clientB = await database.pool.connect(); // City release (attempts exclusive update on revision)

    try {
      // Step 1: Client A begins transaction, acquires shared catalog fence and writes clinic
      await clientA.query('BEGIN');
      const clinicName = 'Fence Holder Clinic ' + crypto.randomUUID();
      const clinic = await createClinicInTransaction(
        clientA,
        'pg',
        {
          name_english: clinicName,
          city_id: cairoId,
          latitude: 30.0444,
          longitude: 31.2357,
          address_english: '10 Nile St',
          address_arabic: '١٠ شارع النيل',
          location_confirmed: true,
        },
        { id: principals.adminId, role: 'SUPER_ADMIN', is_active: true },
      );
      assert.ok(clinic);

      // Step 2: Client B attempts to advance catalog revision in parallel (will block on Client A's share lock)
      let clientBFinished = false;
      const releasePromise = (async () => {
        await clientB.query('BEGIN');
        await clientB.query(`UPDATE city_catalog_revisions SET revision = revision + 1 WHERE id = 1`);
        await clientB.query('COMMIT');
        clientBFinished = true;
      })();

      await new Promise((r) => setTimeout(r, 80));
      assert.equal(
        clientBFinished,
        false,
        'Client B (City release) must block while Client A holds shared catalog revision fence',
      );

      // Step 3: Client A commits clinic transaction
      await clientA.query('COMMIT');

      // Step 4: Client B finishes release
      await releasePromise;
      assert.equal(clientBFinished, true);

      // Verify clinic was committed
      const check = await database.pool.query(`SELECT * FROM vet_clinics WHERE id = $1`, [clinic.id]);
      assert.equal(check.rowCount, 1);

      // Verify revision advanced to 3 (Client A clinic create + Client B city release)
      const revCheck = await database.pool.query(`SELECT revision FROM city_catalog_revisions WHERE id = 1`);
      assert.equal(revCheck.rows[0].revision, 3);
    } finally {
      await clientA.query('ROLLBACK').catch(() => {});
      await clientB.query('ROLLBACK').catch(() => {});
      clientA.release();
      clientB.release();
    }
  });

  it('Knex persistence adapter enforces transactional administrator verification and catalog fencing with equivalent serialization', async () => {
    // 1. Clear and seed Cairo and Giza
    await database.pool.query('DELETE FROM cities CASCADE');
    const cairoRes = await database.pool.query(
      `INSERT INTO cities (name_english, name_arabic, governorate, status, center_point)
       VALUES ('Cairo Knex Test ${Date.now()}', 'القاهرة', 'Cairo', 'OFFICIAL', ST_SetSRID(ST_MakePoint(31.2357, 30.0444), 4326))
       RETURNING id`,
    );
    const cairoId = cairoRes.rows[0].id;

    const gizaRes = await database.pool.query(
      `INSERT INTO cities (name_english, name_arabic, governorate, status, center_point)
       VALUES ('Giza Knex Test ${Date.now()}', 'الجيزة', 'Giza', 'OFFICIAL', ST_SetSRID(ST_MakePoint(31.2000, 30.0100), 4326))
       RETURNING id`,
    );
    const gizaId = gizaRes.rows[0].id;

    // 2. Active admin and deactivated admin
    const activeAdminRes = await database.pool.query(
      `INSERT INTO admin_users (email, password_hash, full_name, role, is_active)
       VALUES ('knex-active@pupzy.app', '$2a$12$placeholder', 'Knex Active Admin', 'ADMIN', true)
       RETURNING id`,
    );
    const activeAdminId = activeAdminRes.rows[0].id;

    const deactivatedAdminRes = await database.pool.query(
      `INSERT INTO admin_users (email, password_hash, full_name, role, is_active)
       VALUES ('knex-deactivated@pupzy.app', '$2a$12$placeholder', 'Knex Deactivated Admin', 'ADMIN', false)
       RETURNING id`,
    );
    const deactivatedAdminId = deactivatedAdminRes.rows[0].id;

    // 3. Knex transaction rejecting deactivated admin on discrepancy override
    await assert.rejects(
      () =>
        executeVetClinicTransaction(knex, async (adapter) => {
          return await createVetClinicCommand(
            adapter,
            {
              name_english: 'Knex Discrepancy Clinic',
              city_id: cairoId, // Cairo selected, Giza nearest
              latitude: 30.01,
              longitude: 31.2,
              address_english: '10 Border St',
              address_arabic: '١٠ شارع الحدود',
              location_confirmed: true,
              override_reason: 'Knex border reason',
            },
            { id: deactivatedAdminId, role: 'ADMIN', is_active: true }, // Session claims active, DB has inactive
          );
        }),
      (err) => {
        assert.ok(err instanceof ValidationError);
        assert.match(err.propertyErrors.override_reason.message, /active administrators/i);
        return true;
      },
    );

    // 4. Knex transaction succeeding with active administrator
    const createdClinic = await executeVetClinicTransaction(knex, async (adapter) => {
      return await createVetClinicCommand(
        adapter,
        {
          name_english: 'Knex Success Clinic',
          city_id: cairoId,
          latitude: 30.01,
          longitude: 31.2,
          address_english: '10 Border St',
          address_arabic: '١٠ شارع الحدود',
          location_confirmed: true,
          override_reason: 'Knex valid border override',
        },
        { id: activeAdminId, role: 'ADMIN', is_active: true },
      );
    });

    assert.ok(createdClinic);
    assert.equal(createdClinic.name_english, 'Knex Success Clinic');

    // Verify audit log row
    const auditRows = await database.pool.query(`SELECT * FROM vet_clinic_location_audits WHERE vet_clinic_id = $1`, [
      createdClinic.id,
    ]);
    assert.equal(auditRows.rowCount, 1);
    assert.equal(auditRows.rows[0].admin_user_id, activeAdminId);
    assert.equal(auditRows.rows[0].reason, 'Knex valid border override');
  });

  it('concurrent Vet Clinic create transactions on separate connections serialize deterministically without 40P01 deadlocks and advance catalog revision exactly twice', async () => {
    // 1. Seed official Cairo
    await database.pool.query('DELETE FROM cities CASCADE');
    const cairoRes = await database.pool.query(
      `INSERT INTO cities (source_code, name_english, name_arabic, governorate, status, center_point)
       VALUES ('EGY-CAI-CONC-1', 'Cairo Concurrent ${Date.now()}', 'القاهرة', 'Cairo', 'OFFICIAL', ST_SetSRID(ST_MakePoint(31.2357, 30.0444), 4326))
       RETURNING id`,
    );
    const cairoId = cairoRes.rows[0].id;

    // Reset revision to 1
    await database.pool.query(`UPDATE city_catalog_revisions SET revision = 1 WHERE id = 1`);

    const clientA = await database.pool.connect();
    const clientB = await database.pool.connect();

    try {
      const clinicNameA = 'Concurrent Clinic A ' + crypto.randomUUID();
      const clinicNameB = 'Concurrent Clinic B ' + crypto.randomUUID();

      let resultA = null;
      let resultB = null;
      let errorA = null;
      let errorB = null;

      // Launch both transactions concurrently on separate PostgreSQL connections
      await Promise.all([
        (async () => {
          try {
            await clientA.query('BEGIN');
            resultA = await createClinicInTransaction(
              clientA,
              'pg',
              {
                name_english: clinicNameA,
                city_id: cairoId,
                latitude: 30.0444,
                longitude: 31.2357,
                address_english: '10 Nile St',
                address_arabic: '١٠ شارع النيل',
                location_confirmed: true,
              },
              { id: principals.adminId, role: 'SUPER_ADMIN', is_active: true },
            );
            await clientA.query('COMMIT');
          } catch (err) {
            await clientA.query('ROLLBACK').catch(() => {});
            errorA = err;
          }
        })(),
        (async () => {
          try {
            await clientB.query('BEGIN');
            resultB = await createClinicInTransaction(
              clientB,
              'pg',
              {
                name_english: clinicNameB,
                city_id: cairoId,
                latitude: 30.0444,
                longitude: 31.2357,
                address_english: '20 Nile St',
                address_arabic: '٢٠ شارع النيل',
                location_confirmed: true,
              },
              { id: principals.adminId, role: 'SUPER_ADMIN', is_active: true },
            );
            await clientB.query('COMMIT');
          } catch (err) {
            await clientB.query('ROLLBACK').catch(() => {});
            errorB = err;
          }
        })(),
      ]);

      assert.ifError(errorA);
      assert.ifError(errorB);
      assert.ok(resultA);
      assert.ok(resultB);

      // Verify both clinics exist in the database
      const checkA = await database.pool.query(`SELECT * FROM vet_clinics WHERE name_english = $1`, [clinicNameA]);
      const checkB = await database.pool.query(`SELECT * FROM vet_clinics WHERE name_english = $1`, [clinicNameB]);
      assert.equal(checkA.rowCount, 1);
      assert.equal(checkB.rowCount, 1);

      // Verify singleton revision advanced exactly twice: 1 -> 3
      const revCheck = await database.pool.query(`SELECT revision FROM city_catalog_revisions WHERE id = 1`);
      assert.equal(revCheck.rows[0].revision, 3);
    } finally {
      await clientA.query('ROLLBACK').catch(() => {});
      await clientB.query('ROLLBACK').catch(() => {});
      clientA.release();
      clientB.release();
    }
  });

  it('concurrent Vet Clinic update and create transactions on separate connections serialize deterministically and advance revision exactly twice', async () => {
    // 1. Seed official Cairo and Giza
    await database.pool.query('DELETE FROM cities CASCADE');
    const cairoRes = await database.pool.query(
      `INSERT INTO cities (source_code, name_english, name_arabic, governorate, status, center_point)
       VALUES ('EGY-CAI-UPDATE-1', 'Cairo Update Test ${Date.now()}', 'القاهرة', 'Cairo', 'OFFICIAL', ST_SetSRID(ST_MakePoint(31.2357, 30.0444), 4326))
       RETURNING id`,
    );
    const cairoId = cairoRes.rows[0].id;

    const gizaRes = await database.pool.query(
      `INSERT INTO cities (source_code, name_english, name_arabic, governorate, status, center_point)
       VALUES ('EGY-GIZ-UPDATE-1', 'Giza Update Test ${Date.now()}', 'الجيزة', 'Giza', 'OFFICIAL', ST_SetSRID(ST_MakePoint(31.2000, 30.0100), 4326))
       RETURNING id`,
    );
    const gizaId = gizaRes.rows[0].id;

    // Pre-insert an existing clinic in Cairo
    const initialClinicRes = await database.pool.query(
      `INSERT INTO vet_clinics (name_english, name_arabic, city_id, coordinates, address_english, address_arabic, source, location_provenance, is_active)
       VALUES ('Existing Clinic Initial', 'عيادة أولية', $1, ST_SetSRID(ST_MakePoint(31.2357, 30.0444), 4326), 'Old Address', 'عنوان قديم', 'MANUAL', 'MANUAL', true)
       RETURNING id`,
      [cairoId],
    );
    const existingClinicId = initialClinicRes.rows[0].id;

    // Reset revision to 1
    await database.pool.query(`UPDATE city_catalog_revisions SET revision = 1 WHERE id = 1`);

    const clientA = await database.pool.connect(); // Relocates existing clinic with discrepancy override
    const clientB = await database.pool.connect(); // Creates a new clinic in Giza

    try {
      const newClinicName = 'Concurrent Created Clinic ' + crypto.randomUUID();
      let errorA = null;
      let errorB = null;

      await Promise.all([
        (async () => {
          try {
            await clientA.query('BEGIN');
            await updateClinicInTransaction(
              clientA,
              'pg',
              existingClinicId,
              {
                city_id: cairoId, // selected Cairo, but located near Giza (discrepancy)
                latitude: 30.01,
                longitude: 31.2,
                address_english: '10 Nile Border St',
                address_arabic: '١٠ شارع الحدود النيلية',
                location_confirmed: true,
                override_reason: 'Operating on boundary between Cairo and Giza.',
              },
              { id: principals.adminId, role: 'SUPER_ADMIN', is_active: true },
            );
            await clientA.query('COMMIT');
          } catch (err) {
            await clientA.query('ROLLBACK').catch(() => {});
            errorA = err;
          }
        })(),
        (async () => {
          try {
            await clientB.query('BEGIN');
            await createClinicInTransaction(
              clientB,
              'pg',
              {
                name_english: newClinicName,
                city_id: gizaId,
                latitude: 30.01,
                longitude: 31.2,
                address_english: '15 Pyramids Ave',
                address_arabic: '١٥ شارع الأهرام',
                location_confirmed: true,
              },
              { id: principals.adminId, role: 'SUPER_ADMIN', is_active: true },
            );
            await clientB.query('COMMIT');
          } catch (err) {
            await clientB.query('ROLLBACK').catch(() => {});
            errorB = err;
          }
        })(),
      ]);

      assert.ifError(errorA);
      assert.ifError(errorB);

      // Verify existing clinic was updated and audit log written
      const updatedClinic = await database.pool.query(`SELECT * FROM vet_clinics WHERE id = $1`, [existingClinicId]);
      assert.equal(updatedClinic.rows[0].address_english, '10 Nile Border St');

      const auditCheck = await database.pool.query(
        `SELECT * FROM vet_clinic_location_audits WHERE vet_clinic_id = $1`,
        [existingClinicId],
      );
      assert.equal(auditCheck.rowCount, 1);
      assert.equal(auditCheck.rows[0].reason, 'Operating on boundary between Cairo and Giza.');

      // Verify new clinic was created
      const newClinicCheck = await database.pool.query(`SELECT * FROM vet_clinics WHERE name_english = $1`, [
        newClinicName,
      ]);
      assert.equal(newClinicCheck.rowCount, 1);

      // Verify revision advanced exactly twice: 1 -> 3
      const revCheck = await database.pool.query(`SELECT revision FROM city_catalog_revisions WHERE id = 1`);
      assert.equal(revCheck.rows[0].revision, 3);
    } finally {
      await clientA.query('ROLLBACK').catch(() => {});
      await clientB.query('ROLLBACK').catch(() => {});
      clientA.release();
      clientB.release();
    }
  });

  it('failed concurrent Vet Clinic mutation rolls back cleanly without partial clinic, partial audit, or advancing catalog revision', async () => {
    // 1. Seed Cairo
    await database.pool.query('DELETE FROM cities CASCADE');
    const cairoRes = await database.pool.query(
      `INSERT INTO cities (source_code, name_english, name_arabic, governorate, status, center_point)
       VALUES ('EGY-CAI-FAIL-1', 'Cairo Rollback Test ${Date.now()}', 'القاهرة', 'Cairo', 'OFFICIAL', ST_SetSRID(ST_MakePoint(31.2357, 30.0444), 4326))
       RETURNING id`,
    );
    const cairoId = cairoRes.rows[0].id;

    // Reset revision to 1
    await database.pool.query(`UPDATE city_catalog_revisions SET revision = 1 WHERE id = 1`);

    const clientA = await database.pool.connect(); // Failing writer (out-of-bounds coordinates)
    const clientB = await database.pool.connect(); // Successful writer

    try {
      const failingClinicName = 'Failing Clinic ' + crypto.randomUUID();
      const validClinicName = 'Valid Concurrent Clinic ' + crypto.randomUUID();
      let errorA = null;
      let errorB = null;

      await Promise.all([
        (async () => {
          try {
            await clientA.query('BEGIN');
            await createClinicInTransaction(
              clientA,
              'pg',
              {
                name_english: failingClinicName,
                city_id: cairoId,
                latitude: 51.5074, // London (out-of-bounds)
                longitude: -0.1278,
                address_english: 'London St',
                address_arabic: 'شارع لندن',
                location_confirmed: true,
              },
              { id: principals.adminId, role: 'SUPER_ADMIN', is_active: true },
            );
            await clientA.query('COMMIT');
          } catch (err) {
            await clientA.query('ROLLBACK').catch(() => {});
            errorA = err;
          }
        })(),
        (async () => {
          try {
            await clientB.query('BEGIN');
            await createClinicInTransaction(
              clientB,
              'pg',
              {
                name_english: validClinicName,
                city_id: cairoId,
                latitude: 30.0444,
                longitude: 31.2357,
                address_english: '10 Tahrir St',
                address_arabic: '١٠ شارع التحرير',
                location_confirmed: true,
              },
              { id: principals.adminId, role: 'SUPER_ADMIN', is_active: true },
            );
            await clientB.query('COMMIT');
          } catch (err) {
            await clientB.query('ROLLBACK').catch(() => {});
            errorB = err;
          }
        })(),
      ]);

      // Client A must fail with validation error
      assert.ok(errorA, 'Client A must reject with ValidationError');
      assert.ok(errorA instanceof ValidationError);

      // Client B must succeed
      assert.ifError(errorB);

      // Verify Client A's clinic does NOT exist
      const checkA = await database.pool.query(`SELECT * FROM vet_clinics WHERE name_english = $1`, [failingClinicName]);
      assert.equal(checkA.rowCount, 0, 'Failing transaction must leave no clinic row');

      // Verify Client B's clinic DOES exist
      const checkB = await database.pool.query(`SELECT * FROM vet_clinics WHERE name_english = $1`, [validClinicName]);
      assert.equal(checkB.rowCount, 1, 'Successful transaction must commit its clinic row');

      // Verify revision advanced ONLY ONCE (from 1 to 2)
      const revCheck = await database.pool.query(`SELECT revision FROM city_catalog_revisions WHERE id = 1`);
      assert.equal(revCheck.rows[0].revision, 2, 'Catalog revision must advance exactly once for the successful writer');
    } finally {
      await clientA.query('ROLLBACK').catch(() => {});
      await clientB.query('ROLLBACK').catch(() => {});
      clientA.release();
      clientB.release();
    }
  });

  it('concurrent API reader holding shared catalog revision fence and Vet Clinic writer serialize without lock-upgrade deadlocks', async () => {
    // 1. Seed Cairo
    await database.pool.query('DELETE FROM cities CASCADE');
    const cairoRes = await database.pool.query(
      `INSERT INTO cities (source_code, name_english, name_arabic, governorate, status, center_point)
       VALUES ('EGY-CAI-READ-1', 'Cairo Reader Test ${Date.now()}', 'القاهرة', 'Cairo', 'OFFICIAL', ST_SetSRID(ST_MakePoint(31.2357, 30.0444), 4326))
       RETURNING id`,
    );
    const cairoId = cairoRes.rows[0].id;

    // Reset revision to 1
    await database.pool.query(`UPDATE city_catalog_revisions SET revision = 1 WHERE id = 1`);

    const clientReader = await database.pool.connect(); // Reader holding FOR SHARE
    const clientWriter = await database.pool.connect(); // Writer acquiring FOR UPDATE

    try {
      // Step 1: Reader begins transaction and acquires shared catalog revision fence
      await clientReader.query('BEGIN');
      const readerRevision = await acquireCityCatalogRevisionFence(clientReader, true); // FOR SHARE
      assert.equal(readerRevision.revision, 1);

      // Step 2: Writer begins transaction and attempts createVetClinicCommand (blocks on FOR UPDATE waiting for reader)
      let writerFinished = false;
      let writerError = null;
      const clinicName = 'Reader Fence Clinic ' + crypto.randomUUID();

      const writerPromise = (async () => {
        try {
          await clientWriter.query('BEGIN');
          await createClinicInTransaction(
            clientWriter,
            'pg',
            {
              name_english: clinicName,
              city_id: cairoId,
              latitude: 30.0444,
              longitude: 31.2357,
              address_english: '10 Reader St',
              address_arabic: '١٠ شارع القارئ',
              location_confirmed: true,
            },
            { id: principals.adminId, role: 'SUPER_ADMIN', is_active: true },
          );
          await clientWriter.query('COMMIT');
        } catch (err) {
          await clientWriter.query('ROLLBACK').catch(() => {});
          writerError = err;
        } finally {
          writerFinished = true;
        }
      })();

      await new Promise((r) => setTimeout(r, 80));
      assert.equal(writerFinished, false, 'Writer must block waiting for Reader shared fence to release');

      // Step 3: Reader commits / releases shared lock
      await clientReader.query('COMMIT');

      // Step 4: Writer unblocks and commits successfully
      await writerPromise;
      assert.ifError(writerError);
      assert.equal(writerFinished, true);

      // Verify clinic was committed
      const check = await database.pool.query(`SELECT * FROM vet_clinics WHERE name_english = $1`, [clinicName]);
      assert.equal(check.rowCount, 1);

      // Verify revision advanced to 2
      const revCheck = await database.pool.query(`SELECT revision FROM city_catalog_revisions WHERE id = 1`);
      assert.equal(revCheck.rows[0].revision, 2);
    } finally {
      await clientReader.query('ROLLBACK').catch(() => {});
      await clientWriter.query('ROLLBACK').catch(() => {});
      clientReader.release();
      clientWriter.release();
    }
  });

  it('concurrent Vet Clinic update transactions on separate connections serialize deterministically without 40P01 deadlocks and advance catalog revision exactly twice', async () => {
    // 1. Seed official Cairo and Giza
    await database.pool.query('DELETE FROM cities CASCADE');
    const cairoRes = await database.pool.query(
      `INSERT INTO cities (source_code, name_english, name_arabic, governorate, status, center_point)
       VALUES ('EGY-CAI-UPDUPD-1', 'Cairo UpdUpd Test ${Date.now()}', 'القاهرة', 'Cairo', 'OFFICIAL', ST_SetSRID(ST_MakePoint(31.2357, 30.0444), 4326))
       RETURNING id`,
    );
    const cairoId = cairoRes.rows[0].id;

    const gizaRes = await database.pool.query(
      `INSERT INTO cities (source_code, name_english, name_arabic, governorate, status, center_point)
       VALUES ('EGY-GIZ-UPDUPD-1', 'Giza UpdUpd Test ${Date.now()}', 'الجيزة', 'Giza', 'OFFICIAL', ST_SetSRID(ST_MakePoint(31.2000, 30.0100), 4326))
       RETURNING id`,
    );
    const gizaId = gizaRes.rows[0].id;

    // Pre-insert two existing clinics
    const clinicRes1 = await database.pool.query(
      `INSERT INTO vet_clinics (name_english, name_arabic, city_id, coordinates, address_english, address_arabic, source, location_provenance, is_active)
       VALUES ('Clinic One Initial', 'عيادة أولى', $1, ST_SetSRID(ST_MakePoint(31.2357, 30.0444), 4326), '1 Old Rd', '١ طريق قديم', 'MANUAL', 'MANUAL', true)
       RETURNING id`,
      [cairoId],
    );
    const clinicId1 = clinicRes1.rows[0].id;

    const clinicRes2 = await database.pool.query(
      `INSERT INTO vet_clinics (name_english, name_arabic, city_id, coordinates, address_english, address_arabic, source, location_provenance, is_active)
       VALUES ('Clinic Two Initial', 'عيادة ثانية', $1, ST_SetSRID(ST_MakePoint(31.2357, 30.0444), 4326), '2 Old Rd', '٢ طريق قديم', 'MANUAL', 'MANUAL', true)
       RETURNING id`,
      [cairoId],
    );
    const clinicId2 = clinicRes2.rows[0].id;

    // Reset revision to 1
    await database.pool.query(`UPDATE city_catalog_revisions SET revision = 1 WHERE id = 1`);

    const clientA = await database.pool.connect();
    const clientB = await database.pool.connect();

    try {
      let errorA = null;
      let errorB = null;

      await Promise.all([
        (async () => {
          try {
            await clientA.query('BEGIN');
            await updateClinicInTransaction(
              clientA,
              'pg',
              clinicId1,
              {
                city_id: cairoId, // Discrepant override near Giza
                latitude: 30.01,
                longitude: 31.2,
                address_english: '100 Nile West St',
                address_arabic: '١٠٠ شارع غرب النيل',
                location_confirmed: true,
                override_reason: 'Operating on western border.',
              },
              { id: principals.adminId, role: 'SUPER_ADMIN', is_active: true },
            );
            await clientA.query('COMMIT');
          } catch (err) {
            await clientA.query('ROLLBACK').catch(() => {});
            errorA = err;
          }
        })(),
        (async () => {
          try {
            await clientB.query('BEGIN');
            await updateClinicInTransaction(
              clientB,
              'pg',
              clinicId2,
              {
                city_id: gizaId, // Relocate to Giza matching coords
                latitude: 30.01,
                longitude: 31.2,
                address_english: '200 Pyramids West Ave',
                address_arabic: '٢٠٠ شارع الأهرام غرب',
                location_confirmed: true,
              },
              { id: principals.adminId, role: 'SUPER_ADMIN', is_active: true },
            );
            await clientB.query('COMMIT');
          } catch (err) {
            await clientB.query('ROLLBACK').catch(() => {});
            errorB = err;
          }
        })(),
      ]);

      assert.ifError(errorA);
      assert.ifError(errorB);

      // Verify both clinics were updated
      const updated1 = await database.pool.query(`SELECT * FROM vet_clinics WHERE id = $1`, [clinicId1]);
      const updated2 = await database.pool.query(`SELECT * FROM vet_clinics WHERE id = $1`, [clinicId2]);
      assert.equal(updated1.rows[0].address_english, '100 Nile West St');
      assert.equal(updated2.rows[0].address_english, '200 Pyramids West Ave');

      // Verify audit recorded for clinic 1
      const auditCheck = await database.pool.query(
        `SELECT * FROM vet_clinic_location_audits WHERE vet_clinic_id = $1`,
        [clinicId1],
      );
      assert.equal(auditCheck.rowCount, 1);
      assert.equal(auditCheck.rows[0].reason, 'Operating on western border.');

      // Verify revision advanced exactly twice: 1 -> 3
      const revCheck = await database.pool.query(`SELECT revision FROM city_catalog_revisions WHERE id = 1`);
      assert.equal(revCheck.rows[0].revision, 3);
    } finally {
      await clientA.query('ROLLBACK').catch(() => {});
      await clientB.query('ROLLBACK').catch(() => {});
      clientA.release();
      clientB.release();
    }
  });

  it('failed concurrent Vet Clinic update rolls back cleanly without partial update or advancing catalog revision', async () => {
    // 1. Seed Cairo
    await database.pool.query('DELETE FROM cities CASCADE');
    const cairoRes = await database.pool.query(
      `INSERT INTO cities (source_code, name_english, name_arabic, governorate, status, center_point)
       VALUES ('EGY-CAI-FAILUPD-1', 'Cairo Fail Upd Test ${Date.now()}', 'القاهرة', 'Cairo', 'OFFICIAL', ST_SetSRID(ST_MakePoint(31.2357, 30.0444), 4326))
       RETURNING id`,
    );
    const cairoId = cairoRes.rows[0].id;

    // Pre-insert clinic
    const clinicRes = await database.pool.query(
      `INSERT INTO vet_clinics (name_english, name_arabic, city_id, coordinates, address_english, address_arabic, source, location_provenance, is_active)
       VALUES ('Unchanged Clinic', 'عيادة ثابتة', $1, ST_SetSRID(ST_MakePoint(31.2357, 30.0444), 4326), 'Original Address', 'عنوان أصلي', 'MANUAL', 'MANUAL', true)
       RETURNING id`,
      [cairoId],
    );
    const clinicId = clinicRes.rows[0].id;

    // Reset revision to 1
    await database.pool.query(`UPDATE city_catalog_revisions SET revision = 1 WHERE id = 1`);

    const clientA = await database.pool.connect(); // Failing update (out-of-bounds coords)
    const clientB = await database.pool.connect(); // Successful create

    try {
      const validClinicName = 'Valid Sibling Clinic ' + crypto.randomUUID();
      let errorA = null;
      let errorB = null;

      await Promise.all([
        (async () => {
          try {
            await clientA.query('BEGIN');
            await updateClinicInTransaction(
              clientA,
              'pg',
              clinicId,
              {
                city_id: cairoId,
                latitude: 99.999, // Out of bounds
                longitude: 31.2357,
                address_english: 'Corrupted Address',
                address_arabic: 'عنوان معطوب',
                location_confirmed: true,
              },
              { id: principals.adminId, role: 'SUPER_ADMIN', is_active: true },
            );
            await clientA.query('COMMIT');
          } catch (err) {
            await clientA.query('ROLLBACK').catch(() => {});
            errorA = err;
          }
        })(),
        (async () => {
          try {
            await clientB.query('BEGIN');
            await createClinicInTransaction(
              clientB,
              'pg',
              {
                name_english: validClinicName,
                city_id: cairoId,
                latitude: 30.0444,
                longitude: 31.2357,
                address_english: 'Valid Street',
                address_arabic: 'شارع صالح',
                location_confirmed: true,
              },
              { id: principals.adminId, role: 'SUPER_ADMIN', is_active: true },
            );
            await clientB.query('COMMIT');
          } catch (err) {
            await clientB.query('ROLLBACK').catch(() => {});
            errorB = err;
          }
        })(),
      ]);

      assert.ok(errorA, 'Client A must fail validation');
      assert.ok(errorA instanceof ValidationError);
      assert.ifError(errorB);

      // Verify original clinic was NOT updated
      const clinicCheck = await database.pool.query(`SELECT address_english FROM vet_clinics WHERE id = $1`, [clinicId]);
      assert.equal(clinicCheck.rows[0].address_english, 'Original Address');

      // Verify revision advanced exactly once (from 1 to 2)
      const revCheck = await database.pool.query(`SELECT revision FROM city_catalog_revisions WHERE id = 1`);
      assert.equal(revCheck.rows[0].revision, 2);
    } finally {
      await clientA.query('ROLLBACK').catch(() => {});
      await clientB.query('ROLLBACK').catch(() => {});
      clientA.release();
      clientB.release();
    }
  });
});
