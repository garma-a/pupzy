import { Resolver, Query, Mutation, Args, Context } from '@nestjs/graphql';
import { CurrentUser } from '../auth/current-user.decorator';
import { UsersService } from './users.service';
import { validateCompleteProfileInput } from './dto/complete-profile.input';
import { validateUpdateProfileInput } from './dto/update-profile.input';
import type { User } from '../database/schema';
import type { GqlContext } from '../common/types/gql-context.type';

/**
 * UsersResolver — GraphQL resolver for all User-related operations.
 *
 * ## Authentication
 * All methods are protected by the global `FirebaseAuthGuard` applied in AppModule.
 * `@CurrentUser()` injects the already-resolved `User` from the GQL context.
 */
@Resolver('User')
export class UsersResolver {
  constructor(private readonly usersService: UsersService) { }

  /**
   * Returns the currently authenticated user.
   */
  @Query()
  me(@CurrentUser() user: User): User {
    return user;
  }

  /**
   * Completes the user's profile on first login.
   */
  @Mutation('completeProfile')
  async completeProfile(
    @Args('input') input: unknown,
    @Context() context: GqlContext,
  ): Promise<User> {
    const validated = validateCompleteProfileInput(input);
    return this.usersService.completeProfile(context.user!.id, validated);
  }

  /**
   * Updates the user's profile information.
   */
  @Mutation('updateProfile')
  async updateProfile(
    @Args('input') input: unknown,
    @Context() context: GqlContext,
  ): Promise<User> {
    const validated = validateUpdateProfileInput(input);
    return this.usersService.updateProfile(context.user!.id, validated);
  }
}
