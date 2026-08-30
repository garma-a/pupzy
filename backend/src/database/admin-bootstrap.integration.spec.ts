import { eq } from 'drizzle-orm';
import * as bcrypt from 'bcryptjs';
import { TestDatabaseHelper } from '../../test/test-database.helper';
import { adminUsers } from './schema';
import { seedInitialAdmin, runDatabaseSeed } from './seed';

describe('Administrator One-Time Bootstrap Integration', () => {
  jest.setTimeout(120_000);

  let dbHelper: TestDatabaseHelper;

  beforeAll(async () => {
    dbHelper = new TestDatabaseHelper();
    await dbHelper.start();
  }, 120_000);

  afterAll(async () => {
    await dbHelper.stop();
  });

  beforeEach(async () => {
    await dbHelper.clean();
  });

  describe('Clean baseline initial Super Admin creation', () => {
    it('creates initial Super Admin with secure bcrypt hash and active state', async () => {
      const result = await seedInitialAdmin(dbHelper.db, {
        email: '  InitialSuperAdmin@Pupzy.App  ',
        password: 'InitialSecurePassword123!',
        fullName: 'Initial Super Admin',
      });

      expect(result).not.toBeNull();
      expect(result?.created).toBe(true);
      expect(result?.email).toBe('initialsuperadmin@pupzy.app');

      const rows = await dbHelper.db
        .select()
        .from(adminUsers)
        .where(eq(adminUsers.email, 'initialsuperadmin@pupzy.app'));

      expect(rows.length).toBe(1);
      const admin = rows[0];
      expect(admin.email).toBe('initialsuperadmin@pupzy.app');
      expect(admin.fullName).toBe('Initial Super Admin');
      expect(admin.role).toBe('SUPER_ADMIN');
      expect(admin.isActive).toBe(true);
      expect(admin.passwordHash).toMatch(/^\$2[aby]\$\d{2}\$/);
      expect(await bcrypt.compare('InitialSecurePassword123!', admin.passwordHash)).toBe(true);
      expect(await bcrypt.compare('WrongPassword', admin.passwordHash)).toBe(false);
    });

    it('returns null when email or password is missing', async () => {
      const prevEmail = process.env.ADMIN_SEED_EMAIL;
      const prevPassword = process.env.ADMIN_SEED_PASSWORD;
      delete process.env.ADMIN_SEED_EMAIL;
      delete process.env.ADMIN_SEED_PASSWORD;

      try {
        const noCreds = await seedInitialAdmin(dbHelper.db, {});
        expect(noCreds).toBeNull();

        const noPassword = await seedInitialAdmin(dbHelper.db, { email: 'admin@example.com' });
        expect(noPassword).toBeNull();
      } finally {
        if (prevEmail) process.env.ADMIN_SEED_EMAIL = prevEmail;
        if (prevPassword) process.env.ADMIN_SEED_PASSWORD = prevPassword;
      }
    });

    it('rejects passwords shorter than 12 characters without exposing credential in error', async () => {
      await expect(
        seedInitialAdmin(dbHelper.db, {
          email: 'admin@example.com',
          password: 'short',
          fullName: 'Short Admin',
        }),
      ).rejects.toThrow('ADMIN_SEED_PASSWORD must be at least 12 characters.');
    });
  });

  describe('Repeated seeding idempotency & non-mutation', () => {
    it('leaves existing administrator password hash, name, role, and active state unchanged', async () => {
      // 1. Initial creation
      const firstSeed = await seedInitialAdmin(dbHelper.db, {
        email: 'superadmin@example.com',
        password: 'OriginalPassword123!',
        fullName: 'Original Name',
      });
      expect(firstSeed?.created).toBe(true);

      const [originalRecord] = await dbHelper.db
        .select()
        .from(adminUsers)
        .where(eq(adminUsers.email, 'superadmin@example.com'));

      // 2. Repeated seed with DIFFERENT password, name, and attempted override
      const secondSeed = await seedInitialAdmin(dbHelper.db, {
        email: 'superadmin@example.com',
        password: 'CompletelyDifferentPassword456!',
        fullName: 'Mutated Name Attempt',
      });

      expect(secondSeed?.created).toBe(false);
      expect(secondSeed?.email).toBe('superadmin@example.com');

      // 3. Verify database record was NOT mutated
      const [currentRecord] = await dbHelper.db
        .select()
        .from(adminUsers)
        .where(eq(adminUsers.email, 'superadmin@example.com'));

      expect(currentRecord.id).toBe(originalRecord.id);
      expect(currentRecord.passwordHash).toBe(originalRecord.passwordHash);
      expect(currentRecord.fullName).toBe('Original Name');
      expect(currentRecord.role).toBe('SUPER_ADMIN');
      expect(currentRecord.isActive).toBe(true);

      // Verify original password STILL validates, new password does NOT validate
      expect(await bcrypt.compare('OriginalPassword123!', currentRecord.passwordHash)).toBe(true);
      expect(await bcrypt.compare('CompletelyDifferentPassword456!', currentRecord.passwordHash)).toBe(false);
    });

    it('preserves existing administrator state across routine full database seed', async () => {
      // 1. Initial seed
      await seedInitialAdmin(dbHelper.db, {
        email: 'admin@pupzy.app',
        password: 'FirstPassword123!',
        fullName: 'First Admin',
      });

      const [initialAdmin] = await dbHelper.db.select().from(adminUsers).where(eq(adminUsers.email, 'admin@pupzy.app'));

      // 2. Run full database seed with different admin credentials
      await runDatabaseSeed(dbHelper.db, {
        admin: {
          email: 'admin@pupzy.app',
          password: 'SecondPassword456!',
          fullName: 'Second Admin Attempt',
        },
      });

      const [survivingAdmin] = await dbHelper.db
        .select()
        .from(adminUsers)
        .where(eq(adminUsers.email, 'admin@pupzy.app'));

      expect(survivingAdmin.passwordHash).toBe(initialAdmin.passwordHash);
      expect(survivingAdmin.fullName).toBe('First Admin');
      expect(await bcrypt.compare('FirstPassword123!', survivingAdmin.passwordHash)).toBe(true);
    });
  });

  describe('Preservation of disabled status and non-promotion of lower-privilege accounts', () => {
    it('does NOT reactivate a disabled administrator', async () => {
      // 1. Manually insert or deactivate an administrator
      const originalHash = await bcrypt.hash('DisabledAdminPassword123!', 12);
      const [disabledUser] = await dbHelper.db
        .insert(adminUsers)
        .values({
          email: 'disabled.admin@pupzy.app',
          passwordHash: originalHash,
          fullName: 'Disabled Staff Member',
          role: 'SUPER_ADMIN',
          isActive: false,
        })
        .returning();

      expect(disabledUser.isActive).toBe(false);

      // 2. Run bootstrap targeting this email
      const seedResult = await seedInitialAdmin(dbHelper.db, {
        email: 'disabled.admin@pupzy.app',
        password: 'AttemptedReactivationPassword123!',
        fullName: 'Reactivated Name Attempt',
      });

      expect(seedResult?.created).toBe(false);

      // 3. Verify user remains deactivated and unchanged
      const [persisted] = await dbHelper.db
        .select()
        .from(adminUsers)
        .where(eq(adminUsers.email, 'disabled.admin@pupzy.app'));

      expect(persisted.isActive).toBe(false);
      expect(persisted.fullName).toBe('Disabled Staff Member');
      expect(persisted.passwordHash).toBe(originalHash);
      expect(await bcrypt.compare('DisabledAdminPassword123!', persisted.passwordHash)).toBe(true);
      expect(await bcrypt.compare('AttemptedReactivationPassword123!', persisted.passwordHash)).toBe(false);
    });

    it('does NOT promote a lower-privilege ADMIN to SUPER_ADMIN', async () => {
      // 1. Insert an ADMIN (role: ADMIN)
      const originalHash = await bcrypt.hash('StaffPassword123!', 12);
      const [staffAdmin] = await dbHelper.db
        .insert(adminUsers)
        .values({
          email: 'staff.moderator@pupzy.app',
          passwordHash: originalHash,
          fullName: 'Staff Moderator',
          role: 'ADMIN',
          isActive: true,
        })
        .returning();

      expect(staffAdmin.role).toBe('ADMIN');

      // 2. Run bootstrap targeting this email
      const seedResult = await seedInitialAdmin(dbHelper.db, {
        email: 'staff.moderator@pupzy.app',
        password: 'AttemptedSuperAdminPassword123!',
        fullName: 'Attempted Super Admin',
      });

      expect(seedResult?.created).toBe(false);

      // 3. Verify role remains ADMIN and was NOT escalated
      const [persisted] = await dbHelper.db
        .select()
        .from(adminUsers)
        .where(eq(adminUsers.email, 'staff.moderator@pupzy.app'));

      expect(persisted.role).toBe('ADMIN');
      expect(persisted.fullName).toBe('Staff Moderator');
      expect(persisted.passwordHash).toBe(originalHash);
      expect(await bcrypt.compare('StaffPassword123!', persisted.passwordHash)).toBe(true);
      expect(await bcrypt.compare('AttemptedSuperAdminPassword123!', persisted.passwordHash)).toBe(false);
    });
  });

  describe('Concurrent bootstrap attempts', () => {
    it('handles parallel bootstrap requests safely without corruption or duplicates', async () => {
      const attempts = await Promise.all([
        seedInitialAdmin(dbHelper.db, {
          email: 'concurrent.admin@pupzy.app',
          password: 'ConcurrentPassword123!',
          fullName: 'Concurrent Admin 1',
        }),
        seedInitialAdmin(dbHelper.db, {
          email: 'concurrent.admin@pupzy.app',
          password: 'ConcurrentPassword123!',
          fullName: 'Concurrent Admin 2',
        }),
        seedInitialAdmin(dbHelper.db, {
          email: 'concurrent.admin@pupzy.app',
          password: 'ConcurrentPassword123!',
          fullName: 'Concurrent Admin 3',
        }),
        seedInitialAdmin(dbHelper.db, {
          email: 'concurrent.admin@pupzy.app',
          password: 'ConcurrentPassword123!',
          fullName: 'Concurrent Admin 4',
        }),
        seedInitialAdmin(dbHelper.db, {
          email: 'concurrent.admin@pupzy.app',
          password: 'ConcurrentPassword123!',
          fullName: 'Concurrent Admin 5',
        }),
      ]);

      const createdCount = attempts.filter((a) => a?.created === true).length;
      const skippedCount = attempts.filter((a) => a?.created === false).length;

      expect(createdCount).toBe(1);
      expect(skippedCount).toBe(4);

      const allRows = await dbHelper.db
        .select()
        .from(adminUsers)
        .where(eq(adminUsers.email, 'concurrent.admin@pupzy.app'));

      expect(allRows.length).toBe(1);
      expect(allRows[0].role).toBe('SUPER_ADMIN');
      expect(allRows[0].isActive).toBe(true);
    });
  });

  describe('Absence of plaintext credential exposure', () => {
    it('never logs or prints the plaintext password or password hash', async () => {
      const logs: string[] = [];
      const logSpy = jest.spyOn(console, 'log').mockImplementation((...args) => {
        logs.push(args.join(' '));
      });

      const rawPassword = 'ExtremelySecretPassword999!';
      try {
        await seedInitialAdmin(dbHelper.db, {
          email: 'privacy.test@pupzy.app',
          password: rawPassword,
          fullName: 'Privacy Admin',
        });

        // Repeated run
        await seedInitialAdmin(dbHelper.db, {
          email: 'privacy.test@pupzy.app',
          password: rawPassword,
          fullName: 'Privacy Admin',
        });
      } finally {
        logSpy.mockRestore();
      }

      for (const logLine of logs) {
        expect(logLine).not.toContain(rawPassword);
        expect(logLine).not.toContain('$2b$12$');
      }
    });
  });
});
