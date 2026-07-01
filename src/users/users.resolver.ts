import { Resolver, Query, Mutation, Args } from '@nestjs/graphql';
import { UseGuards } from '@nestjs/common';
import { FirebaseAuthGuard } from '../auth/firebase.guard';
import { CurrentUser } from '../auth/current-user.decorator';
import { UsersService } from './users.service';
import type { User } from '../database/schema';

// NestJS GraphQL code-first: define resolver; schema auto-generated
@Resolver('User')
@UseGuards(FirebaseAuthGuard)   // every method in this resolver requires auth
export class UsersResolver {
  constructor(private readonly usersService: UsersService) { }

  @Query()
  me(@CurrentUser() user: User): User {
    // Guard already resolved the full User object — just return it
    return user;
  }

  @Mutation()
  async completeProfile(
    @CurrentUser() user: User,
    @Args('input') input: { fullName: string; phoneNumber: string; cityId: string },
  ): Promise<User> {
    return this.usersService.completeProfile(user.id, input);
  }
}
