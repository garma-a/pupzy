import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { UsersRepository } from './users.repository';
import { encryptString, decryptString } from '../common/utils/crypto.util';
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
    config: ConfigService,
  ) {
    this.phoneEncryptionKey = config.get<string>('PHONE_ENCRYPTION_KEY')!;
  }

  /**
   * Helper to decrypt a user's phone number before returning to the client.
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
      return user; // Return encrypted or fallback rather than failing the whole request
    }
  }

  /**
   * Called by FirebaseAuthGuard on every request.
   * Creates the user on first login, returns existing user thereafter.
   * This is the ONLY place a user row is created — no separate signup mutation needed.
   */
  async findOrCreate(input: FindOrCreateInput): Promise<User> {
    const existing = await this.usersRepository.findByFirebaseUid(
      input.firebaseUid,
    );
    if (existing) return this.decryptUserPhone(existing);

    this.logger.log(
      `Creating new user account for Firebase UID: ${input.firebaseUid}`,
    );
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
   * The phone number is immediately encrypted before saving to the database.
   */
  async completeProfile(
    userId: string,
    data: { fullName: string; phoneNumber: string; cityId: string },
  ): Promise<User> {
    const encryptedPhone = encryptString(
      data.phoneNumber,
      this.phoneEncryptionKey,
    );
    const updatedUser = await this.usersRepository.update(userId, {
      fullName: data.fullName,
      phoneNumber: encryptedPhone,
      cityId: data.cityId,
    });
    return this.decryptUserPhone(updatedUser);
  }

  /**
   * Updates an already completed profile.
   */
  async updateProfile(
    userId: string,
    data: { fullName: string },
  ): Promise<User> {
    const updatedUser = await this.usersRepository.update(userId, {
      fullName: data.fullName,
    });
    return this.decryptUserPhone(updatedUser);
  }
}
