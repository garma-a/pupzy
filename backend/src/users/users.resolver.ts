import { Resolver, Query, Mutation, Args, Context, ResolveField, Root } from '@nestjs/graphql';
import { CurrentUser } from '../auth/current-user.decorator';
import { Public } from '../auth/firebase.guard';
import { UsersService } from './users.service';
import { AccountDeletionService, type AccountDeletionPayload } from './account-deletion.service';
import { validateCompleteProfileInput } from './dto/complete-profile.input';
import { validateUpdateProfileInput } from './dto/update-profile.input';
import { validateGeoLocationInput } from './dto/geo-location.input';
import { validateLanguagePreferenceInput } from './dto/language-preference.input';
import { validateNotificationsEnabledInput } from './dto/notification-preferences.input';
import { validateDeleteMyAccountInput } from './dto/delete-my-account.input';
import type { User, City } from '../database/schema';
import type { GqlContext } from '../common/types/gql-context.type';

/**
 * UsersResolver — GraphQL resolver for all User-related operations.
 *
 * ## Authentication
 * All methods are protected by the global `FirebaseAuthGuard` applied in AppModule.
 * `@CurrentUser()` injects the already-resolved `User` from the GQL context.
 *
 * ## Field resolvers
 * - `profileComplete` — computed from `phoneNumber` + `homeCityId`, never stored in DB
 * - `city` — resolved from `homeCityId` via the per-request `cityById` DataLoader,
 *   batching all city lookups in a single query regardless of how many users
 *   are returned in a list
 */
@Resolver('User')
export class UsersResolver {
  constructor(
    private readonly usersService: UsersService,
    private readonly accountDeletionService: AccountDeletionService,
  ) {}

  /**
   * Returns the currently authenticated user.
   */
  @Query()
  me(@CurrentUser() user: User): User {
    return user;
  }

  /**
   * Checks deletion progress using the scoped deletionId and progressToken.
   * Public query — does not require or grant ordinary account access.
   */
  @Query('accountDeletionProgress')
  @Public()
  async accountDeletionProgress(
    @Args('deletionId') deletionId: string,
    @Args('progressToken') progressToken: string,
  ): Promise<AccountDeletionPayload> {
    return this.accountDeletionService.getProgress(deletionId, progressToken);
  }

  /**
   * Computed field — true only when phoneNumber AND homeCityId are both set.
   *
   * Google/Facebook Sign-In never provides a phone number, so this will always
   * be false on the very first login. The frontend should check this field
   * after every login and redirect to the profile-completion screen if false.
   */
  @ResolveField('profileComplete')
  profileComplete(@Root() user: User): boolean {
    return user.phoneNumber !== null && user.phoneNumber !== '' && user.homeCityId !== null;
  }

  /**
   * Resolves the full City object for a user via the per-request DataLoader.
   *
   * Without DataLoader this would be an N+1 query when fetching a list of
   * users. DataLoader batches all `cityById.load()` calls within the same
   * event-loop tick into a single `WHERE id = ANY($1)` query.
   *
   * Returns null if the user has not yet completed their profile (homeCityId = null).
   */
  @ResolveField('city')
  city(@Root() user: User, @Context() ctx: GqlContext): Promise<City | null> {
    if (!user.homeCityId) return Promise.resolve(null);
    return ctx.loaders.cityById.load(user.homeCityId);
  }

  /**
   * Completes the user's profile on first login.
   * Validates that the supplied cityId actually exists in the database.
   */
  @Mutation('completeProfile')
  async completeProfile(@Args('input') input: unknown, @Context() context: GqlContext): Promise<User> {
    const validated = validateCompleteProfileInput(input);
    return this.usersService.completeProfile(context.user!.id, validated);
  }

  /**
   * Updates the user's profile information.
   */
  @Mutation('updateProfile')
  async updateProfile(@Args('input') input: unknown, @Context() context: GqlContext): Promise<User> {
    const validated = validateUpdateProfileInput(input);
    return this.usersService.updateProfile(context.user!.id, validated);
  }

  /**
   * Updates the user's location based on GPS coordinates.
   */
  @Mutation('updateMyLocation')
  async updateMyLocation(@Args('location') location: unknown, @Context() context: GqlContext): Promise<User> {
    const validated = validateGeoLocationInput(location);
    return this.usersService.updateMyLocation(context.user!.id, validated);
  }

  /**
   * Explicitly synchronizes the notification language preference.
   * Requires only the chosen language — no unrelated profile resubmission.
   */
  @Mutation('updateMyLanguagePreference')
  async updateMyLanguagePreference(
    @Args('languagePreference') languagePreference: unknown,
    @Context() context: GqlContext,
  ): Promise<User> {
    const validated = validateLanguagePreferenceInput(languagePreference);
    return this.usersService.updateLanguagePreference(context.user!.id, validated);
  }

  /**
   * Updates the explicit push notification preference. Disabling push keeps
   * the in-app inbox and history intact.
   */
  @Mutation('updateMyNotificationPreferences')
  async updateMyNotificationPreferences(
    @Args('notificationsEnabled') notificationsEnabled: unknown,
    @Context() context: GqlContext,
  ): Promise<User> {
    const validated = validateNotificationsEnabledInput(notificationsEnabled);
    return this.usersService.updateNotificationPreferences(context.user!.id, validated);
  }

  /**
   * Permanently deletes the authenticated user's Pupzy Account and all associated data.
   * Target is derived exclusively from verified authentication.
   * Requires authentication within the preceding 5 minutes.
   */
  @Mutation('deleteMyAccount')
  async deleteMyAccount(
    @Args('input') input: unknown,
    @Context() context: GqlContext,
  ): Promise<AccountDeletionPayload> {
    const validated = validateDeleteMyAccountInput(input);
    return this.accountDeletionService.initiateDeletion(context.user!, context.authTime, validated.progressToken);
  }
}
