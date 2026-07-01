import { Injectable } from '@nestjs/common';
import { UsersRepository } from './users.repository';
import type { User } from '../database/schema';

interface FindOrCreateInput {
  firebaseUid: string;
  email: string;
  photoUrl?: string;
}

@Injectable()
export class UsersService {
  constructor(private readonly usersRepository: UsersRepository) { }

  /**
   * Called by FirebaseAuthGuard on every request.
   * Creates the user on first login, returns existing user thereafter.
   * This is the ONLY place a user row is created — no separate signup mutation needed.
   */
  async findOrCreate(input: FindOrCreateInput): Promise<User> {
    const existing = await this.usersRepository.findByFirebaseUid(input.firebaseUid);
    if (existing) return existing;

    return this.usersRepository.create({
      firebaseUid: input.firebaseUid,
      email: input.email,
      profilePictureUrl: input.photoUrl,
    });
  }

  async findById(id: string): Promise<User | undefined> {
    return this.usersRepository.findById(id);
  }

  async completeProfile(
    userId: string,
    data: { fullName: string; phoneNumber: string; cityId: string },
  ): Promise<User> {
    return this.usersRepository.update(userId, data);
  }
}
