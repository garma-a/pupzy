import assert from 'node:assert/strict';
import { after, before, beforeEach, describe, it } from 'node:test';
import bcrypt from 'bcryptjs';
import { TestDatabaseHelper } from './test-database.helper.js';
import { seedFirstAdmin } from '../scripts/seed-first-admin.js';

const database = new TestDatabaseHelper();

describe('First administrator one-time bootstrap', () => {
  before(async () => {
    await database.start();
  });

  after(async () => {
    await database.stop();
  });

  beforeEach(async () => {
    await database.clean();
  });

  describe('Clean baseline initial Super Admin creation', () => {
    it('creates initial SUPER_ADMIN with secure bcrypt hash, active state, and trimmed lowercase email', async () => {
      const logs = [];
      const result = await seedFirstAdmin({
        pool: database.pool,
        email: '  InitialSuperAdmin@Pupzy.App  ',
        password: 'InitialSecurePassword123!',
        fullName: 'Initial Super Admin',
        logger: { log: (msg) => logs.push(msg) },
      });

      assert.equal(result.created, true);
      assert.equal(result.admin.email, 'initialsuperadmin@pupzy.app');
      assert.equal(result.admin.role, 'SUPER_ADMIN');
      assert.equal(result.admin.is_active, true);
      assert.ok(logs.some((l) => l.includes('First SUPER_ADMIN created')));

      const dbRes = await database.pool.query(
        'SELECT email, password_hash, full_name, role, is_active FROM admin_users WHERE email = $1',
        ['initialsuperadmin@pupzy.app'],
      );

      assert.equal(dbRes.rows.length, 1);
      const admin = dbRes.rows[0];
      assert.equal(admin.email, 'initialsuperadmin@pupzy.app');
      assert.equal(admin.full_name, 'Initial Super Admin');
      assert.equal(admin.role, 'SUPER_ADMIN');
      assert.equal(admin.is_active, true);
      assert.match(admin.password_hash, /^\$2[aby]\$\d{2}\$/);
      assert.equal(await bcrypt.compare('InitialSecurePassword123!', admin.password_hash), true);
      assert.equal(await bcrypt.compare('WrongPassword', admin.password_hash), false);
    });

    it('rejects passwords shorter than 12 characters', async () => {
      await assert.rejects(
        seedFirstAdmin({
          pool: database.pool,
          email: 'admin@example.com',
          password: 'short',
          fullName: 'Admin Name',
        }),
        /ADMIN_SEED_PASSWORD must be at least 12 characters\./,
      );
    });

    it('requires email, password, and fullName', async () => {
      await assert.rejects(
        seedFirstAdmin({
          pool: database.pool,
          email: 'admin@example.com',
          password: '',
          fullName: 'Admin Name',
        }),
        /DATABASE_URL, ADMIN_SEED_EMAIL, ADMIN_SEED_PASSWORD, and ADMIN_SEED_FULL_NAME are required\./,
      );

      await assert.rejects(
        seedFirstAdmin({
          pool: database.pool,
          email: '',
          password: 'Password123456!',
          fullName: 'Admin Name',
        }),
        /DATABASE_URL, ADMIN_SEED_EMAIL, ADMIN_SEED_PASSWORD, and ADMIN_SEED_FULL_NAME are required\./,
      );
    });
  });

  describe('Repeated bootstrap idempotency & non-mutation', () => {
    it('leaves existing administrator password hash, name, role, and active state unchanged', async () => {
      // 1. Initial creation
      const firstResult = await seedFirstAdmin({
        pool: database.pool,
        email: 'superadmin@example.com',
        password: 'OriginalPassword123!',
        fullName: 'Original Name',
      });
      assert.equal(firstResult.created, true);

      const beforeRes = await database.pool.query(
        'SELECT id, password_hash, full_name, role, is_active FROM admin_users WHERE email = $1',
        ['superadmin@example.com'],
      );
      const originalRecord = beforeRes.rows[0];

      // 2. Repeated bootstrap with DIFFERENT credentials and name
      const logs = [];
      const secondResult = await seedFirstAdmin({
        pool: database.pool,
        email: 'superadmin@example.com',
        password: 'CompletelyDifferentPassword456!',
        fullName: 'Mutated Name Attempt',
        logger: { log: (msg) => logs.push(msg) },
      });

      assert.equal(secondResult.created, false);
      assert.equal(secondResult.email, 'superadmin@example.com');
      assert.ok(logs.some((l) => l.includes('Administrator account already exists')));

      // 3. Verify database row is completely unchanged
      const afterRes = await database.pool.query(
        'SELECT id, password_hash, full_name, role, is_active FROM admin_users WHERE email = $1',
        ['superadmin@example.com'],
      );
      const currentRecord = afterRes.rows[0];

      assert.equal(currentRecord.id, originalRecord.id);
      assert.equal(currentRecord.password_hash, originalRecord.password_hash);
      assert.equal(currentRecord.full_name, 'Original Name');
      assert.equal(currentRecord.role, 'SUPER_ADMIN');
      assert.equal(currentRecord.is_active, true);

      // Verify original password STILL validates, new password does NOT validate
      assert.equal(await bcrypt.compare('OriginalPassword123!', currentRecord.password_hash), true);
      assert.equal(await bcrypt.compare('CompletelyDifferentPassword456!', currentRecord.password_hash), false);
    });
  });

  describe('Disabled admin preservation and lower-privilege account non-promotion', () => {
    it('does NOT reactivate a disabled administrator', async () => {
      const originalHash = await bcrypt.hash('DisabledPassword123!', 12);
      await database.pool.query(
        `INSERT INTO admin_users (email, password_hash, full_name, role, is_active)
         VALUES ('disabled@pupzy.app', $1, 'Disabled Administrator', 'SUPER_ADMIN', false)`,
        [originalHash],
      );

      const result = await seedFirstAdmin({
        pool: database.pool,
        email: 'disabled@pupzy.app',
        password: 'AttemptedReactivation123!',
        fullName: 'Reactivated Attempt',
      });

      assert.equal(result.created, false);

      const checkRes = await database.pool.query(
        'SELECT password_hash, full_name, role, is_active FROM admin_users WHERE email = $1',
        ['disabled@pupzy.app'],
      );
      const admin = checkRes.rows[0];
      assert.equal(admin.is_active, false);
      assert.equal(admin.full_name, 'Disabled Administrator');
      assert.equal(admin.password_hash, originalHash);
      assert.equal(await bcrypt.compare('DisabledPassword123!', admin.password_hash), true);
      assert.equal(await bcrypt.compare('AttemptedReactivation123!', admin.password_hash), false);
    });

    it('does NOT promote an ADMIN to SUPER_ADMIN', async () => {
      const originalHash = await bcrypt.hash('StaffPassword123!', 12);
      await database.pool.query(
        `INSERT INTO admin_users (email, password_hash, full_name, role, is_active)
         VALUES ('staff@pupzy.app', $1, 'Staff Moderator', 'ADMIN', true)`,
        [originalHash],
      );

      const result = await seedFirstAdmin({
        pool: database.pool,
        email: 'staff@pupzy.app',
        password: 'AttemptedPromotionPassword123!',
        fullName: 'Promoted Super Admin',
      });

      assert.equal(result.created, false);

      const checkRes = await database.pool.query(
        'SELECT password_hash, full_name, role, is_active FROM admin_users WHERE email = $1',
        ['staff@pupzy.app'],
      );
      const admin = checkRes.rows[0];
      assert.equal(admin.role, 'ADMIN');
      assert.equal(admin.full_name, 'Staff Moderator');
      assert.equal(admin.password_hash, originalHash);
      assert.equal(await bcrypt.compare('StaffPassword123!', admin.password_hash), true);
      assert.equal(await bcrypt.compare('AttemptedPromotionPassword123!', admin.password_hash), false);
    });
  });

  describe('Concurrent bootstrap attempts', () => {
    it('resolves concurrent bootstrap requests with exactly 1 insert and no corruption', async () => {
      const attempts = await Promise.all([
        seedFirstAdmin({
          pool: database.pool,
          email: 'concurrent@pupzy.app',
          password: 'ConcurrentPassword123!',
          fullName: 'Concurrent Admin 1',
        }),
        seedFirstAdmin({
          pool: database.pool,
          email: 'concurrent@pupzy.app',
          password: 'ConcurrentPassword123!',
          fullName: 'Concurrent Admin 2',
        }),
        seedFirstAdmin({
          pool: database.pool,
          email: 'concurrent@pupzy.app',
          password: 'ConcurrentPassword123!',
          fullName: 'Concurrent Admin 3',
        }),
        seedFirstAdmin({
          pool: database.pool,
          email: 'concurrent@pupzy.app',
          password: 'ConcurrentPassword123!',
          fullName: 'Concurrent Admin 4',
        }),
        seedFirstAdmin({
          pool: database.pool,
          email: 'concurrent@pupzy.app',
          password: 'ConcurrentPassword123!',
          fullName: 'Concurrent Admin 5',
        }),
      ]);

      const created = attempts.filter((a) => a.created === true);
      const skipped = attempts.filter((a) => a.created === false);

      assert.equal(created.length, 1);
      assert.equal(skipped.length, 4);

      const checkRes = await database.pool.query('SELECT count(*)::text AS count FROM admin_users WHERE email = $1', [
        'concurrent@pupzy.app',
      ]);
      assert.equal(checkRes.rows[0].count, '1');
    });
  });

  describe('Absence of plaintext credential exposure', () => {
    it('never leaks plaintext password or password hash into logs', async () => {
      const logs = [];
      const secretPassword = 'TopSecretPassword999!';
      const customLogger = {
        log: (msg) => logs.push(msg),
      };

      await seedFirstAdmin({
        pool: database.pool,
        email: 'privacy@pupzy.app',
        password: secretPassword,
        fullName: 'Privacy Admin',
        logger: customLogger,
      });

      // Repeated run
      await seedFirstAdmin({
        pool: database.pool,
        email: 'privacy@pupzy.app',
        password: secretPassword,
        fullName: 'Privacy Admin',
        logger: customLogger,
      });

      for (const entry of logs) {
        assert.equal(entry.includes(secretPassword), false);
        assert.equal(entry.includes('$2b$12$'), false);
      }
    });
  });
});
