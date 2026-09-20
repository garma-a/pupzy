import { Inject, Injectable, Logger } from '@nestjs/common';
import DataLoader from 'dataloader';
import { ConfigService } from '@nestjs/config';

import { CACHE_MANAGER } from '@nestjs/cache-manager';
import type { Cache } from 'cache-manager';
import { UsersRepository, type UsersExecutor } from './users.repository';
import { AccountDeletionRepository } from './account-deletion.repository';
import { CitiesService } from '../cities/cities.service';
import { encryptString, decryptString } from '../common/utils/crypto.util';
import { ForbiddenError, NotFoundError, ValidationError } from '../common/errors/app.errors';
import { isAccountDeletionBlockedStatus, type User } from '../database/schema';

interface FindOrCreateInput {
  firebaseUserId: string;
  email: string;
  photoUrl?: string;
  emailVerified?: boolean;
}

@Injectable()
export class UsersService {
  private readonly logger = new Logger(UsersService.name);
  private readonly phoneEncryptionKey: string;

  constructor(
    private readonly usersRepository: UsersRepository,
    private readonly citiesService: CitiesService,
    private readonly accountDeletionRepository: AccountDeletionRepository,
    config: ConfigService,
    @Inject(CACHE_MANAGER) private readonly cacheManager: Cache,
  ) {
    this.phoneEncryptionKey = config.get<string>('PHONE_ENCRYPTION_KEY')!;
  }

  /**
   * Helper to decrypt a user's phone number before returning to the client.
   * Returns the user unchanged if phoneNumber is null or decryption fails.
   */
  private decryptUserPhone(user: User): User {
    if (!user.phoneNumber) return user;
    try {
      return {
        ...user,
        phoneNumber: decryptString(user.phoneNumber, this.phoneEncryptionKey),
      };
    } catch (error) {
      this.logger.error(
        `Failed to decrypt phone number for user ${user.id}`,
        error instanceof Error ? error.stack : String(error),
      );
      // Return the user with null phone number to avoid leaking crypto internals
      return { ...user, phoneNumber: null };
    }
  }

  /**
   * Called by FirebaseAuthGuard on every request.
   * Creates the user on first login, returns existing user thereafter.
   * This is the ONLY place a user row is created — no separate signup mutation needed.
   *
   * phoneNumber and homeCityId will be null until the user calls completeProfile().
   */
  async findOrCreate(input: FindOrCreateInput): Promise<User> {
    const deletion = await this.accountDeletionRepository.findByFirebaseUserId(input.firebaseUserId);
    if (deletion && isAccountDeletionBlockedStatus(deletion.status)) {
      throw new ForbiddenError('ACCOUNT_DELETED');
    }

    const existing = await this.usersRepository.findByFirebaseUserId(input.firebaseUserId);
    if (existing) return this.decryptUserPhone(existing);

    if (input.email) {
      const existingByEmail = await this.usersRepository.findByEmail(input.email);
      if (existingByEmail) {
        if (!input.emailVerified) {
          throw new ValidationError('Email must be verified to link with an existing account.');
        }
        this.logger.log(
          `Firebase UID changed for ${input.email}, updating from ${existingByEmail.firebaseUserId} to ${input.firebaseUserId}`,
        );
        const updated = await this.usersRepository.update(existingByEmail.id, {
          firebaseUserId: input.firebaseUserId,
          profilePictureUrl: input.photoUrl,
        });
        await this.invalidateUserCache(updated.firebaseUserId);
        return this.decryptUserPhone(updated);
      }
    }

    this.logger.log(`Creating new user account for Firebase UID: ${input.firebaseUserId}`);
    const newUser = await this.usersRepository.create({
      firebaseUserId: input.firebaseUserId,
      email: input.email,
      profilePictureUrl: input.photoUrl,
    });
    return this.decryptUserPhone(newUser);
  }

  async findById(id: string): Promise<User | undefined> {
    const user = await this.usersRepository.findById(id);
    return user ? this.decryptUserPhone(user) : undefined;
  }

  /**
   * Finds a non-banned user by ID. Accepts an optional Drizzle executor so
   * isolation-sensitive callers (contact disclosure, approval) can read the
   * phone number inside the same transaction that holds the account-pair lock.
   */
  async findActiveById(id: string, executor?: UsersExecutor): Promise<User | undefined> {
    if (this.accountDeletionRepository) {
      const deletion = await this.accountDeletionRepository.findByUserId(id);
      if (deletion && isAccountDeletionBlockedStatus(deletion.status)) {
        return undefined;
      }
    }
    const user = await this.usersRepository.findActiveById(id, executor);
    return user ? this.decryptUserPhone(user) : undefined;
  }

  /**
   * Called once after the user's first login to set required profile fields.
   *
   * ## Validation
   * - If `cityId` is provided, validates it exists in the `cities` table before
   *   saving. This prevents orphaned foreign keys from speculative client input.
   * - If `location` is provided instead, resolves the nearest city via PostGIS.
   *
   * ## Security
   * The phone number is encrypted with AES-256-GCM before writing to the database.
   * It is decrypted on read in `decryptUserPhone()`.
   */
  async completeProfile(
    userId: string,
    data: {
      fullName: string;
      phoneNumber: string;
      cityId?: string;
      location?: { latitude: number; longitude: number };
      languagePreference?: 'ar' | 'en';
    },
  ): Promise<User> {
    const encryptedPhone = encryptString(data.phoneNumber, this.phoneEncryptionKey);
    let resolvedCityId = data.cityId;

    if (resolvedCityId) {
      // Validate the supplied cityId actually exists in the DB
      const city = await this.citiesService.findById(resolvedCityId);
      if (!city) {
        throw new ValidationError(`cityId "${resolvedCityId}" does not correspond to a known city`);
      }
    } else if (data.location) {
      // Auto-resolve city from GPS coordinates via PostGIS ST_Distance
      const city = await this.citiesService.findNearest(data.location.latitude, data.location.longitude);
      if (!city) {
        throw new NotFoundError('No nearby city found for the provided coordinates.');
      }
      resolvedCityId = city.id;
    }

    const updatedUser = await this.usersRepository.update(userId, {
      fullName: data.fullName,
      phoneNumber: encryptedPhone,
      homeCityId: resolvedCityId,
      ...(data.languagePreference ? { languagePreference: data.languagePreference } : {}),
      ...(data.location
        ? {
            lastKnownLocation: [data.location.longitude, data.location.latitude],
          }
        : {}),
    });
    await this.invalidateUserCache(updatedUser.firebaseUserId);
    return this.decryptUserPhone(updatedUser);
  }

  /**
   * Invalidates the cached user object by Pupzy user ID.
   * Called by PostsService after post creation to bust stale post counts.
   *
   * Looks up the user's firebaseUserId and deletes the cache entry.
   * Silently no-ops if the user is not found (defensive).
   */
  async invalidateUserCacheById(userId: string): Promise<void> {
    const user = await this.usersRepository.findById(userId);
    if (user) {
      await this.invalidateUserCache(user.firebaseUserId);
    }
  }

  private async invalidateUserCache(firebaseUserId: string): Promise<void> {
    await this.cacheManager.del(`user_resolve:${firebaseUserId}`);
  }

  /**
   * Updates an already completed profile.
   */
  async updateProfile(userId: string, data: { fullName: string; phoneNumber?: string }): Promise<User> {
    const updates: Parameters<typeof this.usersRepository.update>[1] = {
      fullName: data.fullName,
    };

    if (data.phoneNumber) {
      updates.phoneNumber = encryptString(data.phoneNumber, this.phoneEncryptionKey);
    }

    const updatedUser = await this.usersRepository.update(userId, updates);
    await this.invalidateUserCache(updatedUser.firebaseUserId);
    return this.decryptUserPhone(updatedUser);
  }

  /**
   * Explicitly synchronizes the notification language.
   *
   * The preference update requires no unrelated profile field: only the chosen
   * language is written, so it cannot overwrite a name or phone number.
   */
  async updateLanguagePreference(userId: string, languagePreference: 'ar' | 'en'): Promise<User> {
    const updatedUser = await this.usersRepository.update(userId, { languagePreference });
    await this.invalidateUserCache(updatedUser.firebaseUserId);
    return this.decryptUserPhone(updatedUser);
  }

  /**
   * Updates the user's location and nearest city based on GPS coordinates.
   */
  async updateMyLocation(userId: string, location: { latitude: number; longitude: number }): Promise<User> {
    const city = await this.citiesService.findNearest(location.latitude, location.longitude);
    if (!city) {
      throw new NotFoundError('No nearby city found for the provided coordinates.');
    }

    const updatedUser = await this.usersRepository.update(userId, {
      homeCityId: city.id,
      lastKnownLocation: [location.longitude, location.latitude],
    });
    await this.invalidateUserCache(updatedUser.firebaseUserId);
    return this.decryptUserPhone(updatedUser);
  }

  /**
   * Creates a fresh DataLoader instance for batch-loading users by ID.
   *
   * ## Why a factory method?
   * DataLoader instances must be created per-request so each request gets
   * its own in-memory cache. This factory is called once per request from
   * the GraphQLModule context factory in app.module.ts.
   */
  createUserByIdLoader(): DataLoader<string, User | null> {
    return new DataLoader<string, User | null>((ids) => this.usersRepository.findByIds(ids), {
      cache: true,
      maxBatchSize: 100,
    });
  }
}
