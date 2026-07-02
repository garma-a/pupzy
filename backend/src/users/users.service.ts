import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { UsersRepository } from './users.repository';
import { encryptString } from '../common/utils/crypto.util';
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
   * Called by FirebaseAuthGuard on every request.
   * Creates the user on first login, returns existing user thereafter.
   * This is the ONLY place a user row is created — no separate signup mutation needed.
   */
  async findOrCreate(input: FindOrCreateInput): Promise<User> {
    const existing = await this.usersRepository.findByFirebaseUid(
      input.firebaseUid,
    );
    if (existing) return existing;

    this.logger.log(
      `Creating new user account for Firebase UID: ${input.firebaseUid}`,
    );
    return this.usersRepository.create({
      firebaseUid: input.firebaseUid,
      email: input.email,
      authProvider: input.authProvider,
      profilePictureUrl: input.photoUrl,
    });
  }

  async findById(id: string): Promise<User | undefined> {
    return this.usersRepository.findById(id);
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
    return this.usersRepository.update(userId, {
      fullName: data.fullName,
      phoneNumber: encryptedPhone,
      cityId: data.cityId,
    });
  }

  /**
   * Updates an already completed profile.
   */
  async updateProfile(
    userId: string,
    data: { fullName: string },
  ): Promise<User> {
    return this.usersRepository.update(userId, {
      fullName: data.fullName,
    });
  }
}
