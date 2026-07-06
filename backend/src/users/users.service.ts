import { Inject, Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { sql } from 'drizzle-orm';
import { CACHE_MANAGER } from '@nestjs/cache-manager';
import type { Cache } from 'cache-manager';
import { UsersRepository } from './users.repository';
import { CitiesService } from '../cities/cities.service';
import { encryptString, decryptString } from '../common/utils/crypto.util';
import { NotFoundError, ValidationError } from '../common/errors/app.errors';
import type { User } from '../database/schema';

interface FindOrCreateInput {
  firebaseUid: string;
  email: string;
  authProvider: string;
  photoUrl?: string;
}

@Injectable()
export class UsersService {
  private readonly logger = new Logger(UsersService.name);
  private readonly phoneEncryptionKey: string;

  constructor(
    private readonly usersRepository: UsersRepository,
    private readonly citiesService: CitiesService,
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
      this.logger.error(`Failed to decrypt phone number for user ${user.id}`, error);
      // Return the user without crashing the entire request
      return user;
    }
  }

  /**
   * Called by FirebaseAuthGuard on every request.
   * Creates the user on first login, returns existing user thereafter.
   * This is the ONLY place a user row is created — no separate signup mutation needed.
   *
   * phoneNumber and cityId will be null until the user calls completeProfile().
   */
  async findOrCreate(input: FindOrCreateInput): Promise<User> {
    const existing = await this.usersRepository.findByFirebaseUid(input.firebaseUid);
    if (existing) return this.decryptUserPhone(existing);

    if (input.email) {
      const existingByEmail = await this.usersRepository.findByEmail(input.email);
      if (existingByEmail) {
        this.logger.log(
          `Firebase UID changed for ${input.email}, updating from ${existingByEmail.firebaseUid} to ${input.firebaseUid}`,
        );
        const updated = await this.usersRepository.update(existingByEmail.id, {
          firebaseUid: input.firebaseUid,
          authProvider: input.authProvider,
          profilePictureUrl: input.photoUrl,
        });
        await this.invalidateUserCache(updated.firebaseUid);
        return this.decryptUserPhone(updated);
      }
    }

    this.logger.log(`Creating new user account for Firebase UID: ${input.firebaseUid}`);
    const newUser = await this.usersRepository.create({
      firebaseUid: input.firebaseUid,
      email: input.email,
      authProvider: input.authProvider,
      profilePictureUrl: input.photoUrl,
    });
    return this.decryptUserPhone(newUser);
  }

  async findById(id: string): Promise<User | undefined> {
    const user = await this.usersRepository.findById(id);
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
      const city = await this.usersRepository.findNearestCity(data.location.latitude, data.location.longitude);
      if (!city) {
        throw new NotFoundError('No nearby city found for the provided coordinates.');
      }
      resolvedCityId = city.id;
    }

    const updatedUser = await this.usersRepository.update(userId, {
      fullName: data.fullName,
      phoneNumber: encryptedPhone,
      cityId: resolvedCityId,
      ...(data.location
        ? {
            lastKnownLocation:
              sql`ST_GeomFromEWKT(${`SRID=4326;POINT(${data.location.longitude} ${data.location.latitude})`})` as any,
          }
        : {}),
    });
    await this.invalidateUserCache(updatedUser.firebaseUid);
    return this.decryptUserPhone(updatedUser);
  }

  private async invalidateUserCache(firebaseUid: string): Promise<void> {
    await this.cacheManager.del(`user_resolve:${firebaseUid}`);
  }

  /**
   * Updates an already completed profile.
   */
  async updateProfile(userId: string, data: { fullName: string; phoneNumber?: string }): Promise<User> {
    const updates: Partial<User> = {
      fullName: data.fullName,
    };

    if (data.phoneNumber) {
      updates.phoneNumber = encryptString(data.phoneNumber, this.phoneEncryptionKey);
    }

    const updatedUser = await this.usersRepository.update(userId, updates);
    await this.invalidateUserCache(updatedUser.firebaseUid);
    return this.decryptUserPhone(updatedUser);
  }

  /**
   * Updates the user's location and nearest city based on GPS coordinates.
   */
  async updateMyLocation(userId: string, location: { latitude: number; longitude: number }): Promise<User> {
    const city = await this.usersRepository.findNearestCity(location.latitude, location.longitude);
    if (!city) {
      throw new NotFoundError('No nearby city found for the provided coordinates.');
    }

    const updatedUser = await this.usersRepository.update(userId, {
      cityId: city.id,
      lastKnownLocation: sql`ST_GeomFromEWKT(${`SRID=4326;POINT(${location.longitude} ${location.latitude})`})` as any,
    });
    await this.invalidateUserCache(updatedUser.firebaseUid);
    return this.decryptUserPhone(updatedUser);
  }
}
