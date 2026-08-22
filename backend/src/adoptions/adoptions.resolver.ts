import { Resolver, Query, Mutation, Args, Context, ResolveField, Parent } from '@nestjs/graphql';
import { Throttle } from '@nestjs/throttler';
import { AdoptionsService } from './adoptions.service';
import { validateSubmitAdoptionApplicationInput } from './dto/submit-adoption-application.input';
import type { GqlContext } from '../common/types/gql-context.type';
import type { AdoptionApplication, User } from '../database/schema';

/**
 * AdoptionsResolver — GraphQL resolver for adoption application flows.
 *
 * ## Authentication
 * All operations require a logged-in user (global FirebaseAuthGuard).
 *
 * ## BOLA protection
 * - postAdoptionApplications: verifies caller is post owner
 * - approveAdoptionApplication/rejectAdoptionApplication: verifies caller is post owner
 */
@Resolver('AdoptionApplication')
export class AdoptionsResolver {
  constructor(private readonly adoptionsService: AdoptionsService) {}

  // ─── Queries ─────────────────────────────────────────────────────────

  @Query('myAdoptionApplications')
  async myAdoptionApplications(
    @Args('first') first: number | undefined,
    @Args('after') after: string | undefined,
    @Context() ctx: GqlContext,
  ) {
    return this.adoptionsService.getMyApplications(ctx.user!.id, first, after);
  }

  @Query('postAdoptionApplications')
  async postAdoptionApplications(
    @Args('postId') postId: string,
    @Args('status') status: string | undefined,
    @Args('first') first: number | undefined,
    @Args('after') after: string | undefined,
    @Context() ctx: GqlContext,
  ) {
    return this.adoptionsService.getPostApplications(ctx.user!.id, postId, status, first, after);
  }

  // ─── Mutations ──────────────────────────────────────────────────────

  /** Anti-spam: 10 applications per hour per IP (see AUD-15 re: true per-user limiting). */
  @Throttle({ default: { limit: 10, ttl: 3_600_000 } })
  @Mutation('submitAdoptionApplication')
  async submitAdoptionApplication(
    @Args('input') input: unknown,
    @Context() ctx: GqlContext,
  ): Promise<AdoptionApplication> {
    const validated = validateSubmitAdoptionApplicationInput(input);
    return this.adoptionsService.submitApplication(ctx.user!.id, validated);
  }

  @Mutation('approveAdoptionApplication')
  async approveAdoptionApplication(@Args('applicationId') applicationId: string, @Context() ctx: GqlContext) {
    return this.adoptionsService.approveApplication(ctx.user!.id, applicationId);
  }

  @Mutation('rejectAdoptionApplication')
  async rejectAdoptionApplication(
    @Args('applicationId') applicationId: string,
    @Context() ctx: GqlContext,
  ): Promise<AdoptionApplication> {
    return this.adoptionsService.rejectApplication(ctx.user!.id, applicationId);
  }

  // ─── Field Resolvers ──────────────────────────────────────────────────

  /**
   * Resolves the `applicant` field on AdoptionApplication.
   * Uses the `userById` DataLoader to batch-load users efficiently.
   */
  @ResolveField('applicant')
  async applicant(@Parent() application: AdoptionApplication, @Context() ctx: GqlContext): Promise<User | null> {
    return ctx.loaders.userById.load(application.applicantId);
  }
}
